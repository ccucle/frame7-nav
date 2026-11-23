'use strict';

// Node HTTP contract tests. Requests reach the real app.cjs routes on loopback.
// The jar deliberately transports Secure cookies over test HTTP: this does NOT
// verify browser cookie enforcement, HTTPS, or Render's external rewrite proxy.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('../fitplan-server/app.cjs');
const { createMemoryRepository } = require('../fitplan-server/memory-repository.cjs');
const { COOKIE_NAME, SESSION_TTL_MS } = require('../fitplan-server/security.cjs');
const C = require('../fitplan/core.js');
const Cloud = require('../fitplan/cloud.js');

const ORIGIN = 'https://formday.test';
const PASSWORD = 'http-contract-passphrase-123';
const clone = value => structuredClone(value);
const empty = () => C.normalizeState({ events: [], settings: { ...C.defaults }, demo: false });
const weight = (id, value = 80) => ({ id, title: '체중 ' + id, type: 'weight', date: '2026-11-23', start: '07:00', end: '07:05', repeat: 'none', completed: true, detail: { weight: value, bodyfat: null } });
const stateOf = (...events) => C.normalizeState({ ...empty(), events });
const sortedObject = value => Array.isArray(value) ? value.map(sortedObject) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedObject(value[key])])) : value;
function memory() {
  const map = new Map();
  return { map, getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

async function fixture(t, { reorderStoredKeys = false } = {}) {
  const repository = createMemoryRepository();
  if (reorderStoredKeys) {
    const original = repository.putState.bind(repository);
    repository.putState = async (...args) => sortedObject(await original(...args));
  }
  // Password hashing strength is covered by the server's security tests. The
  // lightweight adapter here keeps these tests focused on HTTP/client contracts.
  const encoded = text => 'http-test-only:' + crypto.createHash('sha256').update(text).digest('hex');
  const passwords = { async hash(text) { return encoded(text); }, async verify(text, hash) { return typeof hash === 'string' && encoded(text) === hash; } };
  let clock = Date.now();
  const server = createServer({ repository, publicOrigin: ORIGIN, passwords, clock: () => clock });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.cloud.destroy());
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await repository.close();
  });

  function jar() {
    const cookies = new Map();
    const channel = { cookies, calls: [], dropNextSuccessfulPut: false };
    channel.fetch = async (route, options = {}) => {
      assert.equal(options.credentials, 'same-origin');
      const headers = new Headers(options.headers);
      headers.set('Origin', ORIGIN);
      headers.set('Sec-Fetch-Site', 'same-origin');
      if (cookies.size) headers.set('Cookie', [...cookies].map(([name, value]) => name + '=' + value).join('; '));
      const call = { path: route, method: options.method || 'GET', owner: headers.get('X-Formday-User'), body: options.body === undefined ? undefined : JSON.parse(options.body) };
      channel.calls.push(call);
      const response = await fetch(baseURL + route, { ...options, headers });
      call.status = response.status; call.cacheControl = response.headers.get('Cache-Control');
      const cookieHeaders = response.headers.getSetCookie();
      call.setCookie = cookieHeaders;
      for (const value of cookieHeaders) {
        assert.match(value, /; Secure(?:;|$)/);
        assert.match(value, /; HttpOnly(?:;|$)/);
        assert.match(value, /; SameSite=Lax(?:;|$)/);
        assert.match(value, /; Path=\/(?:;|$)/);
        assert.doesNotMatch(value, /; Domain=/i);
        const pair = value.slice(0, value.indexOf(';')), equal = pair.indexOf('='), name = pair.slice(0, equal), token = pair.slice(equal + 1);
        if (/; Max-Age=0(?:;|$)/.test(value)) cookies.delete(name); else cookies.set(name, token);
      }
      if (route === '/api/state' && options.method === 'PUT' && response.ok && channel.dropNextSuccessfulPut) {
        channel.dropNextSuccessfulPut = false;
        await response.arrayBuffer(); // The server committed; only its response is lost to the client.
        throw new Error('test connection lost after committed PUT');
      }
      return response;
    };
    return channel;
  }

  function client({ channel = jar(), storage = memory(), guest = stateOf(weight('guest')) } = {}) {
    const guestStore = C.makeStore(storage);
    if (storage.getItem(C.STORE) === null) guestStore.save(guest, '');
    const h = { channel, storage, view: guestStore.load().data, store: guestStore, activated: 0, returnedToGuest: 0 };
    h.cloud = Cloud.create({ core: C, storage, fetch: channel.fetch, debounceMs: 100000,
      getLocal: () => h.view, canSwitch: () => true,
      onActivate({ state, store, user }) { h.view = state; h.store = store; h.user = user; h.activated++; },
      onGuest() { h.store = guestStore; h.view = guestStore.load().data; h.returnedToGuest++; }
    });
    h.save = state => { h.view = h.store.save(state, h.view.revision); h.cloud.afterLocalSave(h.view); };
    clients.push(h);
    return h;
  }
  return { repository, client, jar, advance(ms) { clock += ms; }, document(userId) { return repository.inspect().documents.find(([id]) => id === userId)[1]; } };
}
const puts = client => client.channel.calls.filter(call => call.path === '/api/state' && call.method === 'PUT');
async function register(client, username) {
  await client.cloud.init();
  return client.cloud.register({ username, password: PASSWORD });
}
function assertNoSecrets(client, secrets) {
  const persisted = [...client.storage.map.values()].join('\n');
  for (const secret of secrets) if (secret) assert.equal(persisted.includes(secret), false);
}

