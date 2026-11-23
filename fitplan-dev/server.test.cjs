'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createServer, MAX_AUTH_BYTES, MAX_STATE_BYTES, clientIP } = require('../fitplan-server/app.cjs');
const { createMemoryRepository } = require('../fitplan-server/memory-repository.cjs');
const { readConfig, databaseOptions } = require('../fitplan-server/config.cjs');
const S = require('../fitplan-server/security.cjs');
const C = require('../fitplan/core.js');
const ORIGIN = 'https://formday.test';
const PASSWORD = 'a long test password 123';
const NEXT_PASSWORD = 'a different test password 456';
const testPasswords = { async hash(value) { return 'test$' + crypto.createHash('sha256').update(value).digest('hex'); }, async verify(value, encoded) { return encoded === await this.hash(value); } };
const state = (title = '운동 기록') => C.normalizeState({ events: [{ id: 'event1', date: '2026-11-23', start: '07:00', end: '08:00', type: 'strength', title, repeat: 'none', completed: false, detail: { exercise: '벤치프레스', sets: 3, weight: 60, reps: 10, notes: '' } }], settings: { ...C.defaults } });

async function fixture(t, options = {}) {
  const repository = options.repository || createMemoryRepository(), logs = [];
  let now = Date.UTC(2026, 10, 23, 12);
  const server = createServer({ repository, publicOrigin: ORIGIN, passwords: options.passwords || testPasswords, clock: () => now, logger: entry => logs.push(entry) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(method, pathname, options = {}) {
    let raw = options.raw === undefined ? (['POST', 'PUT'].includes(method) ? JSON.stringify(options.body || {}) : null) : options.raw;
    const headers = { ...(['POST', 'PUT'].includes(method) ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...(raw === null ? {} : { 'Content-Length': Buffer.byteLength(raw) }), ...options.headers };
    for (const key of Object.keys(headers)) if (headers[key] === null || headers[key] === undefined) delete headers[key];
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method, headers, agent: false }, res => {
        const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
          resolve({ status: res.statusCode, headers: res.headers, text, body });
        });
      });
      req.on('error', reject); req.end(raw);
    });
  }
  async function register(username = 'alice', password = PASSWORD) {
    const result = await request('POST', '/api/auth/register', { body: { username, password } });
    assert.equal(result.status, 201);
    return session(result);
  }
  function session(result) {
    return { ...result.body, cookie: result.headers['set-cookie'][0].split(';')[0], async request(method, pathname, options = {}) {
      return request(method, pathname, { ...options, headers: { Cookie: this.cookie, 'X-CSRF-Token': this.csrfToken, 'X-Formday-User': this.user.id, ...options.headers } });
    } };
  }
  return { server, repository, request, register, session, logs, advance: ms => { now += ms; }, now: () => now };
}

test('configuration fails closed and limits the Render self-signed mode to its explicit private-host environment', () => {
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: ORIGIN, NODE_ENV: 'production' }), /DATABASE_URL/);
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: 'http://formday.test', DATABASE_URL: 'postgres://user:secret@example.com/db' }), /HTTPS/);
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: ORIGIN + '/', DATABASE_URL: 'postgres://user:secret@example.com/db' }), /origin/);
  assert.throws(() => databaseOptions({ NODE_ENV: 'production', DATABASE_TLS: 'disable', DATABASE_URL: 'postgres://user:secret@127.0.0.1/db' }));
  const external = databaseOptions({ NODE_ENV: 'production', DATABASE_URL: 'postgres://user:secret@example.com/db?sslmode=require' });
  assert.equal(external.ssl.rejectUnauthorized, true);
  assert.equal(new URL(external.connectionString).searchParams.has('sslmode'), false);
  const internal = { NODE_ENV: 'production', RENDER: 'true', DATABASE_TLS: 'render-internal', DATABASE_URL: 'postgres://user:secret@dpg-example123-a/db' };
  assert.equal(databaseOptions(internal).ssl.rejectUnauthorized, false);
  assert.equal(databaseOptions(internal).ssl.minVersion, 'TLSv1.2');
  assert.throws(() => databaseOptions({ ...internal, RENDER: 'false' }));
  assert.throws(() => databaseOptions({ ...internal, DATABASE_URL: 'postgres://user:secret@dpg-example123-a.postgres.render.com/db' }));
  assert.throws(() => createServer({ repository: null, publicOrigin: ORIGIN }));
});

