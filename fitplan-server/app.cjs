'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const Core = require('../fitplan/core.js');
const { validateOrigin } = require('./config.cjs');
const S = require('./security.cjs');

const MAX_AUTH_BYTES = 16 * 1024;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const publicUser = user => ({ id: user.id, username: user.username });
const invalidAuth = () => S.apiError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호를 확인해 주세요.');

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function send(response, status, body) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  if (status === 204) { response.end(); return; }
  const text = JSON.stringify(body);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(text));
  response.end(text);
}

function validateStructure(value) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (++count > 500000 || entry.depth > 32) throw S.apiError(413, 'PAYLOAD_TOO_LARGE', '요청 데이터의 구조가 너무 큽니다.');
    if (typeof entry.value === 'string' && (entry.value.includes('\0') || Buffer.from(entry.value, 'utf8').toString('utf8') !== entry.value)) throw S.apiError(422, 'INVALID_TEXT', '지원하지 않는 문자가 포함되어 있습니다.');
    if (entry.value && typeof entry.value === 'object') for (const item of Object.values(entry.value)) pending.push({ value: item, depth: entry.depth + 1 });
  }
}

function readJSON(request, limit) {
  if (request.destroyed || request.readableEnded) throw S.apiError(400, 'INVALID_REQUEST', '요청이 중단되었습니다.');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) throw S.apiError(413, 'PAYLOAD_TOO_LARGE', '요청 데이터가 허용 크기를 넘었습니다.');
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw S.apiError(415, 'UNSUPPORTED_ENCODING', '압축된 요청은 지원하지 않습니다.');
  return new Promise((resolve, reject) => {
    let bytes = 0, done = false;
    const chunks = [];
    function cleanup() { request.removeListener('data', onData); request.removeListener('end', onEnd); request.removeListener('error', onError); request.removeListener('aborted', onAborted); }
    function fail(error) { if (done) return; done = true; cleanup(); request.resume(); reject(error); }
    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > limit) { fail(S.apiError(413, 'PAYLOAD_TOO_LARGE', '요청 데이터가 허용 크기를 넘었습니다.')); return; }
      chunks.push(chunk);
    }
    function onError() { fail(S.apiError(400, 'INVALID_REQUEST', '요청을 읽지 못했습니다.')); }
    function onAborted() { fail(S.apiError(400, 'INVALID_REQUEST', '요청이 중단되었습니다.')); }
    function onEnd() {
      if (done) return; done = true; cleanup();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const body = JSON.parse(text);
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        validateStructure(body); resolve(body);
      } catch (error) { reject(error.status ? error : S.apiError(400, 'INVALID_JSON', '올바른 JSON 요청이 필요합니다.')); }
    }
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError); request.on('aborted', onAborted);
  });
}

function clientIP(request, hops) {
  const remote = request.socket.remoteAddress || 'unknown';
  if (!hops) return remote;
  const header = request.headers['x-forwarded-for'];
  if (typeof header !== 'string' || header.length > 2048) return remote;
  const chain = header.split(',').map(value => value.trim());
  if (chain.length < hops || chain.length > 32) return remote;
  const candidate = chain[chain.length - hops];
  return net.isIP(candidate) ? candidate : remote;
}

