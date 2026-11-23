'use strict';

const { readConfig } = require('./config.cjs');
const { createPostgresRepository } = require('./postgres-repository.cjs');
const { createServer } = require('./app.cjs');

async function start(env = process.env) {
  const config = readConfig(env);
  const { Pool } = require('pg');
  const pool = new Pool(config.database);
  const log = entry => process.stderr.write(JSON.stringify(entry) + '\n');
  pool.on('error', () => log({ event: 'database_connection_failed' }));
  const repository = createPostgresRepository(pool);
  try { if (!await repository.ready()) throw new Error('SCHEMA_NOT_READY'); }
  catch (error) { await repository.close(); throw error; }
  const server = createServer({ repository, publicOrigin: config.publicOrigin, staticRoot: config.staticRoot, trustProxyHops: config.trustProxyHops, logger: log });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); }); }
  catch (error) { await repository.close(); throw error; }
  const cleanup = setInterval(() => repository.cleanup(Date.now()).catch(() => log({ event: 'database_cleanup_failed' })), 3600000);
  cleanup.unref();
  repository.cleanup(Date.now()).catch(() => log({ event: 'database_cleanup_failed' }));
  let closing = false;
  async function close() {
    if (closing) return; closing = true; clearInterval(cleanup);
    await new Promise(resolve => server.close(resolve));
    await repository.close();
  }
  return { server, repository, close };
}

if (require.main === module) {
  start().then(app => {
    process.stdout.write('FORMDAY account service is ready.\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      const timeout = setTimeout(() => process.exit(1), 10000); timeout.unref();
      app.close().then(() => { clearTimeout(timeout); process.exitCode = 0; }, () => { process.exitCode = 1; });
    });
  }).catch(() => {
    process.stderr.write('FORMDAY account service did not start. Verify DATABASE_URL, PUBLIC_ORIGIN, database TLS and migrations. No account storage was enabled.\n');
    process.exitCode = 1;
  });
}

module.exports = { start };
