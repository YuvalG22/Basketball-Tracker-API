import pool from '../src/db.js';
try {
  console.log(JSON.stringify((await pool.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position`)).rows));
  console.log(JSON.stringify((await pool.query(`SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace=current_schema()::regnamespace`)).rows));
} catch (error) {
  console.error(error.code || error.name); process.exitCode = 1;
} finally { await pool.end(); }
