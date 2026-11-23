'use strict';

// Executes the production SQL adapter against a real PostgreSQL WASM engine.
// PGlite has one database connection, so the bridge serializes whole client
// leases. This verifies SQL/transactions/persistence, not native multi-connection
// MVCC scheduling, pg TCP authentication or a hosting provider's TLS certificate.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const requireServer = createRequire(path.resolve(__dirname, '../fitplan-server/package.json'));
const { PGlite } = requireServer('@electric-sql/pglite');
const { createPostgresRepository } = require('../fitplan-server/postgres-repository.cjs');
const { migrate } = require('../fitplan-server/migrate.cjs');
const S = require('../fitplan-server/security.cjs');
const C = require('../fitplan/core.js');

function bridge(db) {
  let tail = Promise.resolve();
  async function connect() {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    let released = false;
    return {
      async query(sql, params) {
        const result = params === undefined ? (await db.exec(sql)).at(-1) : await db.query(sql, params);
        return { rows: result.rows || [], rowCount: result.affectedRows || result.rows?.length || 0 };
      },
      release() { if (!released) { released = true; release(); } }
    };
  }
  return {
    connect,
    async query(sql, params) { const client = await connect(); try { return await client.query(sql, params); } finally { client.release(); } },
    async end() { await tail; await db.close(); }
  };
}

