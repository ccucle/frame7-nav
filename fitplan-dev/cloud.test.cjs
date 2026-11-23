'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../fitplan/core.js');
const Cloud = require('../fitplan/cloud.js');

const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => C.normalizeState({ events: [], settings: { ...C.defaults }, demo: false });
const event = (id = 'weight1', weight = 80) => ({ id, type: 'weight', title: '체중 ' + id, date: '2026-11-23', start: '07:00', end: '07:05', repeat: 'none', completed: true, detail: { weight, bodyfat: null } });
const withEvents = (...events) => C.normalizeState({ ...empty(), events });
function memory() {
  const map = new Map();
  const storage = { map, fail: null, getItem(key) { return map.has(key) ? map.get(key) : null; }, setItem(key, value) { if (storage.fail && storage.fail(key, value)) throw new Error('quota'); map.set(key, String(value)); }, removeItem(key) { if (storage.fail && storage.fail(key, null)) throw new Error('quota'); map.delete(key); } };
  return storage;
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const response = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (status === 204) throw new Error('empty JSON'); return copy(value); } });

function backend() {
  const users = new Map(), records = new Map(), operations = new Map();
  const api = { users, records, operations, calls: [], session: null, enabled: true, failConfig: false, beforePut: null, afterPut: null, beforeGet: null, beforeLogout: null, logoutStatus: 204 };
  const err = (status, code, message, more = {}) => response(status, { error: { code, message: message || code }, ...more });
  const csrf = user => 'private-csrf-' + user.id;
  const auth = user => ({ user: { id: user.id, username: user.username }, csrfToken: csrf(user) });
  api.add = username => { const user = { id: 'user-' + (users.size + 1), username, password: 'private-password-123' }; users.set(username, user); records.set(user.id, { version: 0, state: null, updatedAt: null }); return user; };
  api.setRemote = (user, state) => { const old = records.get(user.id); records.set(user.id, { version: old.version + 1, state: C.normalizeState(state), updatedAt: new Date().toISOString() }); };
  api.fetch = async (path, request) => {
    const body = request.body === undefined ? undefined : JSON.parse(request.body);
    api.calls.push({ path, method: request.method, headers: { ...request.headers }, credentials: request.credentials, body });
    assert.equal(request.credentials, 'same-origin');
    if (path === '/api/config') { if (api.failConfig) throw new Error('not installed'); return response(200, { enabled: api.enabled, apiVersion: 1 }); }
    if (path === '/api/auth/session') return response(200, api.session ? auth(api.session) : { user: null });
    if (path === '/api/auth/register') {
      if (users.has(body.username)) return err(409, 'USERNAME_TAKEN');
      const user = api.add(body.username.toLowerCase()); user.password = body.password; api.session = user;
      return response(201, { ...auth(user), recoveryCode: 'private-recovery-register' });
    }
    if (path === '/api/auth/login') {
      const user = users.get(body.username.toLowerCase());
      if (!user || user.password !== body.password) return err(401, 'INVALID_CREDENTIALS');
      api.session = user; return response(200, auth(user));
    }
    if (path === '/api/auth/recover') { api.session = null; return response(200, { recoveryCode: 'private-recovery-new' }); }
    if (!api.session) return err(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
    const user = api.session;
    if (request.method !== 'GET' && request.headers['X-CSRF-Token'] !== csrf(user)) return err(403, 'CSRF_INVALID');
    if (path === '/api/auth/logout') {
      const hook = api.beforeLogout; api.beforeLogout = null; if (hook) await hook();
      api.session = null; return response(api.logoutStatus, {});
    }
    if (path !== '/api/state') return err(404, 'NOT_FOUND');
    if (request.headers['X-Formday-User'] !== user.id) return err(409, 'ACCOUNT_CHANGED', '다른 계정이 로그인되어 있습니다.');
    if (request.method === 'GET') {
      const hook = api.beforeGet; api.beforeGet = null; if (hook) await hook();
      return response(200, { userId: user.id, ...records.get(user.id) });
    }
    const hook = api.beforePut; api.beforePut = null; if (hook) await hook(body);
    const key = user.id + ':' + body.operationId;
    const existing = operations.get(key), current = records.get(user.id);
    if (existing) {
      if (JSON.stringify(body) !== existing.request) return err(409, 'IDEMPOTENCY_CONFLICT', '다른 요청 식별자', { userId: user.id, version: current.version });
      return response(200, existing.result);
    }
    if (body.expectedVersion !== current.version) return err(409, 'CONFLICT', '다른 기기에서 변경되었습니다.', { userId: user.id, version: current.version });
    const result = { userId: user.id, version: current.version + 1, state: C.normalizeState(body.state), updatedAt: new Date().toISOString() };
    records.set(user.id, { version: result.version, state: result.state, updatedAt: result.updatedAt });
    operations.set(key, { request: JSON.stringify(body), result: copy(result) });
    const after = api.afterPut; api.afterPut = null; if (after) await after(body);
    return response(200, result);
  };
  return api;
}

function harness(api = backend(), storage = memory(), options = {}) {
  const guestStore = C.makeStore(storage);
  if (storage.getItem(C.STORE) === null && options.seed !== false) guestStore.save(options.guest || withEvents(event('guest', 82)), '');
  const h = { api, storage, activations: [], guestReturns: 0, statuses: [], canSwitch: true, view: guestStore.load().data || empty(), store: guestStore };
  h.cloud = Cloud.create({ core: C, storage, fetch: api.fetch, getLocal: () => h.view, canSwitch: () => h.canSwitch, debounceMs: 100000, ...options,
    onActivate(payload) { h.activations.push(payload); h.view = payload.state; h.store = payload.store; },
    onGuest() { h.guestReturns++; h.store = guestStore; h.view = guestStore.load().data || empty(); },
    onStatus(status) { h.statuses.push(status); }
  });
  h.save = state => { const saved = h.store.save(state, h.view.revision); h.view = saved; h.cloud.afterLocalSave(saved); return saved; };
  h.meta = user => { const id = user || h.cloud.status().user.id; const key = C.STORE + '_cloud_v1_' + id + ':sync'; return { key, value: JSON.parse(storage.getItem(key)) }; };
  h.dataKey = user => C.STORE + '_cloud_v1_' + (user || h.cloud.status().user.id) + ':' + C.STORE;
  return h;
}
async function signed(h, name = 'alice', source = 'cloud') {
  await h.cloud.init();
  const auth = await h.cloud.register({ username: name, password: 'private-password-123' });
  await h.cloud.selectSource(source);
  return auth.user;
}
const puts = api => api.calls.filter(call => call.path === '/api/state' && call.method === 'PUT');

test('an absent or disabled API keeps guest records and their backup byte-for-byte', async t => {
  for (const disabled of [false, true]) {
    const api = backend(); api.enabled = !disabled; api.failConfig = !disabled;
    const h = harness(api); t.after(() => h.cloud.destroy());
    h.storage.setItem(C.STORE + '_previous', 'guest backup bytes');
    const initial = [...h.storage.map];
    const result = await h.cloud.init();
    assert.equal(result.available, false); assert.equal(result.active, false); assert.equal(result.error, '');
    assert.deepEqual([...h.storage.map], initial); assert.equal(h.activations.length, 0);
    assert.equal(h.cloud.isActiveStorageKey(C.STORE), true);
    assert.equal(h.cloud.isActiveStorageKey(C.STORE + '_previous'), false);
  }
});

test('registration requires a source choice, isolates account writes, and 204 logout restores untouched guest records', async t => {
  const h = harness(); t.after(() => h.cloud.destroy());
  h.storage.setItem(C.STORE + '_previous', 'previous guest data');
  const guestRaw = h.storage.getItem(C.STORE), guestBackup = h.storage.getItem(C.STORE + '_previous');
  await h.cloud.init();
  const registered = await h.cloud.register({ username: 'alice', password: 'private-password-123' });
  assert.equal(registered.recoveryCode, 'private-recovery-register');
  assert.equal(h.cloud.status().selectionRequired, true); assert.equal(h.cloud.status().active, false);
  assert.equal(puts(h.api).length, 0); assert.equal(h.activations.length, 0);
  await h.cloud.selectSource('local');
  assert.equal(h.view.events[0].id, 'guest'); assert.equal(h.cloud.status().dirty, false);
  assert.equal(h.cloud.isActiveStorageKey(C.STORE), false); assert.equal(h.cloud.isActiveStorageKey(h.dataKey()), true);
  const dataKey = h.dataKey();
  h.save(withEvents(event('account', 79))); await h.cloud.syncNow();
  assert.equal(h.api.records.get(registered.user.id).state.events[0].id, 'account');
  for (const value of h.storage.map.values()) assert.doesNotMatch(value, /private-password|private-csrf|private-recovery/);
  await h.cloud.logout();
  assert.equal(h.storage.getItem(dataKey), null); assert.equal(h.guestReturns, 1);
  assert.equal(h.storage.getItem(C.STORE), guestRaw); assert.equal(h.storage.getItem(C.STORE + '_previous'), guestBackup);
  assert.equal(h.view.events[0].id, 'guest'); assert.equal(h.cloud.status().user, null);
});

test('same-origin cookie switches cannot apply another account state to an old active cache', async t => {
  const api = backend(), storage = memory(), a = harness(api, storage); t.after(() => a.cloud.destroy());
  const alice = await signed(a); a.save(withEvents(event('alice-private', 75)));
  const aliceRaw = storage.getItem(a.dataKey(alice.id));
  const bob = api.add('bob'); api.session = bob; api.setRemote(bob, withEvents(event('bob-private', 95)));
  const b = harness(api, storage); t.after(() => b.cloud.destroy());
  await b.cloud.init(); assert.equal(b.cloud.status().selectionRequired, true); assert.equal(b.cloud.status().active, false);
  await b.cloud.selectSource('cloud'); assert.equal(b.view.events[0].id, 'bob-private');
  await assert.rejects(a.cloud.syncNow(), error => ['CSRF_INVALID', 'ACCOUNT_CHANGED'].includes(error.code));
  assert.equal(a.cloud.status().reauthRequired, true);
  assert.equal(a.view.events[0].id, 'alice-private'); assert.equal(storage.getItem(a.dataKey(alice.id)), aliceRaw);
  await b.cloud.logout();
  assert.equal(storage.getItem(a.dataKey(alice.id)), aliceRaw); assert.equal(storage.getItem(b.dataKey(bob.id)), null);
});

test('409 conflicts keep local work and require an explicit cloud or local decision', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  h.save(withEvents(event('local', 78))); h.api.setRemote(user, withEvents(event('other-device', 77)));
  await assert.rejects(h.cloud.syncNow(), { code: 'CONFLICT' });
  assert.equal(h.cloud.status().conflict, true); assert.equal(h.view.events[0].id, 'local');
  const requests = puts(h.api).length;
  await assert.rejects(h.cloud.syncNow(), { code: 'CONFLICT' }); assert.equal(puts(h.api).length, requests);
  await h.cloud.resolveConflict('cloud');
  assert.equal(h.view.events[0].id, 'other-device'); assert.equal(h.cloud.status().dirty, false); assert.equal(h.cloud.status().conflict, false);
});