test('Node HTTP: explicit guest upload, second-device pull, edits, CAS conflict resolution, and 204 logout', async t => {
  const f = await fixture(t), a = f.client({ guest: stateOf(weight('device-a-guest', 82)) }), b = f.client({ guest: stateOf(weight('device-b-guest', 72)) });
  a.storage.setItem(C.STORE + '_previous', 'device A guest backup');
  b.storage.setItem(C.STORE + '_previous', 'device B guest backup');
  const guestA = a.storage.getItem(C.STORE), guestB = b.storage.getItem(C.STORE);
  const auth = await register(a, 'shared_account');
  assert.equal(a.cloud.status().selectionRequired, true); assert.equal(a.cloud.status().active, false);
  assert.equal(f.document(auth.user.id).state, null); assert.equal(puts(a).length, 0);
  await a.cloud.selectSource('local');
  assert.equal(f.document(auth.user.id).version, 1); assert.equal(f.document(auth.user.id).state.events[0].id, 'device-a-guest');
  assert.equal(a.cloud.status().dirty, false);

  await b.cloud.init();
  await b.cloud.login({ username: 'SHARED_ACCOUNT', password: PASSWORD });
  assert.equal(b.cloud.status().selectionRequired, true); assert.equal(b.view.events[0].id, 'device-b-guest');
  await b.cloud.selectSource('cloud');
  assert.equal(b.view.events[0].id, 'device-a-guest'); assert.equal(puts(b).length, 0);
  assert.notEqual(a.channel.cookies.get(COOKIE_NAME), b.channel.cookies.get(COOKIE_NAME));

  b.save(stateOf(weight('edited-on-b', 79))); await b.cloud.syncNow();
  assert.equal(f.document(auth.user.id).version, 2);
  await a.cloud.syncNow(); assert.equal(a.view.events[0].id, 'edited-on-b');
  a.save(stateOf(weight('concurrent-a', 78))); b.save(stateOf(weight('concurrent-b', 77)));
  await a.cloud.syncNow();
  await assert.rejects(b.cloud.syncNow(), { code: 'CONFLICT' });
  assert.equal(b.cloud.status().conflict, true); assert.equal(b.cloud.status().dirty, true);
  assert.equal(b.view.events[0].id, 'concurrent-b'); assert.equal(f.document(auth.user.id).state.events[0].id, 'concurrent-a');
  assert.equal(puts(b).at(-1).status, 409); assert.equal(b.cloud.status().remoteCount, 1);
  await b.cloud.resolveConflict('local');
  assert.equal(puts(b).at(-1).body.expectedVersion, 3); assert.equal(f.document(auth.user.id).version, 4);
  assert.equal(b.cloud.status().dirty, false); assert.equal(b.cloud.status().conflict, false);
  await a.cloud.syncNow(); assert.equal(a.view.events[0].id, 'concurrent-b');

  const sessionToken = a.channel.cookies.get(COOKIE_NAME);
  assertNoSecrets(a, [PASSWORD, auth.recoveryCode, sessionToken]);
  for (const call of [...a.channel.calls, ...b.channel.calls]) assert.equal(call.cacheControl, 'no-store');
  assert.ok(puts(a).every(call => call.owner === auth.user.id));
  await a.cloud.logout();
  assert.equal(a.channel.calls.at(-1).status, 204); assert.equal(a.channel.cookies.has(COOKIE_NAME), false);
  assert.equal(a.cloud.status().user, null); assert.equal(a.returnedToGuest, 1);
  assert.equal(a.storage.getItem(C.STORE), guestA); assert.equal(a.storage.getItem(C.STORE + '_previous'), 'device A guest backup');
  await b.cloud.syncNow(); // Logging out A did not invalidate B's independent session.
  await b.cloud.logout();
  assert.equal(b.storage.getItem(C.STORE), guestB); assert.equal(b.storage.getItem(C.STORE + '_previous'), 'device B guest backup');
  assert.equal(f.document(auth.user.id).version, 4); // Device logout did not delete account data.
});