let directory, pool, repository, sequence = 0;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'formday-postgres-test-'));
  pool = bridge(await PGlite.create(directory));
  await migrate(pool);
  repository = createPostgresRepository(pool);
});
after(async () => { if (repository) await repository.close(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });

async function account() {
  const now = Date.now(), recoveryCode = S.randomToken();
  const user = { id: crypto.randomUUID(), username: 'sqluser' + ++sequence, passwordHash: 'test-password-hash', recoveryHash: S.recoveryHash(recoveryCode), authVersion: 1, createdAt: new Date(now).toISOString() };
  const session = S.newSession(now);
  await repository.register(user, session, null);
  const auth = await repository.getSession(session.tokenHash, now);
  return { user, session, auth, recoveryCode, now };
}
const document = (title = '기존 식단') => C.normalizeState({ events: [{ id: 'meal', date: '2026-11-23', start: '12:00', end: '12:30', type: 'meal', title, repeat: 'none', completed: true, detail: { food: '닭가슴살(조리)', grams: 150 } }], settings: { ...C.defaults } });
const write = (operationId, expectedVersion, state = document()) => ({ operationId, expectedVersion, state, requestHash: S.digest(S.stableJSON({ expectedVersion, state }), 'test-operation') });

test('schema migration is repeatable and uses PostgreSQL constraints and JSONB', async () => {
  await migrate(pool);
  assert.equal(await repository.ready(), true);
  const types = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema='formday' AND table_name='documents' AND column_name='document'");
  assert.equal(types.rows[0].data_type, 'jsonb');
  const a = await account();
  assert.equal((await repository.findUser(a.user.username)).id, a.user.id);
  assert.equal(await repository.findUser(a.user.username + "' OR true --"), null);
  await assert.rejects(repository.register({ ...a.user, id: crypto.randomUUID() }, S.newSession(a.now), null), { code: 'USERNAME_UNAVAILABLE' });
});

test('SQL registration rolls back the user and document when session creation fails', async () => {
  const forbidden = 'f'.repeat(64);
  await pool.query("ALTER TABLE formday.sessions ADD CONSTRAINT test_bad_session CHECK(token_hash <> '" + forbidden + "')");
  const user = { id: crypto.randomUUID(), username: 'rollbackuser', passwordHash: 'test', recoveryHash: 'a'.repeat(64), authVersion: 1 };
  try {
    await assert.rejects(repository.register(user, { ...S.newSession(Date.now()), tokenHash: forbidden }, null));
    assert.equal(await repository.findUser('rollbackuser'), null);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM formday.documents WHERE user_id=$1', [user.id])).rows[0].count, 0);
  } finally { await pool.query('ALTER TABLE formday.sessions DROP CONSTRAINT test_bad_session'); }
});

test('SQL state access revalidates the session and keeps separate users isolated', async () => {
  const a = await account(), b = await account();
  const saved = await repository.putState(a.auth, write('isolation', 0), a.now);
  assert.equal(saved.version, 1); assert.equal(saved.userId, a.user.id);
  assert.equal(saved.state.events[0].detail.items[0].food.source.kind, 'legacy');
  assert.equal((await repository.getState(b.auth, b.now)).state, null);
  await assert.rejects(repository.getState({ ...a.auth, userId: b.user.id }, a.now), { code: 'AUTH_REQUIRED' });
});

test('SQL optimistic writes and idempotent replays never overwrite a newer document', async () => {
  const a = await account(), firstRequest = write('first', 0, document('첫 기록'));
  const [one, two] = await Promise.allSettled([
    repository.putState(a.auth, firstRequest, a.now),
    repository.putState(a.auth, write('competing', 0, document('경쟁 기록')), a.now)
  ]);
  assert.equal(one.status, 'fulfilled'); assert.equal(two.status, 'rejected');
  assert.equal(two.reason.code, 'CONFLICT'); assert.equal(two.reason.extra.version, 1); assert.equal(two.reason.extra.userId, a.user.id);
  const next = await repository.putState(a.auth, write('second', 1, document('최신 기록')), a.now + 1000);
  assert.equal(next.version, 2);
  assert.deepEqual(await repository.putState(a.auth, firstRequest, a.now + 2000), one.value);
  assert.equal((await repository.getState(a.auth, a.now + 2000)).state.events[0].title, '최신 기록');
  await assert.rejects(repository.putState(a.auth, write('first', 0, document('다른 요청')), a.now), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('SQL document and operation ledger commit together or roll back together', async () => {
  const a = await account();
  await pool.query("ALTER TABLE formday.operations ADD CONSTRAINT test_operation_failure CHECK(operation_id <> 'force-fail')");
  try {
    await assert.rejects(repository.putState(a.auth, write('force-fail', 0), a.now));
    const unchanged = await repository.getState(a.auth, a.now);
    assert.equal(unchanged.version, 0); assert.equal(unchanged.state, null);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM formday.operations WHERE user_id=$1', [a.user.id])).rows[0].count, 0);
  } finally { await pool.query('ALTER TABLE formday.operations DROP CONSTRAINT test_operation_failure'); }
});

test('SQL credential recovery is single-use and rejects a login verified against the old auth version', async () => {
  const a = await account(), another = S.newSession(a.now);
  await repository.createSession(a.user.id, 1, another, null);
  const nextRecovery = S.recoveryHash(S.randomToken());
  await repository.recover(a.user.id, a.user.recoveryHash, 'new-password-hash', nextRecovery);
  assert.equal(await repository.getSession(a.session.tokenHash, a.now), null);
  assert.equal(await repository.getSession(another.tokenHash, a.now), null);
  await assert.rejects(repository.recover(a.user.id, a.user.recoveryHash, 'would-overwrite', S.recoveryHash(S.randomToken())), { code: 'INVALID_RECOVERY' });
  await assert.rejects(repository.createSession(a.user.id, 1, S.newSession(a.now), null), { code: 'AUTH_REQUIRED' });
  await assert.rejects(repository.putState(a.auth, write('revoked-session', 0), a.now), { code: 'AUTH_REQUIRED' });
  const current = await repository.findUser(a.user.username);
  assert.equal(current.authVersion, 2); assert.equal(current.passwordHash, 'new-password-hash');
  const session = S.newSession(a.now);
  await repository.createSession(a.user.id, current.authVersion, session, null);
  assert.equal((await repository.getSession(session.tokenHash, a.now)).user.id, a.user.id);
});

test('SQL password change and deletion revoke sessions and cascade only the chosen account data', async () => {
  const a = await account(), b = await account();
  await repository.putState(a.auth, write('account-a', 0), a.now);
  await repository.putState(b.auth, write('account-b', 0), b.now);
  await repository.changePassword(a.auth, a.user.passwordHash, 'changed-password', S.recoveryHash(S.randomToken()), a.now);
  assert.equal(await repository.getSession(a.session.tokenHash, a.now), null);
  const session = S.newSession(a.now);
  await repository.createSession(a.user.id, 2, session, null);
  const auth = await repository.getSession(session.tokenHash, a.now);
  await repository.deleteAccount(auth, 'changed-password', a.now);
  for (const table of ['sessions', 'documents', 'operations']) {
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM formday.' + table + ' WHERE user_id=$1', [a.user.id])).rows[0].count, 0);
  }
  assert.equal(await repository.findUser(a.user.username), null);
  assert.equal((await repository.getState(b.auth, b.now)).version, 1);
});

test('SQL limits persist across repository instances and operation-response retention is bounded', async () => {
  const now = Date.now(), rule = { key: S.digest('shared-user', 'test-rate'), limit: 2, windowMs: 60000 };
  const otherInstance = createPostgresRepository(pool);
  assert.equal(await repository.consumeRateLimits([rule], now), 0);
  assert.equal(await otherInstance.consumeRateLimits([rule], now), 0);
  assert.ok(await repository.consumeRateLimits([rule], now) > 0);
  const a = await account(), original = write('bounded-0', 0);
  for (let i = 0; i < 34; i++) await repository.putState(a.auth, i === 0 ? original : write('bounded-' + i, i), a.now + i);
  assert.equal((await pool.query('SELECT count(*)::integer AS count FROM formday.operations WHERE user_id=$1', [a.user.id])).rows[0].count, 32);
  await assert.rejects(repository.putState(a.auth, original, a.now), { code: 'CONFLICT' });
  assert.equal((await repository.getState(a.auth, a.now)).version, 34);
});

test('PostgreSQL filesystem persistence survives reopening the engine', async () => {
  const a = await account();
  await repository.putState(a.auth, write('persisted', 0, document('재시작 후 기록')), a.now);
  await repository.close();
  pool = bridge(await PGlite.create(directory));
  repository = createPostgresRepository(pool);
  assert.equal(await repository.ready(), true);
  assert.equal((await repository.getSession(a.session.tokenHash, a.now)).user.id, a.user.id);
  assert.equal((await repository.getState(a.auth, a.now)).state.events[0].title, '재시작 후 기록');
});