function createLocalLimiter() {
  const buckets = new Map();
  return (ip, now) => {
    const key = S.digest(ip, 'formday/limit/ip'), start = Math.floor(now / 60000) * 60000;
    if (buckets.size >= 10000) for (const [entry, value] of buckets) if (value.start < start) buckets.delete(entry);
    if (!buckets.has(key) && buckets.size >= 10000) throw S.apiError(429, 'RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfter: 60 });
    const value = buckets.get(key);
    const next = value && value.start === start ? { start, hits: value.hits + 1 } : { start, hits: 1 };
    buckets.set(key, next);
    if (next.hits > 240) throw S.apiError(429, 'RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfter: Math.ceil((start + 60000 - now) / 1000) });
  };
}

function createStateQueue() {
  let active = false;
  const queue = [];
  function pump() {
    if (active || !queue.length) return;
    active = true;
    const job = queue.shift();
    Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { active = false; pump(); });
  }
  return work => new Promise((resolve, reject) => {
    if (active && queue.length >= 4) { reject(S.apiError(503, 'SERVER_BUSY', '기록 처리 요청이 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfter: 1 })); return; }
    queue.push({ work, resolve, reject }); pump();
  });
}

async function staticResponse(request, response, pathname, staticRoot) {
  if (!['GET', 'HEAD'].includes(request.method)) throw S.apiError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw S.apiError(400, 'INVALID_PATH', '잘못된 경로입니다.'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) throw S.apiError(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
  const file = path.resolve(staticRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(staticRoot + path.sep) || !MIME[path.extname(file).toLowerCase()]) throw S.apiError(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
  let real, data;
  try {
    real = await fs.realpath(file);
    if (!real.startsWith(staticRoot + path.sep)) throw new Error();
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error();
    data = await fs.readFile(real);
  } catch { throw S.apiError(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.'); }
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()]);
  response.setHeader('Content-Length', data.length);
  response.setHeader('Cache-Control', 'no-cache');
  response.end(request.method === 'HEAD' ? undefined : data);
}

function createServer({ repository, publicOrigin, passwords = S.createPasswordService(), clock = Date.now, staticRoot = path.resolve(__dirname, '../fitplan'), trustProxyHops = 0, logger = () => {} }) {
  validateOrigin(publicOrigin);
  if (!repository) throw new Error('A persistent repository is required. Tests must explicitly inject their adapter.');
  const localLimit = createLocalLimiter();
  // A valid session must not turn simultaneous maximum-size JSON requests into
  // unbounded parsing/normalization memory. Waiting uploads remain backpressured.
  const stateWork = createStateQueue();

  async function limits(kind, ip, name, now) {
    const rule = (key, limit, windowMs) => ({ key: S.digest(key, 'formday/rate/v1'), limit, windowMs });
    let rules;
    if (kind === 'register') rules = [rule('register:ip:' + ip, 5, 3600000)];
    else if (kind === 'login') rules = [rule('login:ip:' + ip, 30, 900000), rule('login:user:' + name, 10, 900000)];
    else if (kind === 'recover') rules = [rule('recover:ip:' + ip, 10, 3600000), rule('recover:user:' + name, 5, 3600000)];
    else if (kind === 'credential') rules = [rule('credential:user:' + name, 5, 3600000)];
    else rules = [rule(kind + ':user:' + name, kind === 'put' ? 60 : 120, 60000)];
    const retryAfter = await repository.consumeRateLimits(rules, now);
    if (retryAfter) throw S.apiError(429, 'RATE_LIMITED', '요청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfter });
  }

  function unsafe(request) {
    if (request.headers.origin !== publicOrigin) throw S.apiError(403, 'ORIGIN_REJECTED', '허용된 사이트에서 다시 요청해 주세요.');
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) throw S.apiError(415, 'JSON_REQUIRED', 'JSON 형식의 요청이 필요합니다.');
  }

  async function authFor(request, now, required = true) {
    const token = S.cookieToken(request.headers.cookie);
    const auth = token ? await repository.getSession(S.sessionHash(token), now) : null;
    if (!auth && required) throw S.apiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
    return auth ? { ...auth, token } : null;
  }
  function checkCSRF(request, auth) {
    if (!S.equalText(request.headers['x-csrf-token'], S.csrfToken(auth.token))) throw S.apiError(403, 'CSRF_REJECTED', '로그인 상태가 변경되었습니다. 다시 확인해 주세요.');
  }
  function checkOwner(request, auth) {
    if (request.headers['x-formday-user'] !== auth.userId) throw S.apiError(409, 'ACCOUNT_CHANGED', '다른 탭에서 계정이 변경되었습니다. 현재 계정을 다시 확인해 주세요.');
  }
  function attachSession(response, user, session, recoveryCode) {
    response.setHeader('Set-Cookie', S.sessionCookie(session.token));
    return { user: publicUser(user), csrfToken: S.csrfToken(session.token), ...(recoveryCode ? { recoveryCode } : {}) };
  }

  async function route(request, response) {
    const now = clock(), url = new URL(request.url, publicOrigin), pathname = url.pathname, method = request.method;
    if (pathname === '/healthz' && method === 'GET') { send(response, 200, { status: 'ok' }); return; }
    if (pathname === '/readyz' && method === 'GET') {
      let ready = false; try { ready = await repository.ready(); } catch {}
      send(response, ready ? 200 : 503, { status: ready ? 'ready' : 'unready' }); return;
    }
    if (!pathname.startsWith('/api/')) { await staticResponse(request, response, pathname, staticRoot); return; }
    localLimit(clientIP(request, trustProxyHops), now);
    if (['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) throw S.apiError(403, 'ORIGIN_REJECTED', '허용된 사이트에서 다시 요청해 주세요.');
    if (pathname === '/api/config' && method === 'GET') { send(response, 200, { enabled: true, apiVersion: 1 }); return; }
    if (pathname === '/api/auth/session' && method === 'GET') {
      const auth = await authFor(request, now, false);
      if (!auth) response.setHeader('Set-Cookie', S.clearCookie());
      send(response, 200, auth ? { user: auth.user, csrfToken: S.csrfToken(auth.token) } : { user: null }); return;
    }
    if (pathname === '/api/state' && method === 'GET') {
      const auth = await authFor(request, now); checkOwner(request, auth);
      await limits('get', '', auth.userId, now);
      await stateWork(async () => {
        if (response.destroyed) return;
        const result = await repository.getState(auth, now);
        if (result.state) result.state = Core.normalizeState(result.state);
        send(response, 200, result);
      }); return;
    }
    if (pathname === '/api/state' && method === 'PUT') {
      unsafe(request);
      const auth = await authFor(request, now); checkOwner(request, auth); checkCSRF(request, auth);
      await limits('put', '', auth.userId, now);
      await stateWork(async () => {
      const body = await readJSON(request, MAX_STATE_BYTES);
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || body.expectedVersion === Number.MAX_SAFE_INTEGER) throw S.apiError(422, 'INVALID_VERSION', '서버 기록 버전을 확인해 주세요.');
      if (typeof body.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(body.operationId)) throw S.apiError(422, 'INVALID_OPERATION', '저장 작업 번호를 확인해 주세요.');
      let state;
      try { state = Core.normalizeState(body.state); } catch { throw S.apiError(422, 'INVALID_STATE', '기록 형식이나 입력값을 확인해 주세요. 기존 서버 기록은 유지됩니다.'); }
      if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) throw S.apiError(413, 'PAYLOAD_TOO_LARGE', '서버 기록이 허용 크기를 넘었습니다.');
      const requestHash = S.digest(S.stableJSON({ expectedVersion: body.expectedVersion, state: body.state }), 'formday/operation/v1');
      const result = await repository.putState(auth, { expectedVersion: body.expectedVersion, operationId: body.operationId, requestHash, state }, now);
      send(response, 200, result);
      }); return;
    }
    if (!pathname.startsWith('/api/auth/') || method !== 'POST') throw S.apiError(404, 'NOT_FOUND', 'API 경로를 찾을 수 없습니다.');
    unsafe(request);
    const ip = clientIP(request, trustProxyHops);
    if (['/api/auth/register', '/api/auth/login', '/api/auth/recover'].includes(pathname)) {
      const body = await readJSON(request, MAX_AUTH_BYTES), name = S.username(body.username);
      const kind = pathname.split('/').at(-1);
      await limits(kind, ip, name, now);
      if (kind === 'register') {
        S.password(body.password);
        const passwordHash = await passwords.hash(body.password), recoveryCode = S.randomToken(), session = S.newSession(now);
        const user = { id: crypto.randomUUID(), username: name, passwordHash, recoveryHash: S.recoveryHash(recoveryCode), authVersion: 1, createdAt: new Date(now).toISOString() };
        const old = S.cookieToken(request.headers.cookie);
        await repository.register(user, session, old ? S.sessionHash(old) : null);
        send(response, 201, attachSession(response, user, session, recoveryCode)); return;
      }
      if (kind === 'login') {
        S.password(body.password);
        const user = await repository.findUser(name);
        const valid = await passwords.verify(body.password, user ? user.passwordHash : null);
        if (!user || !valid) throw invalidAuth();
        const session = S.newSession(now), old = S.cookieToken(request.headers.cookie);
        const current = await repository.createSession(user.id, user.authVersion, session, old ? S.sessionHash(old) : null);
        send(response, 200, attachSession(response, current, session)); return;
      }
      S.password(body.newPassword);
      const user = await repository.findUser(name);
      const suppliedHash = S.recoveryHash(S.tokenValid(body.recoveryCode) ? body.recoveryCode : 'invalid');
      const matches = S.equalText(suppliedHash, user ? user.recoveryHash : '0'.repeat(64));
      if (!user || !S.tokenValid(body.recoveryCode) || !matches) throw S.apiError(401, 'INVALID_RECOVERY', '아이디 또는 복구코드를 확인해 주세요.');
      const passwordHash = await passwords.hash(body.newPassword), recoveryCode = S.randomToken();
      await repository.recover(user.id, suppliedHash, passwordHash, S.recoveryHash(recoveryCode));
      response.setHeader('Set-Cookie', S.clearCookie()); send(response, 200, { recoveryCode }); return;
    }
    if (pathname === '/api/auth/logout') {
      const auth = await authFor(request, now, false);
      if (auth) checkCSRF(request, auth);
      await readJSON(request, MAX_AUTH_BYTES);
      if (auth) await repository.logout(auth, now);
      response.setHeader('Set-Cookie', S.clearCookie()); send(response, 204); return;
    }
    if (['/api/auth/password', '/api/auth/delete'].includes(pathname)) {
      const auth = await authFor(request, now); checkCSRF(request, auth);
      await limits('credential', ip, auth.userId, now);
      const body = await readJSON(request, MAX_AUTH_BYTES), user = await repository.findUserById(auth.userId);
      const current = pathname.endsWith('/password') ? body.currentPassword : body.password;
      S.password(current);
      if (!await passwords.verify(current, user ? user.passwordHash : null) || !user) throw invalidAuth();
      if (pathname.endsWith('/password')) {
        S.password(body.newPassword);
        const hash = await passwords.hash(body.newPassword), recoveryCode = S.randomToken();
        await repository.changePassword(auth, user.passwordHash, hash, S.recoveryHash(recoveryCode), now);
        response.setHeader('Set-Cookie', S.clearCookie()); send(response, 200, { recoveryCode }); return;
      }
      await repository.deleteAccount(auth, user.passwordHash, now);
      response.setHeader('Set-Cookie', S.clearCookie()); send(response, 204); return;
    }
    throw S.apiError(404, 'NOT_FOUND', 'API 경로를 찾을 수 없습니다.');
  }

  const server = http.createServer({ maxHeaderSize: 16384 }, (request, response) => {
    // Disconnected or rejected uploads must not become unhandled stream errors.
    request.on('error', () => {});
    securityHeaders(response);
    route(request, response).catch(error => {
      if (response.destroyed || response.writableEnded) return;
      const known = Number.isInteger(error.status) && error.status >= 400 && error.status < 600;
      if (!known) {
        // Do not log URLs, headers, request bodies, usernames, DB errors or stacks.
        try { logger({ event: 'request_failed', code: 'INTERNAL', requestId: crypto.randomUUID() }); } catch {}
      }
      const status = known ? error.status : 503, extra = known ? error.extra || {} : {};
      if (extra.retryAfter) response.setHeader('Retry-After', String(extra.retryAfter));
      if (status === 413) { response.setHeader('Connection', 'close'); request.resume(); }
      send(response, status, { error: { code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? error.message : '서버에 연결하지 못했습니다. 입력 내용은 브라우저에서 보관한 뒤 다시 시도해 주세요.' }, ...extra });
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

module.exports = { createServer, MAX_AUTH_BYTES, MAX_STATE_BYTES, clientIP };