test('local conflict resolution uses the newest GET version and another concurrent write returns to conflict', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  h.save(withEvents(event('mine'))); h.api.setRemote(user, withEvents(event('theirs')));
  await assert.rejects(h.cloud.syncNow(), { code: 'CONFLICT' });
  h.api.beforePut = async () => h.api.setRemote(user, withEvents(event('third')));
  await assert.rejects(h.cloud.resolveConflict('local'), { code: 'CONFLICT' });
  assert.equal(puts(h.api).at(-1).body.expectedVersion, 1);
  assert.equal(h.view.events[0].id, 'mine'); assert.equal(h.api.records.get(user.id).state.events[0].id, 'third');
  await h.cloud.resolveConflict('local');
  assert.equal(puts(h.api).at(-1).body.expectedVersion, 2);
  assert.equal(h.api.records.get(user.id).state.events[0].id, 'mine'); assert.equal(h.cloud.status().conflict, false);
});

test('lost successful responses persist the exact operation and replay it before newer offline edits', async t => {
  const api = backend(), storage = memory(), h = harness(api, storage); t.after(() => h.cloud.destroy());
  const user = await signed(h); h.save(withEvents(event('first', 80)));
  api.afterPut = async () => { throw new Error('response disconnected after commit'); };
  await assert.rejects(h.cloud.syncNow(), { code: 'NETWORK_ERROR' });
  const first = copy(puts(api).at(-1).body); assert.equal(api.records.get(user.id).version, 1);
  h.save(withEvents(event('newer-offline', 79))); h.cloud.destroy();
  const reloaded = harness(api, storage); t.after(() => reloaded.cloud.destroy()); const beforeInit = puts(api).length;
  await reloaded.cloud.init();
  assert.equal(puts(api).length, beforeInit); assert.equal(reloaded.view.events[0].id, 'newer-offline'); assert.equal(reloaded.cloud.status().dirty, true);
  await reloaded.cloud.syncNow();
  assert.deepEqual(puts(api).at(-1).body, first); assert.equal(reloaded.cloud.status().dirty, true);
  assert.equal(reloaded.meta().value.ackRemoteVersion, 1); assert.equal(reloaded.view.events[0].id, 'newer-offline');
  await reloaded.cloud.syncNow();
  assert.notEqual(puts(api).at(-1).body.operationId, first.operationId); assert.equal(puts(api).at(-1).body.expectedVersion, 1);
  assert.equal(api.records.get(user.id).state.events[0].id, 'newer-offline'); assert.equal(reloaded.cloud.status().dirty, false);
});

