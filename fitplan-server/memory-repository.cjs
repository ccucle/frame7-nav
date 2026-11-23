'use strict';

// Explicit test adapter. The production entry point never imports this module.
const { apiError, equalText } = require('./security.cjs');
const copy = value => structuredClone(value);
const unavailable = () => apiError(401, 'AUTH_REQUIRED', '다시 로그인해 주세요.');

function createMemoryRepository() {
  const users = new Map(), sessions = new Map(), documents = new Map(), operations = new Map(), buckets = new Map();

  function authenticate(auth, now) {
    const user = users.get(auth.userId), session = sessions.get(auth.tokenHash);
    if (!user || !session || session.userId !== user.id || session.authVersion !== user.authVersion || auth.authVersion !== user.authVersion || Date.parse(session.expiresAt) <= now) throw unavailable();
    return user;
  }
  function revoke(userId) { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key); }
  function storeSession(user, session, oldHash) {
    if (oldHash) sessions.delete(oldHash);
    sessions.set(session.tokenHash, { userId: user.id, authVersion: user.authVersion, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    const values = [...sessions.entries()].filter(([, value]) => value.userId === user.id);
    for (const [key] of values.slice(0, Math.max(0, values.length - 10))) sessions.delete(key);
  }

  return {
    async ready() { return true; },
    async close() {},
    async findUser(name) { return copy([...users.values()].find(user => user.username === name) || null); },
    async findUserById(id) { return copy(users.get(id) || null); },
    async register(user, session, oldHash) {
      if ([...users.values()].some(value => value.username === user.username)) throw apiError(409, 'USERNAME_UNAVAILABLE', '이 아이디는 사용할 수 없습니다.');
      users.set(user.id, copy(user)); documents.set(user.id, { version: 0, state: null, updatedAt: null });
      storeSession(user, session, oldHash); return copy(user);
    },
    async createSession(userId, expectedAuthVersion, session, oldHash) {
      const user = users.get(userId);
      if (!user || user.authVersion !== expectedAuthVersion) throw unavailable();
      storeSession(user, session, oldHash); return copy(user);
    },
    async getSession(hash, now) {
      const session = sessions.get(hash), user = session && users.get(session.userId);
      if (!session || !user || session.authVersion !== user.authVersion || Date.parse(session.expiresAt) <= now) return null;
      return { user: { id: user.id, username: user.username }, userId: user.id, authVersion: user.authVersion, tokenHash: hash };
    },
    async logout(auth, now) { authenticate(auth, now); sessions.delete(auth.tokenHash); },
    async recover(userId, expectedRecoveryHash, passwordHash, nextRecoveryHash) {
      const user = users.get(userId);
      if (!user || !equalText(user.recoveryHash, expectedRecoveryHash)) throw apiError(401, 'INVALID_RECOVERY', '아이디 또는 복구코드를 확인해 주세요.');
      user.passwordHash = passwordHash; user.recoveryHash = nextRecoveryHash; user.authVersion++; revoke(userId);
    },
    async changePassword(auth, expectedHash, passwordHash, nextRecoveryHash, now) {
      const user = authenticate(auth, now);
      if (!equalText(user.passwordHash, expectedHash)) throw unavailable();
      user.passwordHash = passwordHash; user.recoveryHash = nextRecoveryHash; user.authVersion++; revoke(user.id);
    },
    async deleteAccount(auth, expectedHash, now) {
      const user = authenticate(auth, now);
      if (!equalText(user.passwordHash, expectedHash)) throw unavailable();
      revoke(user.id); users.delete(user.id); documents.delete(user.id); operations.delete(user.id);
    },
    async getState(auth, now) { authenticate(auth, now); return { userId: auth.userId, ...copy(documents.get(auth.userId)) }; },
    async putState(auth, request, now) {
      authenticate(auth, now);
      const current = documents.get(auth.userId), history = operations.get(auth.userId) || new Map(), prior = history.get(request.operationId);
      if (prior) {
        if (prior.requestHash !== request.requestHash || prior.expectedVersion !== request.expectedVersion) throw apiError(409, 'IDEMPOTENCY_CONFLICT', '이미 사용한 작업 번호입니다. 최신 기록을 확인해 주세요.', { userId: auth.userId, version: current.version });
        return copy(prior.response);
      }
      if (current.version !== request.expectedVersion) throw apiError(409, 'CONFLICT', '서버 기록이 변경되었습니다. 최신 기록을 확인해 주세요.', { userId: auth.userId, version: current.version });
      const next = { userId: auth.userId, version: current.version + 1, state: copy(request.state), updatedAt: new Date(now).toISOString() };
      documents.set(auth.userId, { version: next.version, state: copy(next.state), updatedAt: next.updatedAt });
      history.set(request.operationId, { requestHash: request.requestHash, expectedVersion: request.expectedVersion, response: copy(next), createdAt: now });
      while (history.size > 32) history.delete(history.keys().next().value);
      operations.set(auth.userId, history); return copy(next);
    },
    async consumeRateLimits(rules, now) {
      let retryAfter = 0;
      for (const rule of rules) {
        const start = Math.floor(now / rule.windowMs) * rule.windowMs, key = rule.key + ':' + start;
        const bucket = buckets.get(key) || { hits: 0, expiresAt: start + rule.windowMs };
        bucket.hits++; buckets.set(key, bucket);
        if (bucket.hits > rule.limit) retryAfter = Math.max(retryAfter, Math.ceil((bucket.expiresAt - now) / 1000));
      }
      return retryAfter;
    },
    async cleanup(now) {
      for (const [key, value] of sessions) if (Date.parse(value.expiresAt) <= now) sessions.delete(key);
      for (const [key, value] of buckets) if (value.expiresAt <= now) buckets.delete(key);
      for (const history of operations.values()) for (const [key, value] of history) if (value.createdAt <= now - 7 * 86400000) history.delete(key);
    },
    inspect() { return copy({ users: [...users.values()], sessions: [...sessions.values()], documents: [...documents.entries()], operations: [...operations.entries()] }); }
  };
}

module.exports = { createMemoryRepository };
