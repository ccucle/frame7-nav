'use strict';

const path = require('node:path');

function configurationError(message) {
  const error = new Error(message); error.code = 'CONFIGURATION_ERROR'; return error;
}

function validateOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw configurationError('PUBLIC_ORIGIN must be an exact HTTPS origin without a path or trailing slash.'); }
}

function integer(value, fallback, min, max, label) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw configurationError(label + ' is invalid.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw configurationError(label + ' is invalid.');
  return result;
}

function databaseOptions(env) {
  if (!env.DATABASE_URL) throw configurationError('DATABASE_URL is required; accounts never fall back to memory storage.');
  let parsed;
  try { parsed = new URL(env.DATABASE_URL); } catch { throw configurationError('DATABASE_URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2) throw configurationError('DATABASE_URL is invalid.');
  const mode = env.DATABASE_TLS || 'verify-full';
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const renderInternal = env.RENDER === 'true' && /^dpg-[a-z0-9]+-[a-z]$/.test(parsed.hostname) && (!parsed.port || parsed.port === '5432');
  if (!['verify-full', 'render-internal', 'disable'].includes(mode) || (mode === 'disable' && (env.NODE_ENV === 'production' || !localHost)) || (mode === 'render-internal' && !renderInternal)) throw configurationError('Database TLS mode is not allowed for this host or environment.');
  if (mode === 'render-internal' && env.DATABASE_CA_PEM) throw configurationError('Use a verified connection mode when supplying a database CA.');
  const queryMode = parsed.searchParams.get('sslmode');
  if (queryMode && !['require', 'verify-ca', 'verify-full'].includes(queryMode)) throw configurationError('Unsafe database TLS options are not supported.');
  for (const name of ['sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) {
    if (parsed.searchParams.has(name)) throw configurationError('Set database TLS options separately from DATABASE_URL.');
  }
  // pg connection-string SSL parameters can otherwise replace the verified object.
  parsed.searchParams.delete('sslmode');
  return {
    connectionString: parsed.href,
    // Render documents self-signed internal certificates and requires sslmode=require
    // for mandatory internal TLS. This explicit mode is restricted to its private
    // dpg hostname on Render; it never falls back to plaintext or applies externally.
    ssl: mode === 'disable' ? false : mode === 'render-internal' ? { rejectUnauthorized: false, minVersion: 'TLSv1.2' } : { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(env.DATABASE_CA_PEM ? { ca: env.DATABASE_CA_PEM } : {}) },
    enableChannelBinding: true,
    max: integer(env.DATABASE_POOL_SIZE, 6, 1, 20, 'DATABASE_POOL_SIZE'),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 7000,
    lock_timeout: 3000,
    idle_in_transaction_session_timeout: 10000,
    application_name: 'formday'
  };
}

function readConfig(env = process.env) {
  return {
    publicOrigin: validateOrigin(env.PUBLIC_ORIGIN),
    database: databaseOptions(env),
    port: integer(env.PORT, 3000, 1, 65535, 'PORT'),
    host: env.HOST || '0.0.0.0',
    // Set only when the network makes direct access around that proxy impossible.
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0, 0, 5, 'TRUST_PROXY_HOPS'),
    staticRoot: path.resolve(__dirname, '../fitplan')
  };
}

module.exports = { readConfig, databaseOptions, validateOrigin, configurationError };