test('a save made during a PUT remains dirty and duplicate flushes share one request', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  h.save(withEvents(event('first')));
  const gate = deferred(), entered = deferred(); h.api.beforePut = async () => { entered.resolve(); await gate.promise; };
  const first = h.cloud.syncNow(); await entered.promise; const duplicate = h.cloud.syncNow();
  h.save(withEvents(event('second'))); gate.resolve(); await Promise.all([first, duplicate]);
  assert.equal(puts(h.api).length, 1); assert.equal(h.cloud.status().dirty, true); assert.equal(h.view.events[0].id, 'second');
  assert.equal(h.meta().value.ackRemoteVersion, 1);
  await h.cloud.syncNow(); assert.equal(h.api.records.get(user.id).state.events[0].id, 'second'); assert.equal(h.cloud.status().dirty, false);
});

test('another tab editing the same account during a PUT cannot have its dirty marker cleared', async t => {
  const api = backend(), storage = memory(), a = harness(api, storage); t.after(() => a.cloud.destroy());
  await signed(a); a.save(withEvents(event('first')));
  const gate = deferred(), entered = deferred(); api.beforePut = async () => { entered.resolve(); await gate.promise; };
  const pushing = a.cloud.syncNow(); await entered.promise;
  const b = harness(api, storage); t.after(() => b.cloud.destroy()); await b.cloud.init(); b.save(withEvents(event('second-tab')));
  gate.resolve(); await pushing;
  assert.equal(a.meta().value.dirty, true); assert.equal(a.meta().value.ackRemoteVersion, 1);
  assert.equal(JSON.parse(storage.getItem(a.dataKey())).events[0].id, 'second-tab');
  await b.cloud.syncNow(); assert.equal(b.cloud.status().dirty, false);
});

