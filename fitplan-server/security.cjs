'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
const COOKIE_NAME = '__Host-FORMDAY_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function apiError(status, code, message, extra) {
  const error = new Error(message); error.status = status; error.code = code; error.extra = extra || {}; return error;
}

function username(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{4,32}$/.test(value)) throw apiError(422, 'INVALID_USERNAME', '아이디는 영문, 숫자, 마침표, 밑줄, 하이픈으로 4~32자 입력해 주세요.');
  return value.toLowerCase();
}

function password(value) {
  if (typeof value !== 'string' || Array.from(value).length < 15 || Array.from(value).length > 128 || Buffer.byteLength(value, 'utf8') > 512 || Buffer.from(value, 'utf8').toString('utf8') !== value) throw apiError(422, 'INVALID_PASSWORD', '비밀번호는 15~128자로 입력해 주세요.');
  return value;
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const tokenValid = value => typeof value === 'string' && TOKEN.test(value);
const digest = (value, domain) => crypto.createHash('sha256').update(domain + '\0').update(value).digest('hex');
const sessionHash = value => digest(value, 'formday/session/v1');
const recoveryHash = value => digest(value, 'formday/recovery/v1');
const csrfToken = value => crypto.createHmac('sha256', value).update('formday/csrf/v1').digest('base64url');

function equalText(a, b) {
  const left = crypto.createHash('sha256').update(typeof a === 'string' ? a : '').digest();
  const right = crypto.createHash('sha256').update(typeof b === 'string' ? b : '').digest();
  return crypto.timingSafeEqual(left, right) && typeof a === 'string' && typeof b === 'string';
}

function newSession(now) {
  const token = randomToken();
  return { token, tokenHash: sessionHash(token), expiresAt: new Date(now + SESSION_TTL_MS).toISOString() };
}

function sessionCookie(token) {
  return COOKIE_NAME + '=' + token + '; Path=/; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) + '; Secure; HttpOnly; SameSite=Lax';
}

function clearCookie() { return COOKIE_NAME + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax'; }

function cookieToken(header) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const found = header.split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE_NAME + '='));
  if (found.length !== 1) return null;
  const value = found[0].slice(COOKIE_NAME.length + 1);
  return tokenValid(value) ? value : null;
}

function createPasswordService() {
  let running = 0;
  const queue = [];
  const dummySalt = Buffer.from('2e53c643163748773b103b72ed787f86', 'hex');
  const dummyKey = Buffer.alloc(64);

  function run(work) {
    return new Promise((resolve, reject) => {
      if (running && queue.length >= 4) { reject(apiError(503, 'AUTH_BUSY', '인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.')); return; }
      queue.push({ work, resolve, reject });
      pump();
    });
  }
  function pump() {
    if (running || !queue.length) return;
    running = 1;
    const job = queue.shift();
    Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { running = 0; pump(); });
  }
  function parse(encoded) {
    if (typeof encoded !== 'string') return null;
    const bits = encoded.split('$');
    if (bits.length !== 6 || bits[0] !== 'scrypt' || bits[1] !== String(SCRYPT.N) || bits[2] !== '8' || bits[3] !== '1' || !/^[A-Za-z0-9_-]{22}$/.test(bits[4]) || !/^[A-Za-z0-9_-]{86}$/.test(bits[5])) return null;
    const salt = Buffer.from(bits[4], 'base64url'), key = Buffer.from(bits[5], 'base64url');
    if (salt.length !== 16 || key.length !== 64 || salt.toString('base64url') !== bits[4] || key.toString('base64url') !== bits[5]) return null;
    return { salt, key };
  }
  return {
    async hash(value) {
      password(value);
      return run(async () => {
        const salt = crypto.randomBytes(16), key = await scrypt(value, salt, 64, SCRYPT);
        return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
      });
    },
    async verify(value, encoded) {
      password(value);
      const record = parse(encoded);
      return run(async () => {
        const key = await scrypt(value, record ? record.salt : dummySalt, 64, SCRYPT);
        const equal = crypto.timingSafeEqual(key, record ? record.key : dummyKey);
        return !!record && equal;
      });
    }
  };
}

function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

module.exports = { SCRYPT, COOKIE_NAME, SESSION_TTL_MS, apiError, username, password, randomToken, tokenValid, digest, sessionHash, recoveryHash, csrfToken, equalText, newSession, sessionCookie, clearCookie, cookieToken, createPasswordService, stableJSON };
