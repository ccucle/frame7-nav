/* FORMDAY accounts: isolated local caches and explicit, versioned cloud sync. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormdayCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const versionOK = value => Number.isSafeInteger(value) && value >= 0;
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  function problem(code, message) { const error = new Error(message); error.code = code; return error; }
  function stableJSON(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
    if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }

  function create(options) {
    const o = options || {}, C = o.core, storage = o.storage;
    if (!C || typeof C.makeStore !== 'function' || typeof C.normalizeState !== 'function') throw new TypeError('기록 모듈이 필요합니다.');
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new TypeError('브라우저 저장소가 필요합니다.');
    if (typeof o.getLocal !== 'function') throw new TypeError('현재 기록을 읽는 함수가 필요합니다.');
    const fetcher = o.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const delay = Number.isFinite(o.debounceMs) && o.debounceMs >= 0 ? o.debounceMs : 700;
    const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 20000;
    const clone = value => JSON.parse(JSON.stringify(value));
    const empty = () => C.normalizeState({ events: [], settings: { ...C.defaults }, demo: false });
    const canSwitch = () => typeof o.canSwitch !== 'function' || o.canSwitch() !== false;
    const now = () => new Date().toISOString();
    let destroyed = false, epoch = 0, csrfToken = '', account = null, task = null, timer = null, serverLoggedOut = false;
    const requests = new Set();
    const s = { available: null, loading: false, user: null, active: false, dirty: false, syncing: false, conflict: false, error: '', lastSyncedAt: null, selectionRequired: false, localCount: 0, remoteCount: 0, reauthRequired: false };

    function status() { return clone(s); }
    function emit() { if (!destroyed && typeof o.onStatus === 'function') { try { o.onStatus(status()); } catch (_) { /* A status renderer must not interrupt persistence. */ } } }
    function alive(ticket) { if (destroyed || (ticket !== undefined && ticket !== epoch)) throw problem('STALE_OPERATION', '종료된 연결 작업입니다.'); }
    function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
    function fail(code, message) { const error = problem(code, message); s.error = message; emit(); throw error; }
    function noteError(error) {
      s.error = error && error.message ? error.message : '연결하지 못했습니다. 이 기기의 기록은 유지됩니다.';
      if (s.user && error && (error.status === 401 || error.status === 403 || ['ACCOUNT_CHANGED', 'CSRF_INVALID', 'AUTH_REQUIRED'].includes(error.code))) s.reauthRequired = true;
    }
    function localView() { return C.normalizeState(o.getLocal()); }
    function viewStamp() { return JSON.stringify(localView()); }
    function count(state) { return state ? state.events.length : 0; }
    function requireSwitch(stamp) {
      if (!canSwitch()) throw problem('DRAFT_OPEN', '열려 있는 기록 편집을 저장하거나 닫은 뒤 다시 시도해 주세요. 입력 내용은 유지됩니다.');
      if (stamp !== undefined && viewStamp() !== stamp) throw problem('LOCAL_CHANGED', '작업 중 이 기기의 기록이 변경되었습니다. 현재 기록을 확인한 뒤 다시 선택해 주세요.');
    }

    function run(kind, work) {
      alive();
      if (task) {
        if (task.kind === kind && (kind === 'sync' || kind === 'init')) return task.promise;
        return Promise.reject(problem('BUSY', '다른 계정 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.'));
      }
      stopTimer();
      s.error = '';
      if (kind === 'sync') s.syncing = true; else s.loading = true;
      const ticket = epoch;
      const current = { kind, promise: null };
      task = current;
      emit();
      current.promise = Promise.resolve().then(() => { alive(ticket); return work(ticket); }).then(result => {
        alive(ticket);
        if (task === current) task = null;
        s.loading = false; s.syncing = false;
        emit();
        if (kind === 'sync' && s.active && s.dirty && !s.conflict && !s.error) schedule();
        return result === undefined ? status() : result;
      }, error => {
        if (task === current) task = null;
        if (!destroyed && ticket === epoch) {
          s.loading = false; s.syncing = false;
          noteError(error);
          emit();
        }
        throw error;
      });
      return current.promise;
    }

    async function request(path, method, body, ticket, owner) {
      alive(ticket);
      if (typeof fetcher !== 'function') throw problem('API_UNAVAILABLE', '계정 서버에 연결할 수 없습니다.');
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
      if (owner) headers['X-Formday-User'] = owner.id;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timeout, rejectCanceled;
      const canceled = new Promise((_, reject) => {
        rejectCanceled = reject;
        timeout = setTimeout(() => { if (controller) controller.abort(); reject(problem('TIMEOUT', '서버 응답을 기다리는 시간이 지났습니다. 이 기기의 기록과 전송 대기 내용을 보존했습니다. 다시 시도해 주세요.')); }, timeoutMs);
      });
      const cancellation = { abort() { if (controller) controller.abort(); rejectCanceled(problem('STALE_OPERATION', '종료된 연결 작업입니다.')); } };
      requests.add(cancellation);
      let response, payload;
      try {
        response = await Promise.race([fetcher(path, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(controller ? { signal: controller.signal } : {}) }), canceled]);
        alive(ticket);
        payload = response.ok && response.status === 204 ? {} : await Promise.race([response.json(), canceled]);
        alive(ticket);
      } catch (error) {
        alive(ticket);
        if (error && error.code === 'TIMEOUT') throw error;
        throw problem('NETWORK_ERROR', '서버에 연결하지 못했습니다. 이 기기의 기록을 보존했습니다. 연결 후 다시 동기화해 주세요.');
      } finally { clearTimeout(timeout); requests.delete(cancellation); }
      if (!response.ok) {
        const code = plain(payload) && plain(payload.error) && typeof payload.error.code === 'string' ? payload.error.code : 'HTTP_ERROR';
        const message = plain(payload) && plain(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : '서버 요청을 처리하지 못했습니다. 이 기기의 기록은 유지됩니다.';
        const error = problem(code, message);
        error.status = response.status;
        if (plain(payload) && versionOK(payload.version)) error.version = payload.version;
        if (plain(payload) && typeof payload.userId === 'string') error.userId = payload.userId;
        throw error;
      }
      if (!plain(payload)) throw problem('INVALID_RESPONSE', '서버 응답 형식을 확인할 수 없습니다. 기록을 변경하지 않았습니다.');
      return payload;
    }

    function authResult(payload) {
      if (!plain(payload.user) || !idOK(payload.user.id) || typeof payload.user.username !== 'string' || !payload.user.username || payload.user.username.length > 100 || typeof payload.csrfToken !== 'string' || !payload.csrfToken || payload.csrfToken.length > 1024) throw problem('INVALID_RESPONSE', '로그인 응답을 확인할 수 없습니다.');
      return { user: { id: payload.user.id, username: payload.user.username }, csrfToken: payload.csrfToken };
    }
    function envelope(payload, owner) {
      if (payload.userId !== owner.id) throw problem('ACCOUNT_CHANGED', '다른 창에서 로그인 계정이 바뀌었습니다. 이 기기의 기록을 보존했습니다. 원래 계정으로 다시 로그인해 주세요.');
      if (!versionOK(payload.version) || !Object.prototype.hasOwnProperty.call(payload, 'state') || !(payload.updatedAt === null || (typeof payload.updatedAt === 'string' && Number.isFinite(Date.parse(payload.updatedAt))))) throw problem('INVALID_RESPONSE', '서버 기록의 버전 또는 저장 시각을 확인할 수 없습니다.');
      const state = payload.state === null ? null : C.normalizeState(payload.state);
      return { version: payload.version, state, updatedAt: payload.updatedAt };
    }
    async function remote(a, ticket) {
      const result = envelope(await request('/api/state', 'GET', undefined, ticket, a.user), a.user);
      if (account === a) s.remoteCount = count(result.state);
      return result;
    }

    function baseMeta(user) {
      return { schemaVersion: 1, userId: user.id, ackRemoteVersion: null, dirty: false, localRevision: '', ackLocalRevision: null, operationId: null, pending: null, conflict: false, installing: false, lastSyncedAt: null };
    }
    function parseMeta(raw, user) {
      if (raw === null) return baseMeta(user);
      let value;
      try { value = JSON.parse(raw); } catch (_) { throw problem('CACHE_ERROR', '이 계정의 동기화 정보를 읽을 수 없습니다. 기존 기록을 보존했습니다.'); }
      if (!plain(value) || value.schemaVersion !== 1 || value.userId !== user.id || !(value.ackRemoteVersion === null || versionOK(value.ackRemoteVersion)) || typeof value.dirty !== 'boolean' || typeof value.localRevision !== 'string' || !(value.ackLocalRevision === null || typeof value.ackLocalRevision === 'string') || typeof value.conflict !== 'boolean' || typeof value.installing !== 'boolean') throw problem('CACHE_ERROR', '이 계정의 동기화 정보가 올바르지 않습니다. 기존 기록을 보존했습니다.');
      if (value.pending !== null) {
        const p = value.pending;
        if (!plain(p) || !idOK(p.operationId) || p.operationId !== value.operationId || !versionOK(p.expectedVersion) || typeof p.localRevision !== 'string' || !['push', 'selection'].includes(p.kind)) throw problem('CACHE_ERROR', '전송 대기 중인 기록 정보를 확인할 수 없습니다.');
        p.state = C.normalizeState(p.state);
        if (p.state.revision !== p.localRevision) throw problem('CACHE_ERROR', '전송 대기 기록의 버전이 일치하지 않습니다.');
      } else if (value.operationId !== null) throw problem('CACHE_ERROR', '전송 식별자가 올바르지 않습니다.');
      return value;
    }
    function refresh(a) {
      const loaded = a.base.load();
      if (loaded.error) throw problem('CACHE_ERROR', loaded.error);
      let raw;
      try { raw = storage.getItem(a.metaKey); } catch (_) { throw problem('STORAGE_ERROR', '계정 저장 공간에 접근할 수 없습니다.'); }
      const meta = parseMeta(raw, a.user);
      if (loaded.data && (raw === null || loaded.data.revision !== meta.localRevision)) {
        // A data write may have completed immediately before a tab was closed.
        meta.dirty = true;
        meta.localRevision = loaded.data.revision;
      }
      if (!loaded.data && meta.dirty && !(meta.pending && meta.pending.kind === 'selection')) throw problem('CACHE_ERROR', '동기화 대기 기록의 본문을 찾을 수 없습니다. 원본을 덮어쓰지 않았습니다.');
      a.cache = loaded.data; a.raw = loaded.raw; a.meta = meta; a.metaRaw = raw;
      return a;
    }
    function writeMeta(a, next) {
      const serialized = JSON.stringify(next);
      try {
        if (storage.getItem(a.metaKey) !== a.metaRaw || storage.getItem(a.dataKey) !== a.raw) throw problem('STORAGE_CONFLICT', '다른 창에서 동기화 상태가 변경되었습니다. 최신 기록을 불러온 뒤 다시 시도해 주세요.');
        storage.setItem(a.metaKey, serialized);
      } catch (error) {
        if (error && error.code === 'STORAGE_CONFLICT') throw error;
        throw problem('STORAGE_ERROR', '동기화 상태를 이 기기에 저장하지 못했습니다. 기록을 보존했으니 저장 공간을 확인하고 다시 동기화해 주세요.');
      }
      a.meta = next; a.metaRaw = serialized;
    }
    function reflect(a) {
      if (account !== a) return;
      s.dirty = !!a.meta.dirty; s.conflict = !!a.meta.conflict; s.lastSyncedAt = a.meta.lastSyncedAt || null;
      s.localCount = count(candidate(a).state);
    }
    function candidate(a) {
      if (s.active && account === a && a.cache) return { state: C.clone(a.cache), fromCache: true };
      // A guest-to-account selection has not activated the old account cache.
      // Keep the current guest draft as the explicit local selection candidate.
      if (a.meta.pending && a.meta.pending.kind === 'selection') return { state: localView(), fromCache: false };
      if (a.cache && a.meta.dirty) return { state: C.clone(a.cache), fromCache: true };
      return { state: localView(), fromCache: false };
    }
    function openAccount(user) {
      if (account && account.user.id === user.id) { account.user = user; return refresh(account); }
      const prefix = C.STORE + '_cloud_v1_' + encodeURIComponent(user.id) + ':';
      const adapter = { getItem: key => storage.getItem(prefix + key), setItem: (key, value) => storage.setItem(prefix + key, value), removeItem: key => storage.removeItem(prefix + key) };
      const a = { user, prefix, dataKey: prefix + C.STORE, metaKey: prefix + 'sync', base: C.makeStore(adapter), cache: null, meta: null, metaRaw: null, raw: null, store: null };
      a.store = {
        load: () => a.base.load(),
        backupKey: prefix + C.STORE + '_previous',
        save(next, expectedRevision, recovery) {
          alive();
          if (account !== a || !s.active || (task && task.kind === 'logout')) throw problem('ACCOUNT_INACTIVE', '활성 계정이 변경되었습니다. 기록을 다시 불러와 주세요.');
          refresh(a);
          if (a.meta.installing) throw problem('CACHE_ERROR', '이전 계정 전환을 마치지 못했습니다. 기록을 백업한 뒤 저장할 기록을 다시 선택해 주세요.');
          // Write-ahead dirty marker: closing the tab after core.save is safe.
          writeMeta(a, { ...a.meta, dirty: true });
          const saved = a.base.save(next, expectedRevision, recovery);
          a.cache = saved; a.raw = JSON.stringify(saved);
          const committed = { ...a.meta, dirty: true, localRevision: saved.revision };
          try { writeMeta(a, committed); }
          catch (_) {
            // The data really was saved; the durable marker above still protects it.
            a.meta = committed;
            s.error = '기록은 이 기기에 저장했습니다. 동기화 준비를 마치지 못해 재시도가 필요합니다.';
          }
          reflect(a); emit();
          return saved;
        }
      };
      return refresh(a);
    }

    function activate(a, state) {
      requireSwitch();
      s.active = true; s.selectionRequired = false; s.user = { ...a.user };
      reflect(a);
      if (typeof o.onActivate === 'function') o.onActivate({ user: { ...a.user }, store: a.store, state: C.clone(state) });
      emit();
    }
    function install(a, result) {
      refresh(a);
      const before = { raw: a.raw, meta: clone(a.meta) };
      // An interrupted replacement must never become an automatic upload.
      writeMeta(a, { ...a.meta, dirty: true, installing: true });
      let saved;
      try {
        saved = a.base.save(result.state === null ? empty() : result.state, a.cache ? a.cache.revision : '');
        a.raw = JSON.stringify(saved);
        writeMeta(a, { ...baseMeta(a.user), ackRemoteVersion: result.version, dirty: false, localRevision: saved.revision, ackLocalRevision: saved.revision, lastSyncedAt: result.updatedAt || now() });
      } catch (error) {
        // Best effort rollback. If storage remains blocked, core's previous copy
        // and the installing marker retain the old record and prevent a push.
        try {
          if (saved && storage.getItem(a.dataKey) === JSON.stringify(saved)) {
            if (before.raw === null) storage.removeItem(a.dataKey); else storage.setItem(a.dataKey, before.raw);
          }
          a.raw = before.raw;
          writeMeta(a, before.meta);
        } catch (_) { /* Preserve the journal and previous copy for recovery. */ }
        throw error;
      }
      a.cache = saved; a.raw = JSON.stringify(saved);
      reflect(a);
      return saved;
    }

    function pendingFor(a, state, expectedVersion, kind) {
      const previous = a.meta.pending;
      if (previous && previous.kind === kind && stableJSON(previous.state) === stableJSON(state)) return previous;
      return { operationId: C.uid(), expectedVersion, localRevision: state.revision, state: C.clone(state), kind };
    }
    async function send(a, pending, ticket) {
      try {
        const payload = await request('/api/state', 'PUT', { expectedVersion: pending.expectedVersion, operationId: pending.operationId, state: pending.state }, ticket, a.user);
        const result = envelope(payload, a.user);
        if (result.version <= pending.expectedVersion || result.state === null || stableJSON(result.state) !== stableJSON(pending.state)) throw problem('INVALID_RESPONSE', '서버 저장 결과와 전송 기록이 일치하지 않습니다. 이 기기의 기록을 보존했습니다.');
        s.remoteCount = count(result.state);
        return result;
      } catch (error) {
        if (error.status === 409 && ['CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) {
          if (error.userId !== a.user.id) throw problem('ACCOUNT_CHANGED', '계정이 변경되어 동기화를 멈췄습니다. 원래 계정으로 다시 로그인해 주세요.');
          refresh(a);
          if (a.meta.pending && a.meta.pending.operationId === pending.operationId) writeMeta(a, { ...a.meta, dirty: true, conflict: true });
          reflect(a);
          try { await remote(a, ticket); } catch (_) { alive(ticket); s.remoteCount = null; }
          throw problem('CONFLICT', '다른 기기에서 기록이 변경되었습니다. 기기 기록 또는 클라우드 기록을 직접 선택해 주세요. 자동으로 합치거나 덮어쓰지 않았습니다.');
        }
        throw error;
      }
    }
    async function push(a, ticket) {
      refresh(a);
      if (a.meta.installing) throw problem('CACHE_ERROR', '이전 기록 전환을 마치지 못했습니다. 기록을 백업한 뒤 사용할 기록을 다시 선택해 주세요.');
      if (a.meta.ackRemoteVersion === null) throw problem('SELECTION_REQUIRED', '기기 기록과 클라우드 기록 중 사용할 기록을 먼저 선택해 주세요.');
      const pending = a.meta.pending || pendingFor(a, a.cache, a.meta.ackRemoteVersion, 'push');
      if (pending.kind !== 'push') throw problem('SELECTION_REQUIRED', '이전 기록 선택을 마치지 못했습니다. 사용할 기록을 다시 선택해 주세요.');
      writeMeta(a, { ...a.meta, dirty: true, operationId: pending.operationId, pending });
      reflect(a);
      const result = await send(a, pending, ticket);
      alive(ticket);
      refresh(a);
      // Another tab may have acknowledged this operation or begun a newer one.
      if (!a.meta.pending || a.meta.pending.operationId !== pending.operationId) { reflect(a); return; }
      if (a.meta.ackRemoteVersion !== null && a.meta.ackRemoteVersion > result.version) throw problem('STORAGE_CONFLICT', '다른 창에서 더 최신 기록을 동기화했습니다. 다시 불러와 주세요.');
      const dirty = a.cache.revision !== pending.localRevision;
      writeMeta(a, { ...a.meta, ackRemoteVersion: result.version, ackLocalRevision: pending.localRevision, localRevision: a.cache.revision, dirty, operationId: null, pending: null, conflict: false, lastSyncedAt: result.updatedAt || now() });
      reflect(a);
    }
    function schedule() {
      if (destroyed || !s.active || !s.dirty || s.conflict) return;
      stopTimer();
      timer = setTimeout(() => { timer = null; if (!task && !destroyed) syncNow().catch(() => {}); }, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }

    async function acceptAuth(payload, ticket, automatic) {
      const authenticated = authResult(payload);
      if (s.active && s.user && s.user.id !== authenticated.user.id) throw problem('ACCOUNT_CHANGED', '다른 창에서 로그인 계정이 변경되었습니다. 현재 기기 기록을 보존했습니다.');
      csrfToken = authenticated.csrfToken;
      serverLoggedOut = false;
      s.reauthRequired = false;
      s.user = authenticated.user;
      s.selectionRequired = !s.active;
      let a;
      try {
        a = openAccount(authenticated.user); account = a; reflect(a);
      } catch (error) { s.error = error.message; s.selectionRequired = !s.active; emit(); return; }
      let result;
      try { result = await remote(a, ticket); }
      catch (error) {
        noteError(error);
        if (automatic && a.cache && !a.meta.installing && !(a.meta.pending && a.meta.pending.kind === 'selection') && canSwitch() && !s.active) activate(a, a.cache);
        emit(); return;
      }
      if (s.active) { reflect(a); return; }
      if (automatic && a.cache && !a.meta.installing && !(a.meta.pending && a.meta.pending.kind === 'selection') && canSwitch()) {
        if (a.meta.dirty || a.meta.conflict || a.meta.ackRemoteVersion === null) activate(a, a.cache);
        else if (result.version < a.meta.ackRemoteVersion) s.error = '클라우드 기록 버전이 이전으로 바뀌었습니다. 이 기기의 기록을 보존했습니다.';
        else activate(a, result.version === a.meta.ackRemoteVersion ? a.cache : install(a, result));
      }
      reflect(a); emit();
    }

    function init() {
      return run('init', async ticket => {
        let config;
        try { config = await request('/api/config', 'GET', undefined, ticket); }
        catch (_) { alive(ticket); s.available = false; if (!s.active) s.error = ''; return; }
        if (config.enabled !== true || config.apiVersion !== 1) { s.available = false; return; }
        s.available = true;
        const payload = await request('/api/auth/session', 'GET', undefined, ticket);
        if (payload.user === null) {
          csrfToken = '';
          if (s.active) { s.error = '로그인이 만료되었습니다. 기기 기록을 보존했습니다. 같은 계정으로 다시 로그인해 주세요.'; s.reauthRequired = true; }
          else { s.user = null; account = null; s.selectionRequired = false; s.dirty = false; s.conflict = false; s.localCount = count(localView()); }
          return;
        }
        await acceptAuth(payload, ticket, true);
      });
    }
    async function available() {
      alive();
      if (s.available !== true) await init();
      if (s.available !== true) throw problem('API_UNAVAILABLE', '계정 서버가 아직 연결되지 않았습니다. 이 기기의 기록 기능을 계속 이용할 수 있습니다.');
    }
    async function authenticate(kind, credentials) {
      await available();
      return run(kind, async ticket => {
        if (s.user && ((!s.active && !s.reauthRequired) || kind !== 'login' || !credentials || typeof credentials.username !== 'string' || credentials.username.toLowerCase().trim() !== s.user.username.toLowerCase())) throw problem('ACCOUNT_ACTIVE', '현재 계정에서 로그아웃한 뒤 다른 계정으로 로그인해 주세요.');
        if (!s.active) requireSwitch();
        const payload = await request('/api/auth/' + kind, 'POST', credentials, ticket);
        authResult(payload);
        if (kind === 'register' && (typeof payload.recoveryCode !== 'string' || !payload.recoveryCode)) throw problem('INVALID_RESPONSE', '계정 복구 코드를 확인할 수 없습니다.');
        await acceptAuth(payload, ticket, false);
        return { user: { ...s.user }, ...(kind === 'register' ? { recoveryCode: payload.recoveryCode } : {}) };
      });
    }
    function register(credentials) { return authenticate('register', credentials); }
    function login(credentials) { return authenticate('login', credentials); }
    async function recover(credentials) {
      await available();
      return run('recover', async ticket => {
        if (s.user) throw problem('ACCOUNT_ACTIVE', '현재 계정에서 로그아웃한 뒤 계정을 복구해 주세요.');
        const payload = await request('/api/auth/recover', 'POST', credentials, ticket);
        if (typeof payload.recoveryCode !== 'string' || !payload.recoveryCode) throw problem('INVALID_RESPONSE', '새 복구 코드를 확인할 수 없습니다.');
        return { recoveryCode: payload.recoveryCode };
      });
    }

    async function choose(source, ticket, resolving) {
      if (!['cloud', 'local'].includes(source)) throw problem('INVALID_SOURCE', '기기 기록 또는 클라우드 기록을 선택해 주세요.');
      if (!s.user || !account) throw problem('AUTH_REQUIRED', '먼저 로그인해 주세요.');
      const a = refresh(account);
      if (resolving && !a.meta.conflict && !s.conflict) throw problem('NO_CONFLICT', '해결할 동기화 충돌이 없습니다.');
      requireSwitch();
      const stamp = viewStamp(), initialRevision = a.cache ? a.cache.revision : null;
      const chosen = candidate(a);
      const result = await remote(a, ticket);
      requireSwitch(stamp);
      refresh(a);
      if ((a.cache ? a.cache.revision : null) !== initialRevision) throw problem('LOCAL_CHANGED', '다른 창에서 기기 기록이 변경되었습니다. 다시 선택해 주세요.');
      if (source === 'cloud') { activate(a, install(a, result)); return; }
      // A pending selection is retried with precisely the original operation and
      // payload. Explicit conflict resolution starts a fresh CAS against the GET.
      const kind = chosen.fromCache ? 'push' : 'selection';
      const pending = !resolving ? pendingFor(a, chosen.state, result.version, kind) : { operationId: C.uid(), expectedVersion: result.version, localRevision: chosen.state.revision, state: C.clone(chosen.state), kind };
      writeMeta(a, { ...a.meta, dirty: true, operationId: pending.operationId, pending, conflict: false });
      reflect(a); emit();
      const saved = await send(a, pending, ticket);
      alive(ticket);
      requireSwitch(stamp);
      refresh(a);
      if (!a.meta.pending || a.meta.pending.operationId !== pending.operationId || (a.cache ? a.cache.revision : null) !== initialRevision) throw problem('LOCAL_CHANGED', '전송 중 기기 기록이 변경되었습니다. 새 기록을 보존했습니다. 사용할 기록을 다시 선택해 주세요.');
      activate(a, install(a, saved));
    }
    function selectSource(source) { return run('select', ticket => choose(source, ticket, false)); }
    function resolveConflict(source) { return run('resolve', ticket => choose(source, ticket, true)); }
    function syncNow() {
      return run('sync', async ticket => {
        if (!s.active || !account) throw problem('ACCOUNT_INACTIVE', '사용할 계정 기록을 먼저 선택해 주세요.');
        const a = refresh(account); reflect(a);
        if (a.meta.conflict) throw problem('CONFLICT', '기기 기록 또는 클라우드 기록을 선택해 충돌을 해결해 주세요.');
        if (a.meta.dirty) { await push(a, ticket); return; }
        const stamp = viewStamp(), revision = a.cache.revision;
        const result = await remote(a, ticket);
        refresh(a); reflect(a);
        if (a.meta.dirty || a.cache.revision !== revision) return;
        if (result.version < a.meta.ackRemoteVersion) throw problem('INVALID_RESPONSE', '클라우드 버전이 이전으로 바뀌었습니다. 기기 기록을 보존했습니다.');
        if (result.version === a.meta.ackRemoteVersion) return;
        requireSwitch(stamp);
        activate(a, install(a, result));
      });
    }
    function afterLocalSave(savedState) {
      alive();
      if (!s.active || !account) return status();
      const saved = C.normalizeState(savedState), a = refresh(account);
      if (!a.cache || saved.revision !== a.cache.revision) return fail('STORAGE_CONFLICT', '다른 창의 변경으로 현재 기기 기록이 바뀌었습니다. 최신 기록을 불러와 주세요.');
      writeMeta(a, { ...a.meta, dirty: true, localRevision: saved.revision });
      reflect(a); emit(); schedule();
      return status();
    }
    function logout() {
      return run('logout', async ticket => {
        if (!s.user) return;
        if (account) {
          refresh(account); reflect(account);
          if (account.meta.dirty || account.meta.conflict || account.meta.installing) throw problem('UNSYNCED_CHANGES', '아직 전송하지 못한 기록이 있습니다. 백업을 저장하고 동기화 또는 충돌 해결을 마친 뒤 로그아웃해 주세요.');
        }
        requireSwitch();
        if (!serverLoggedOut) await request('/api/auth/logout', 'POST', {}, ticket);
        alive(ticket);
        serverLoggedOut = true; csrfToken = ''; s.reauthRequired = true;
        // A second tab or a newly opened editor may have changed during logout.
        if (account) {
          refresh(account); reflect(account);
          if (account.meta.dirty || account.meta.conflict || account.meta.installing) throw problem('UNSYNCED_CHANGES', '서버에서 로그아웃하는 동안 새 기기 기록이 생겼습니다. 기록을 보존했습니다. 같은 계정으로 다시 로그인해 동기화해 주세요.');
        }
        requireSwitch();
        // Only this user's cache is removed. The original guest namespace is
        // never written to, including its previous-version backup.
        if (account) {
          try {
            storage.removeItem(account.dataKey);
            storage.removeItem(account.prefix + C.STORE + '_previous');
            storage.removeItem(account.metaKey);
          } catch (_) {
            s.error = '서버에서 로그아웃했습니다. 브라우저가 이 계정의 기기 캐시 삭제를 허용하지 않았습니다.';
          }
        }
        csrfToken = ''; account = null;
        s.user = null; s.active = false; s.dirty = false; s.conflict = false; s.selectionRequired = false; s.lastSyncedAt = null; s.remoteCount = 0; s.reauthRequired = false;
        if (typeof o.onGuest === 'function') o.onGuest();
        s.localCount = count(localView());
      });
    }
    function isActiveStorageKey(key) { return key === (s.active && account ? account.dataKey : C.STORE); }
    function getExportState() { alive(); return C.clone(account && s.user ? candidate(refresh(account)).state : localView()); }
    function destroy() {
      if (destroyed) return;
      destroyed = true; epoch++; stopTimer(); csrfToken = '';
      for (const controller of requests) controller.abort();
      requests.clear();
    }

    return { init, register, login, recover, selectSource, syncNow, resolveConflict, logout, afterLocalSave, status, destroy, isActiveStorageKey, getExportState };
  }
  return { create };
});
