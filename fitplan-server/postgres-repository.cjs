'use strict';

const { apiError, equalText } = require('./security.cjs');
const iso = value => value == null ? null : new Date(value).toISOString();
const unavailable = () => apiError(401, 'AUTH_REQUIRED', '다시 로그인해 주세요.');
const fields = 'id, username, password_hash, recovery_hash, auth_version, created_at';
const userOf = row => row ? { id: row.id, username: row.username, passwordHash: row.password_hash, recoveryHash: row.recovery_hash, authVersion: row.auth_version, createdAt: iso(row.created_at) } : null;

function createPostgresRepository(pool) {
  async function transaction(work) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  async function authRow(client, auth, now) {
    // Credentials and session changes lock this same user row. Recheck the
    // session in a second statement after acquiring the lock (fresh snapshot).
    const result = await client.query('SELECT ' + fields + ' FROM formday.users WHERE id=$1 FOR UPDATE', [auth.userId]);
    const user = userOf(result.rows[0]);
    if (!user || user.authVersion !== auth.authVersion) throw unavailable();
    const session = await client.query('SELECT 1 FROM formday.sessions WHERE token_hash=$1 AND user_id=$2 AND auth_version=$3 AND expires_at>$4::timestamptz', [auth.tokenHash, user.id, user.authVersion, iso(now)]);
    if (!session.rowCount) throw unavailable();
    return user;
  }

  async function storeSession(client, user, session, oldHash) {
    if (oldHash) await client.query('DELETE FROM formday.sessions WHERE token_hash=$1', [oldHash]);
    await client.query('INSERT INTO formday.sessions(token_hash,user_id,auth_version,expires_at,created_at) VALUES($1,$2,$3,$4::timestamptz,clock_timestamp())', [session.tokenHash, user.id, user.authVersion, session.expiresAt]);
    // Keep the new cookie plus at most nine other sessions; no raw token is stored.
    await client.query('DELETE FROM formday.sessions WHERE user_id=$1 AND token_hash IN (SELECT token_hash FROM formday.sessions WHERE user_id=$1 AND token_hash<>$2 ORDER BY created_at DESC,token_hash DESC OFFSET 9)', [user.id, session.tokenHash]);
  }

  function documentOf(userId, row) {
    if (!row) throw new Error('DOCUMENT_MISSING');
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('DOCUMENT_VERSION_INVALID');
    return { userId, version, state: row.document, updatedAt: iso(row.updated_at) };
  }

  return {
    async ready() { const result = await pool.query('SELECT version FROM formday.schema_migrations WHERE version=1'); return result.rowCount === 1; },
    async close() { await pool.end(); },
    async findUser(name) { const result = await pool.query('SELECT ' + fields + ' FROM formday.users WHERE username=$1', [name]); return userOf(result.rows[0]); },
    async findUserById(id) { const result = await pool.query('SELECT ' + fields + ' FROM formday.users WHERE id=$1', [id]); return userOf(result.rows[0]); },
    async register(user, session, oldHash) {
      try {
        return await transaction(async client => {
          await client.query('INSERT INTO formday.users(id,username,password_hash,recovery_hash,auth_version) VALUES($1,$2,$3,$4,1)', [user.id, user.username, user.passwordHash, user.recoveryHash]);
          await client.query('INSERT INTO formday.documents(user_id) VALUES($1)', [user.id]);
          await storeSession(client, user, session, oldHash); return user;
        });
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'users_username_key') throw apiError(409, 'USERNAME_UNAVAILABLE', '이 아이디는 사용할 수 없습니다.');
        throw error;
      }
    },
    async createSession(userId, expectedAuthVersion, session, oldHash) {
      return transaction(async client => {
        const result = await client.query('SELECT ' + fields + ' FROM formday.users WHERE id=$1 FOR UPDATE', [userId]);
        const user = userOf(result.rows[0]);
        if (!user || user.authVersion !== expectedAuthVersion) throw unavailable();
        await storeSession(client, user, session, oldHash); return user;
      });
    },
    async getSession(hash, now) {
      const result = await pool.query('SELECT u.id,u.username,u.auth_version FROM formday.sessions s JOIN formday.users u ON u.id=s.user_id AND u.auth_version=s.auth_version WHERE s.token_hash=$1 AND s.expires_at>$2::timestamptz', [hash, iso(now)]);
      const row = result.rows[0];
      return row ? { user: { id: row.id, username: row.username }, userId: row.id, authVersion: row.auth_version, tokenHash: hash } : null;
    },
    async logout(auth, now) {
      return transaction(async client => { await authRow(client, auth, now); await client.query('DELETE FROM formday.sessions WHERE token_hash=$1', [auth.tokenHash]); });
    },
    async recover(userId, expectedRecoveryHash, passwordHash, nextRecoveryHash) {
      return transaction(async client => {
        const result = await client.query('SELECT ' + fields + ' FROM formday.users WHERE id=$1 FOR UPDATE', [userId]);
        const user = userOf(result.rows[0]);
        if (!user || !equalText(user.recoveryHash, expectedRecoveryHash)) throw apiError(401, 'INVALID_RECOVERY', '아이디 또는 복구코드를 확인해 주세요.');
        await client.query('UPDATE formday.users SET password_hash=$1,recovery_hash=$2,auth_version=auth_version+1 WHERE id=$3', [passwordHash, nextRecoveryHash, user.id]);
        await client.query('DELETE FROM formday.sessions WHERE user_id=$1', [user.id]);
      });
    },
    async changePassword(auth, expectedHash, passwordHash, nextRecoveryHash, now) {
      return transaction(async client => {
        const user = await authRow(client, auth, now);
        if (!equalText(user.passwordHash, expectedHash)) throw unavailable();
        await client.query('UPDATE formday.users SET password_hash=$1,recovery_hash=$2,auth_version=auth_version+1 WHERE id=$3', [passwordHash, nextRecoveryHash, user.id]);
        await client.query('DELETE FROM formday.sessions WHERE user_id=$1', [user.id]);
      });
    },
    async deleteAccount(auth, expectedHash, now) {
      return transaction(async client => {
        const user = await authRow(client, auth, now);
        if (!equalText(user.passwordHash, expectedHash)) throw unavailable();
        await client.query('DELETE FROM formday.users WHERE id=$1', [user.id]);
      });
    },
    async getState(auth, now) {
      return transaction(async client => {
        await authRow(client, auth, now);
        const result = await client.query('SELECT version,document,updated_at FROM formday.documents WHERE user_id=$1', [auth.userId]);
        return documentOf(auth.userId, result.rows[0]);
      });
    },
    async putState(auth, request, now) {
      return transaction(async client => {
        await authRow(client, auth, now);
        const currentResult = await client.query('SELECT version,document,updated_at FROM formday.documents WHERE user_id=$1', [auth.userId]);
        const current = documentOf(auth.userId, currentResult.rows[0]);
        const previous = await client.query('SELECT expected_version,request_hash,result_version,result_state,result_updated_at FROM formday.operations WHERE user_id=$1 AND operation_id=$2', [auth.userId, request.operationId]);
        if (previous.rowCount) {
          const row = previous.rows[0];
          if (!equalText(row.request_hash, request.requestHash) || Number(row.expected_version) !== request.expectedVersion) throw apiError(409, 'IDEMPOTENCY_CONFLICT', '이미 사용한 작업 번호입니다. 최신 기록을 확인해 주세요.', { userId: auth.userId, version: current.version });
          return { userId: auth.userId, version: Number(row.result_version), state: row.result_state, updatedAt: iso(row.result_updated_at) };
        }
        const updated = await client.query('UPDATE formday.documents SET document=$1::jsonb,version=version+1,updated_at=$2::timestamptz WHERE user_id=$3 AND version=$4 RETURNING version,document,updated_at', [JSON.stringify(request.state), iso(now), auth.userId, request.expectedVersion]);
        if (!updated.rowCount) throw apiError(409, 'CONFLICT', '서버 기록이 변경되었습니다. 최신 기록을 확인해 주세요.', { userId: auth.userId, version: current.version });
        const next = documentOf(auth.userId, updated.rows[0]);
        await client.query('INSERT INTO formday.operations(user_id,operation_id,expected_version,request_hash,result_version,result_state,result_updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)', [auth.userId, request.operationId, request.expectedVersion, request.requestHash, next.version, JSON.stringify(next.state), next.updatedAt]);
        await client.query('DELETE FROM formday.operations WHERE user_id=$1 AND operation_id IN (SELECT operation_id FROM formday.operations WHERE user_id=$1 ORDER BY result_version DESC OFFSET 32)', [auth.userId]);
        return next;
      });
    },
    async consumeRateLimits(rules, now) {
      return transaction(async client => {
        let retryAfter = 0;
        for (const rule of rules) {
          const start = Math.floor(now / rule.windowMs) * rule.windowMs, expires = start + rule.windowMs;
          const result = await client.query('INSERT INTO formday.rate_buckets(bucket_key,bucket_start,hits,expires_at) VALUES($1,$2,1,$3::timestamptz) ON CONFLICT(bucket_key,bucket_start) DO UPDATE SET hits=formday.rate_buckets.hits+1 RETURNING hits', [rule.key, start, iso(expires)]);
          if (result.rows[0].hits > rule.limit) retryAfter = Math.max(retryAfter, Math.ceil((expires - now) / 1000));
        }
        return retryAfter;
      });
    },
    async cleanup(now) {
      await pool.query('DELETE FROM formday.sessions WHERE expires_at<=$1::timestamptz', [iso(now)]);
      await pool.query('DELETE FROM formday.rate_buckets WHERE expires_at<=$1::timestamptz', [iso(now)]);
      await pool.query('DELETE FROM formday.operations WHERE created_at<=$1::timestamptz', [iso(now - 7 * 86400000)]);
    }
  };
}

module.exports = { createPostgresRepository };
