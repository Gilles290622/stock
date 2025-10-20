#!/usr/bin/env node
// Runs migration files with .mysql.sql suffix against remote MySQL using REMOTE_DB_* config
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const remoteDb = require('../config/remoteDb');

(async () => {
  try {
    if (!remoteDb) {
      console.error('Remote DB non configurée (REMOTE_DB_*)');
      process.exit(2);
    }
    const conn = await remoteDb.getConnection();
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      const [doneRows] = await conn.execute('SELECT name FROM migrations');
      const done = new Set(doneRows.map(r => r.name));
      const dir = path.join(__dirname, '..', 'sql', 'migrations');
      const all = fs.readdirSync(dir).filter(f => f.endsWith('.mysql.sql')).sort();
      const applied = [];
      for (const f of all) {
        if (done.has(f)) { continue; }
        const sql = fs.readFileSync(path.join(dir, f), 'utf8').trim();
        if (!sql) continue;
        try {
          await conn.query(sql);
          await conn.execute('INSERT INTO migrations (name) VALUES (?)', [f]);
          applied.push(f);
          console.log('[remote migrate] Success', f);
        } catch (e) {
          console.error('[remote migrate] Failed', f, e.message || e);
          process.exit(1);
        }
      }
      console.log('[remote migrate] Done. Applied:', applied.length);
    } finally { conn.release(); }
  } catch (e) {
    console.error('Erreur migrations distantes:', e && (e.message || e));
    process.exit(1);
  }
})();
