'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { databaseOptions } = require('./config.cjs');

async function migrate(pool) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(64119,1)');
    await client.query(await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}

async function main() {
  const options = databaseOptions(process.env);
  const { Pool } = require('pg');
  const pool = new Pool(options);
  pool.on('error', () => {});
  try { await migrate(pool); process.stdout.write('FORMDAY database schema is ready.\n'); }
  finally { await pool.end(); }
}

if (require.main === module) main().catch(() => { process.stderr.write('FORMDAY migration failed. Check configuration and database availability. No credentials or document data are logged.\n'); process.exitCode = 1; });
module.exports = { migrate };