test('dirty logout is refused without a server request and without deleting a cache', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); await signed(h); h.save(withEvents(event('pending')));
  const all = [...h.storage.map], requests = h.api.calls.length;
  await assert.rejects(h.cloud.logout(), { code: 'UNSYNCED_CHANGES' });
  assert.deepEqual([...h.storage.map], all); assert.equal(h.api.calls.length, requests); assert.equal(h.cloud.status().active, true);
});

test('expired sessions can reauthenticate the same account while retaining offline work', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h); h.save(withEvents(event('pending')));
  h.api.session = null; await h.cloud.init(); assert.equal(h.cloud.status().reauthRequired, true); assert.equal(h.cloud.status().active, true);
  await h.cloud.login({ username: 'ALICE', password: 'private-password-123' });
  assert.equal(h.cloud.status().reauthRequired, false); assert.equal(h.view.events[0].id, 'pending');
  await h.cloud.syncNow(); assert.equal(h.api.records.get(user.id).state.events[0].id, 'pending'); assert.equal(h.cloud.status().dirty, false);
});

test('a failed dirty journal blocks a local save before changing its data', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); await signed(h);
  const raw = h.storage.getItem(h.dataKey()), key = h.meta().key;
  h.storage.fail = name => name === key;
  assert.throws(() => h.save(withEvents(event('never-saved'))), { code: 'STORAGE_ERROR' });
  assert.equal(h.storage.getItem(h.dataKey()), raw); assert.equal(h.view.events.length, 0); assert.equal(puts(h.api).length, 0);
});