test('Node HTTP: a committed response lost in transit is idempotently retried before newer offline work', async t => {
  const f = await fixture(t), a = f.client(); const auth = await register(a, 'response_retry');
  await a.cloud.selectSource('cloud');
  a.save(stateOf(weight('first-upload', 80))); a.channel.dropNextSuccessfulPut = true;
  await assert.rejects(a.cloud.syncNow(), { code: 'NETWORK_ERROR' });
  const original = clone(puts(a).at(-1).body);
  assert.equal(f.document(auth.user.id).version, 1); assert.equal(a.cloud.status().dirty, true);
  a.save(stateOf(weight('newer-offline', 79))); a.cloud.destroy();
  const restored = f.client({ channel: a.channel, storage: a.storage });
  const beforeInit = puts(restored).length;
  await restored.cloud.init();
  assert.equal(restored.cloud.status().active, true); assert.equal(restored.view.events[0].id, 'newer-offline'); assert.equal(puts(restored).length, beforeInit);
  await restored.cloud.syncNow();
  assert.deepEqual(puts(restored).at(-1).body, original); assert.equal(f.document(auth.user.id).version, 1);
  assert.equal(restored.cloud.status().dirty, true); assert.equal(restored.view.events[0].id, 'newer-offline');
  await restored.cloud.syncNow();
  assert.equal(puts(restored).at(-1).body.expectedVersion, 1); assert.notEqual(puts(restored).at(-1).body.operationId, original.operationId);
  assert.equal(f.document(auth.user.id).version, 2); assert.equal(f.document(auth.user.id).state.events[0].id, 'newer-offline');
  assert.equal(restored.cloud.status().dirty, false);
});

test('Node HTTP: recovery revokes old sessions and same-account login preserves a pending edit', async t => {
  const f = await fixture(t), a = f.client(), recovery = f.client(); const auth = await register(a, 'recover_account');
  await a.cloud.selectSource('cloud'); a.save(stateOf(weight('offline-before-recovery', 76)));
  await recovery.cloud.init();
  const nextPassword = 'replacement-http-passphrase-456';
  const result = await recovery.cloud.recover({ username: 'recover_account', recoveryCode: auth.recoveryCode, newPassword: nextPassword });
  assert.notEqual(result.recoveryCode, auth.recoveryCode); assert.equal(recovery.cloud.status().user, null);
  await assert.rejects(a.cloud.syncNow(), { code: 'AUTH_REQUIRED' });
  assert.equal(a.cloud.status().reauthRequired, true); assert.equal(a.cloud.status().dirty, true);
  assert.equal(a.view.events[0].id, 'offline-before-recovery');
  await a.cloud.login({ username: 'recover_account', password: nextPassword });
  assert.equal(a.cloud.status().reauthRequired, false); assert.equal(a.cloud.status().active, true);
  await a.cloud.syncNow();
  assert.equal(f.document(auth.user.id).state.events[0].id, 'offline-before-recovery'); assert.equal(a.cloud.status().dirty, false);
  assertNoSecrets(a, [PASSWORD, nextPassword, auth.recoveryCode, result.recoveryCode, a.channel.cookies.get(COOKIE_NAME)]);
  assertNoSecrets(recovery, [auth.recoveryCode, result.recoveryCode, nextPassword]);
});

