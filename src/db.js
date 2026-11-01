import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Providers may close idle sockets. Let the pool replace them without crashing Node.
pool.on('error', error => console.error('PostgreSQL idle connection error:', error.code || error.name));

export default pool;