test('a local save surviving a failed final metadata write resumes dirty after reload', async t => {
  const api = backend(), storage = memory(), h = harness(api, storage); t.after(() => h.cloud.destroy()); await signed(h);
  const key = h.meta().key; let writes = 0;
  storage.fail = name => name === key && ++writes > 1;
  const saved = h.store.save(withEvents(event('saved-data')), h.view.revision); h.view = saved;
  assert.equal(h.view.events[0].id, 'saved-data'); assert.equal(h.meta().value.dirty, true);
  h.cloud.destroy(); storage.fail = null;
  const reloaded = harness(api, storage); t.after(() => reloaded.cloud.destroy()); await reloaded.cloud.init();
  assert.equal(reloaded.view.events[0].id, 'saved-data'); assert.equal(reloaded.cloud.status().dirty, true); assert.equal(puts(api).length, 0);
});

test('a failed cloud replacement keeps the old account data and the visible editor state', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  const old = h.storage.getItem(h.dataKey()), key = h.meta().key; h.api.setRemote(user, withEvents(event('remote')));
  let writes = 0; h.storage.fail = name => name === key && ++writes === 2;
  await assert.rejects(h.cloud.syncNow(), { code: 'STORAGE_ERROR' });
  assert.equal(h.storage.getItem(h.dataKey()), old); assert.equal(h.view.events.length, 0);
});

test('a clean pull cannot replace a new local save or an open draft', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  h.api.setRemote(user, withEvents(event('remote')));
  h.canSwitch = false; await assert.rejects(h.cloud.syncNow(), { code: 'DRAFT_OPEN' }); assert.equal(h.view.events.length, 0);
  h.canSwitch = true;
  const gate = deferred(), entered = deferred(); h.api.beforeGet = async () => { entered.resolve(); await gate.promise; };
  const pulling = h.cloud.syncNow(); await entered.promise; h.save(withEvents(event('local-during-pull'))); gate.resolve(); await pulling;
  assert.equal(h.view.events[0].id, 'local-during-pull'); assert.equal(h.cloud.status().dirty, true);
});

test('logout rechecks other-tab writes after the server responds and preserves them', async t => {
  const api = backend(), storage = memory(), a = harness(api, storage); t.after(() => a.cloud.destroy()); await signed(a);
  const b = harness(api, storage); t.after(() => b.cloud.destroy()); await b.cloud.init();
  const gate = deferred(), entered = deferred(); api.beforeLogout = async () => { entered.resolve(); await gate.promise; };
  const logout = a.cloud.logout(); await entered.promise; b.save(withEvents(event('other-tab-unsent'))); gate.resolve();
  await assert.rejects(logout, { code: 'UNSYNCED_CHANGES' });
  assert.equal(JSON.parse(storage.getItem(a.dataKey())).events[0].id, 'other-tab-unsent'); assert.equal(a.cloud.status().reauthRequired, true);
});