test('Node HTTP: expired-session resume and an account change in a shared cookie jar fail without replacing local records', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); const authA = await register(a, 'owner_alice');
  await a.cloud.selectSource('local');
  f.advance(SESSION_TTL_MS + 1); await a.cloud.init();
  assert.equal(a.cloud.status().reauthRequired, true); assert.equal(a.cloud.status().active, true);
  await a.cloud.login({ username: 'owner_alice', password: PASSWORD });
  const authB = await register(b, 'owner_bobby'); await b.cloud.selectSource('cloud'); b.save(stateOf(weight('b-private', 90))); await b.cloud.syncNow();
  const oldState = clone(a.view);
  // This is the cookie change an independent tab's login can cause. The real
  // server sees B's session while A still sends X-Formday-User for A.
  a.channel.cookies.set(COOKIE_NAME, b.channel.cookies.get(COOKIE_NAME));
  await assert.rejects(a.cloud.syncNow(), { code: 'ACCOUNT_CHANGED' });
  assert.equal(a.cloud.status().reauthRequired, true); assert.deepEqual(a.view, oldState);
  assert.equal(a.cloud.status().user.id, authA.user.id); assert.notEqual(a.cloud.status().user.id, authB.user.id);
});

test('Node HTTP: semantically identical stored objects with reordered date keys acknowledge successfully', async t => {
  const f = await fixture(t, { reorderStoredKeys: true }), a = f.client(); const auth = await register(a, 'jsonb_order');
  await a.cloud.selectSource('cloud');
  const later = { ...weight('ignored', 78), date: '2026-11-25' }, earlier = { ...weight('ignored', 79), date: '2026-11-24' };
  const repeated = { ...weight('recurring', 80), repeat: 'daily', occurrences: { '2026-11-25': later, '2026-11-24': earlier } };
  a.save(stateOf(repeated));
  assert.deepEqual(Object.keys(a.view.events[0].occurrences), ['2026-11-25', '2026-11-24']);
  await a.cloud.syncNow();
  assert.equal(a.cloud.status().dirty, false); assert.equal(a.cloud.status().error, '');
  assert.equal(f.document(auth.user.id).version, 1);
  assert.equal(a.view.events[0].occurrences['2026-11-24'].detail.weight, 79);
  assert.equal(a.view.events[0].occurrences['2026-11-25'].detail.weight, 78);
});

test('Node HTTP: session expiry before source selection permits the displayed same-account login', async t => {
  const f = await fixture(t), a = f.client(); const auth = await register(a, 'selection_expiry');
  const guestRaw = a.storage.getItem(C.STORE);
  assert.equal(a.cloud.status().active, false); assert.equal(a.cloud.status().selectionRequired, true);
  f.advance(SESSION_TTL_MS + 1);
  await assert.rejects(a.cloud.selectSource('cloud'), { code: 'AUTH_REQUIRED' });
  assert.equal(a.cloud.status().reauthRequired, true); assert.equal(a.cloud.status().active, false);
  await a.cloud.login({ username: 'selection_expiry', password: PASSWORD });
  assert.equal(a.cloud.status().reauthRequired, false); assert.equal(a.cloud.status().selectionRequired, true);
  assert.equal(a.cloud.status().active, false); assert.equal(a.activated, 0);
  await a.cloud.selectSource('local');
  assert.equal(a.cloud.status().active, true); assert.equal(f.document(auth.user.id).version, 1);
  assert.equal(a.storage.getItem(C.STORE), guestRaw);
});
