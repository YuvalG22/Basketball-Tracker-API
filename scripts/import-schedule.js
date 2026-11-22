import pool from '../src/db.js';
import { transaction } from '../src/syncStore.js';
import { migrateSyncSchema } from '../src/syncSchema.js';
import { loadSchedule, importSchedule } from '../src/scheduleImport.js';
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--update-scheduled')) throw new Error('Unknown schedule import option');
  const fixtures = await loadSchedule();
  const result = await transaction(async db => {
    await migrateSyncSchema(db);
    return importSchedule(db, fixtures, { updateScheduled: args.includes('--update-scheduled') });
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('Schedule import failed:', error.code || error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
