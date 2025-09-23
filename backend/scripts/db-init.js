// DB init runner supporting MySQL and SQLite via config/db adapter
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../config/db');

async function run() {
  const DRIVER = (process.env.DB_DRIVER || 'mysql').toLowerCase();
  const sqlFile = DRIVER === 'sqlite' || DRIVER === 'sqlite3'
    ? '001_init.sqlite.sql'
    : '001_init.sql';

  const sqlPath = path.join(__dirname, '..', 'sql', sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error('SQL file not found:', sqlPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(sqlPath, 'utf8');

  if (DRIVER === 'sqlite' || DRIVER === 'sqlite3') {
    const Database = require('better-sqlite3');
    const sqliteFile = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');
    const dir = path.dirname(sqliteFile);
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(sqliteFile);
    try {
      console.log('Connected to SQLite:', sqliteFile);
      db.exec(raw); // can execute multiple statements including PRAGMA
      console.log('SQLite schema applied successfully.');
    } catch (err) {
      console.error('SQLite init error:', err.message || err);
      process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }

  // MySQL path
  const mysql = require('mysql2/promise');
  const statements = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    console.log('Connected to MySQL:', process.env.DB_NAME);
    for (const [i, stmt] of statements.entries()) {
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
      process.stdout.write(`Executing [${i + 1}/${statements.length}]: ${preview}... `);
      await conn.query(stmt);
      process.stdout.write('OK\n');
    }
    console.log('MySQL schema applied successfully.');
  } catch (err) {
    console.error('\nMySQL init error:', err.message || err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

run();