test('request timeout retains pending payload and destroy prevents late activation', async t => {
  const h = harness(undefined, undefined, { timeoutMs: 30 }); t.after(() => h.cloud.destroy()); await signed(h);
  h.save(withEvents(event('pending-timeout'))); h.api.beforePut = () => new Promise(() => {});
  await assert.rejects(h.cloud.syncNow(), error => ['TIMEOUT', 'NETWORK_ERROR'].includes(error.code));
  assert.equal(h.cloud.status().syncing, false); assert.equal(h.cloud.status().dirty, true); assert.equal(h.meta().value.pending.state.events[0].id, 'pending-timeout');
  const b = harness(); t.after(() => b.cloud.destroy()); await b.cloud.init(); await b.cloud.register({ username: 'bob', password: 'private-password-123' });
  const gate = deferred(), entered = deferred(); b.api.beforeGet = async () => { entered.resolve(); await gate.promise; };
  const selecting = b.cloud.selectSource('cloud'); await entered.promise; b.cloud.destroy(); gate.resolve();
  await assert.rejects(selecting, { code: 'STALE_OPERATION' }); assert.equal(b.activations.length, 0);
});

test('recovery returns the replacement code without activating or persisting credentials', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); await h.cloud.init();
  const result = await h.cloud.recover({ username: 'alice', recoveryCode: 'old-secret', newPassword: 'new-secret' });
  assert.equal(result.recoveryCode, 'private-recovery-new'); assert.equal(h.cloud.status().user, null); assert.equal(h.activations.length, 0);
  for (const value of h.storage.map.values()) assert.doesNotMatch(value, /old-secret|new-secret|private-recovery/);
});

test('manual login exports the pending account cache instead of unrelated guest records', async t => {
  const api = backend(), storage = memory(), a = harness(api, storage); t.after(() => a.cloud.destroy());
  await signed(a); a.save(withEvents(event('pending-account'))); a.cloud.destroy(); api.session = null;
  const b = harness(api, storage); t.after(() => b.cloud.destroy()); await b.cloud.init();
  await b.cloud.login({ username: 'alice', password: 'private-password-123' });
  assert.equal(b.cloud.status().active, false); assert.equal(b.view.events[0].id, 'guest');
  assert.equal(b.cloud.getExportState().events[0].id, 'pending-account');
  assert.equal(b.cloud.status().localCount, 1);
});

test('offline local conflict resolution remains retryable with the original pending request', async t => {
  const h = harness(); t.after(() => h.cloud.destroy()); const user = await signed(h);
  h.save(withEvents(event('mine'))); h.api.setRemote(user, withEvents(event('remote')));
  await assert.rejects(h.cloud.syncNow(), { code: 'CONFLICT' });
  h.api.beforePut = async () => { throw new Error('offline'); };
  await assert.rejects(h.cloud.resolveConflict('local'), { code: 'NETWORK_ERROR' });
  const attempted = copy(puts(h.api).at(-1).body);
  assert.equal(h.cloud.status().active, true); assert.equal(h.cloud.status().dirty, true);
  await h.cloud.syncNow(); assert.deepEqual(puts(h.api).at(-1).body, attempted);
  assert.equal(h.cloud.status().dirty, false); assert.equal(h.api.records.get(user.id).state.events[0].id, 'mine');
});

test('an interrupted guest selection does not resume and upload an older clean account cache', async t => {
  const api = backend(), storage = memory(), a = harness(api, storage); t.after(() => a.cloud.destroy());
  const user = await signed(a); a.save(withEvents(event('old-account'))); await a.cloud.syncNow(); a.cloud.destroy(); api.session = null;
  const b = harness(api, storage); t.after(() => b.cloud.destroy()); await b.cloud.init(); await b.cloud.login({ username: 'alice', password: 'private-password-123' });
  api.beforePut = async () => { throw new Error('offline'); };
  await assert.rejects(b.cloud.selectSource('local'), { code: 'NETWORK_ERROR' });
  assert.equal(puts(api).at(-1).body.state.events[0].id, 'guest'); b.cloud.destroy();
  const c = harness(api, storage); t.after(() => c.cloud.destroy()); await c.cloud.init();
  assert.equal(c.cloud.status().active, false); assert.equal(c.cloud.status().selectionRequired, true);
  assert.equal(c.cloud.getExportState().events[0].id, 'guest');
  await c.cloud.selectSource('local'); assert.equal(c.view.events[0].id, 'guest'); assert.equal(api.records.get(user.id).state.events[0].id, 'guest');
});