test('real password hashing uses bounded memory-hard scrypt, fresh salts and constant-sized comparisons', async () => {
  const service = S.createPasswordService();
  const first = await service.hash(PASSWORD), second = await service.hash(PASSWORD);
  assert.match(first, /^scrypt\$131072\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await service.verify(PASSWORD, first), true);
  assert.equal(await service.verify(NEXT_PASSWORD, first), false);
  assert.equal(await service.verify(PASSWORD, null), false);
  assert.throws(() => S.password('too short'));
  assert.throws(() => S.password('x'.repeat(129)));
  assert.throws(() => S.password('x'.repeat(15) + '\ud800'));
});

test('account registration stores only credential/session hashes and returns a hardened host-only cookie', async t => {
  const app = await fixture(t), result = await app.request('POST', '/api/auth/register', { body: { username: 'ALIce', password: PASSWORD } });
  assert.equal(result.status, 201); assert.equal(result.body.user.username, 'alice');
  assert.match(result.body.recoveryCode, /^[A-Za-z0-9_-]{43}$/);
  const cookie = result.headers['set-cookie'][0];
  assert.match(cookie, /^__Host-FORMDAY_sid=/); assert.match(cookie, /; Path=\//); assert.match(cookie, /; Secure; HttpOnly; SameSite=Lax/); assert.doesNotMatch(cookie, /Domain=/);
  assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['x-content-type-options'], 'nosniff');
  const stored = JSON.stringify(app.repository.inspect()), rawToken = cookie.split(';')[0].split('=')[1];
  assert.ok(!stored.includes(PASSWORD)); assert.ok(!stored.includes(result.body.recoveryCode)); assert.ok(!stored.includes(rawToken));
  assert.equal(app.logs.length, 0);
  const session = await app.request('GET', '/api/auth/session', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(session.body.user.id, result.body.user.id); assert.equal(session.body.csrfToken, result.body.csrfToken);
  assert.equal((await app.request('GET', '/api/auth/session')).body.user, null);
});

test('registration, login and recovery reject absent or foreign Origin and non-JSON requests', async t => {
  const app = await fixture(t);
  for (const endpoint of ['register', 'login', 'recover']) {
    for (const origin of [null, 'null', 'https://formday.test.evil.example', 'http://formday.test']) {
      const result = await app.request('POST', '/api/auth/' + endpoint, { headers: { Origin: origin } });
      assert.equal(result.status, 403); assert.equal(result.body.error.code, 'ORIGIN_REJECTED');
    }
    const form = await app.request('POST', '/api/auth/' + endpoint, { headers: { 'Content-Type': 'text/plain' } });
    assert.equal(form.status, 415);
  }
  assert.equal(app.repository.inspect().users.length, 0);
});

test('state access requires its expected account owner and mutations also require session-bound CSRF', async t => {
  const app = await fixture(t), alice = await app.register('alice'), bob = await app.register('bobby');
  assert.equal((await app.request('GET', '/api/state')).status, 401);
  for (const owner of [null, bob.user.id]) {
    const mismatch = await alice.request('GET', '/api/state', { headers: { 'X-Formday-User': owner } });
    assert.equal(mismatch.status, 409); assert.equal(mismatch.body.error.code, 'ACCOUNT_CHANGED');
    assert.equal(mismatch.body.state, undefined); assert.equal(mismatch.body.userId, undefined); assert.equal(mismatch.body.version, undefined);
  }
  const body = { expectedVersion: 0, operationId: 'first', state: state() };
  for (const token of [null, 'wrong', bob.csrfToken]) assert.equal((await alice.request('PUT', '/api/state', { body, headers: { 'X-CSRF-Token': token } })).status, 403);
  // The browser's cookie can change in another tab while this tab still owns Alice's cache.
  const changedTab = await alice.request('GET', '/api/state', { headers: { Cookie: bob.cookie } });
  assert.equal(changedTab.body.error.code, 'ACCOUNT_CHANGED');
  assert.deepEqual((await alice.request('GET', '/api/state')).body, { userId: alice.user.id, version: 0, state: null, updatedAt: null });
});

test('user documents remain isolated and concurrent writes permit only one version winner', async t => {
  const app = await fixture(t), alice = await app.register('alice'), bob = await app.register('bobby');
  const [one, two] = await Promise.all([
    alice.request('PUT', '/api/state', { body: { userId: bob.user.id, expectedVersion: 0, operationId: 'one', state: state('첫 변경') } }),
    alice.request('PUT', '/api/state', { body: { expectedVersion: 0, operationId: 'two', state: state('두 번째 변경') } })
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  const conflict = one.status === 409 ? one : two;
  assert.equal(conflict.body.error.code, 'CONFLICT'); assert.equal(conflict.body.userId, alice.user.id); assert.equal(conflict.body.version, 1);
  assert.equal((await bob.request('GET', '/api/state')).body.state, null);
  assert.equal((await alice.request('GET', '/api/state')).body.version, 1);
});

test('lost-response retries return their original result and reused operation IDs cannot change a request', async t => {
  const app = await fixture(t), alice = await app.register('alice');
  const firstBody = { expectedVersion: 0, operationId: 'ack-lost', state: state('첫 기록') };
  const first = await alice.request('PUT', '/api/state', { body: firstBody });
  app.advance(1000);
  const second = await alice.request('PUT', '/api/state', { body: { expectedVersion: 1, operationId: 'newer', state: state('새 기록') } });
  assert.equal(second.body.version, 2);
  const retried = await alice.request('PUT', '/api/state', { body: firstBody });
  assert.deepEqual(retried.body, first.body);
  assert.equal((await alice.request('GET', '/api/state')).body.state.events[0].title, '새 기록');
  const changed = await alice.request('PUT', '/api/state', { body: { ...firstBody, state: state('바뀐 요청') } });
  assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(changed.body.userId, alice.user.id);
});

test('invalid state, invalid JSON, oversized bodies and unsupported strings never replace stored state', async t => {
  const app = await fixture(t), alice = await app.register('alice');
  await alice.request('PUT', '/api/state', { body: { expectedVersion: 0, operationId: 'valid', state: state() } });
  const invalid = state(); invalid.events[0].start = '99:00';
  assert.equal((await alice.request('PUT', '/api/state', { body: { expectedVersion: 1, operationId: 'invalid', state: invalid } })).status, 422);
  assert.equal((await alice.request('PUT', '/api/state', { raw: '{bad' })).status, 400);
  assert.equal((await alice.request('PUT', '/api/state', { raw: '{}', headers: { 'Content-Length': String(MAX_STATE_BYTES + 1) } })).status, 413);
  assert.equal((await app.request('POST', '/api/auth/register', { raw: 'x'.repeat(MAX_AUTH_BYTES + 1) })).status, 413);
  const badText = state(); badText.events[0].title = 'text\0nul';
  assert.equal((await alice.request('PUT', '/api/state', { body: { expectedVersion: 1, operationId: 'nul', state: badText } })).status, 422);
  assert.equal((await alice.request('GET', '/api/state')).body.version, 1);
});

test('recovery codes rotate once, revoke every old session and do not automatically log in', async t => {
  const app = await fixture(t), alice = await app.register('alice'), bob = await app.register('bobby');
  const login = await app.request('POST', '/api/auth/login', { body: { username: 'ALICE', password: PASSWORD } });
  const another = app.session(login);
  const recovered = await app.request('POST', '/api/auth/recover', { body: { username: 'alice', recoveryCode: alice.recoveryCode, newPassword: NEXT_PASSWORD } });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.body.recoveryCode, alice.recoveryCode);
  assert.equal(recovered.body.user, undefined); assert.equal(recovered.body.csrfToken, undefined);
  for (const session of [alice, another]) assert.equal((await session.request('GET', '/api/auth/session')).body.user, null);
  assert.equal((await bob.request('GET', '/api/auth/session')).body.user.id, bob.user.id);
  assert.equal((await app.request('POST', '/api/auth/recover', { body: { username: 'alice', recoveryCode: alice.recoveryCode, newPassword: PASSWORD } })).status, 401);
  assert.equal((await app.request('POST', '/api/auth/login', { body: { username: 'alice', password: PASSWORD } })).status, 401);
  assert.equal((await app.request('POST', '/api/auth/login', { body: { username: 'alice', password: NEXT_PASSWORD } })).status, 200);
});

test('a password reset racing an in-flight login cannot create a new session with the old credentials', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const service = { ...testPasswords, async verify(value, encoded) { entered(); await gate; return testPasswords.verify(value, encoded); } };
  const app = await fixture(t, { passwords: service }), alice = await app.register('alice');
  const pending = app.request('POST', '/api/auth/login', { body: { username: 'alice', password: PASSWORD } });
  await waiting;
  const recovery = await app.request('POST', '/api/auth/recover', { body: { username: 'alice', recoveryCode: alice.recoveryCode, newPassword: NEXT_PASSWORD } });
  assert.equal(recovery.status, 200);
  release();
  const staleLogin = await pending;
  assert.equal(staleLogin.status, 401); assert.equal(staleLogin.body.error.code, 'AUTH_REQUIRED');
  assert.equal(app.repository.inspect().sessions.length, 0);
});

test('password changes rotate recovery credentials and account deletion removes only the authenticated account', async t => {
  const app = await fixture(t), alice = await app.register('alice'), bob = await app.register('bobby');
  await alice.request('PUT', '/api/state', { body: { expectedVersion: 0, operationId: 'alice-state', state: state() } });
  await bob.request('PUT', '/api/state', { body: { expectedVersion: 0, operationId: 'bob-state', state: state('다른 계정') } });
  assert.equal((await alice.request('POST', '/api/auth/password', { body: { currentPassword: NEXT_PASSWORD, newPassword: NEXT_PASSWORD } })).status, 401);
  const changed = await alice.request('POST', '/api/auth/password', { body: { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD } });
  assert.equal(changed.status, 200); assert.ok(changed.body.recoveryCode);
  assert.equal((await alice.request('GET', '/api/auth/session')).body.user, null);
  const next = app.session(await app.request('POST', '/api/auth/login', { body: { username: 'alice', password: NEXT_PASSWORD } }));
  assert.equal((await next.request('POST', '/api/auth/delete', { body: { password: PASSWORD } })).status, 401);
  assert.equal((await next.request('POST', '/api/auth/delete', { body: { password: NEXT_PASSWORD } })).status, 204);
  assert.equal((await next.request('GET', '/api/auth/session')).body.user, null);
  assert.equal((await bob.request('GET', '/api/state')).body.state.events[0].title, '다른 계정');
  assert.equal(app.repository.inspect().users.length, 1);
});

test('logout returns 204, expires the cookie and session expiration never grants document access', async t => {
  const app = await fixture(t), alice = await app.register('alice');
  const response = await alice.request('POST', '/api/auth/logout');
  assert.equal(response.status, 204); assert.equal(response.body, null); assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await alice.request('GET', '/api/state')).status, 401);
  const login = app.session(await app.request('POST', '/api/auth/login', { body: { username: 'alice', password: PASSWORD } }));
  app.advance(S.SESSION_TTL_MS + 1);
  assert.equal((await login.request('GET', '/api/auth/session')).body.user, null);
  assert.equal((await login.request('GET', '/api/state')).status, 401);
});

