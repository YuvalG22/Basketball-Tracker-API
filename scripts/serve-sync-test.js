import pool from '../src/db.js';
import { createApp } from '../src/app.js';
import { migrateSyncSchema } from '../src/syncSchema.js';

// Isolated HTTP target for SyncEndToEndTest. Never migrates or writes public tables.
const db = await pool.connect();
db.on('error', error => { console.error('Temporary test connection closed:', error.code); process.exit(1); });
await db.query('BEGIN');
await db.query('SET LOCAL search_path = pg_temp');
for (const table of ['games', 'players', 'events', 'roster'])
  await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
await migrateSyncSchema(db, {lock:false});

let tail = Promise.resolve();
const database = {
  query: (...args) => db.query(...args),
  async connect() {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    return {
      query: (sql, args) => db.query(sql === 'BEGIN' ? 'SAVEPOINT request' :
        sql === 'COMMIT' ? 'RELEASE SAVEPOINT request' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT request' : sql, args),
      release: unlock
    };
  }
};
const server = createApp(database).listen(3101, '127.0.0.1', () => console.log('SYNC_TEST_READY port=3101 TEMP_TABLES_ONLY'));
const keepalive = setInterval(() => db.query('SELECT 1').catch(() => {}), 15000);
async function shutdown() {
  clearInterval(keepalive);
  server.close();
  await db.query('ROLLBACK');
  db.release();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
