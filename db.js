const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/tickets',
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

module.exports = pool;