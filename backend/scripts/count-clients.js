#!/usr/bin/env node
const path = require('path');

// Force SQLite defaults
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const pool = require('../config/db');

async function main() {
  const user = Number(process.argv[2] || 0);
  if (!Number.isInteger(user) || user < 1) {
    console.error('Usage: node scripts/count-clients.js <userId>');
    process.exit(1);
  }
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT COUNT(*) as c FROM stock_clients WHERE user_id = ?', [user]);
    const c = rows && rows[0] ? rows[0].c : 0;
    console.log(`Clients en base pour user_id=${user}: ${c}`);
  } finally {
    conn.release();
  }
}

main().catch((e) => {
  console.error(e && (e.stack || e.message) || e);
  process.exit(1);
});
