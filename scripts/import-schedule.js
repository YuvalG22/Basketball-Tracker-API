import pool from '../src/db.js';
import { transaction } from '../src/syncStore.js';
import { migrateSyncSchema } from '../src/syncSchema.js';
import { loadSchedule, importSchedule } from '../src/scheduleImport.js';
try {
  const fixtures = await loadSchedule();
  const result = await transaction(async db => {
    await migrateSyncSchema(db);
    return importSchedule(db, fixtures);
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('Schedule import failed:', error.code || error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