test('persistent per-account rate limits stop repeated guesses without trusting spoofed forwarding headers', async t => {
  const app = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await app.request('POST', '/api/auth/login', { body: { username: 'notfound', password: PASSWORD }, headers: { 'X-Forwarded-For': '203.0.113.' + i } })).status, 401);
  const limited = await app.request('POST', '/api/auth/login', { body: { username: 'notfound', password: PASSWORD } });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal(clientIP({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '192.0.2.9, 203.0.113.1' } }, 0), '127.0.0.1');
  assert.equal(clientIP({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '192.0.2.9, 203.0.113.1' } }, 1), '203.0.113.1');
});

test('database errors are sanitized and static serving cannot disclose server source or credentials', async t => {
  const repository = createMemoryRepository();
  repository.findUser = async () => { throw new Error('private-password database connection string'); };
  repository.ready = async () => { throw new Error('private-database-url'); };
  const app = await fixture(t, { repository });
  const error = await app.request('POST', '/api/auth/login', { body: { username: 'alice', password: PASSWORD } });
  assert.equal(error.status, 503); assert.doesNotMatch(error.text, /private-password|database connection string/);
  assert.doesNotMatch(JSON.stringify(app.logs), /private-|password|alice/);
  assert.equal((await app.request('GET', '/healthz')).status, 200);
  assert.equal((await app.request('GET', '/readyz')).status, 503);
  assert.equal((await app.request('GET', '/')).status, 200);
  assert.equal((await app.request('GET', '/app.js')).status, 200);
  for (const pathname of ['/../fitplan-server/server.cjs', '/%2e%2e/fitplan-server/config.cjs', '/.env', '/%2eenv', '/node_modules/pg/package.json']) assert.equal((await app.request('GET', pathname)).status, 404);
});
