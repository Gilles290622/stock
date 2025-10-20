#!/usr/bin/env node
// Upsert a single entreprise name into local DB (SQLite or current DB config)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

function parseArgs(argv){
  const out = { name: '' };
  for (let i=2;i<argv.length;i++){
    const a = String(argv[i]);
    if (a === '--name') { out.name = String(argv[i+1] || '').trim(); i++; continue; }
    if (a.startsWith('--name=')) { out.name = a.split('=')[1]; continue; }
    // Ignore other flags; only accept positional if not starting with '--'
    if (!out.name && !a.startsWith('--')) out.name = a;
  }
  return out;
}

(async () => {
  try {
    const { name } = parseArgs(process.argv);
    const n = (name || '').trim();
    if (!n) { console.error('Usage: node scripts/upsert-entreprise.js --name ELMORIJAH'); process.exit(2); }
    // Create table if not exists (works for SQLite and MySQL variants)
    await db.execute(`CREATE TABLE IF NOT EXISTS stock_entreprise (
      id ${ (process.env.DB_DRIVER||'').toLowerCase().startsWith('sqlite') ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY' },
      name ${ (process.env.DB_DRIVER||'').toLowerCase().startsWith('sqlite') ? 'TEXT' : 'VARCHAR(255)' } NOT NULL UNIQUE,
      created_at ${ (process.env.DB_DRIVER||'').toLowerCase().startsWith('sqlite') ? "TEXT DEFAULT (datetime('now'))" : 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP' }
    )`);
    // Upsert name (SQLite: INSERT OR IGNORE; MySQL: ON DUPLICATE KEY UPDATE)
    if ((process.env.DB_DRIVER||'').toLowerCase().startsWith('sqlite')){
      await db.execute('INSERT OR IGNORE INTO stock_entreprise (name) VALUES (?)', [n]);
    } else {
      await db.execute('INSERT INTO stock_entreprise (name) VALUES (?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [n]);
    }
    const [rows] = await db.execute('SELECT id, name FROM stock_entreprise WHERE name = ? LIMIT 1', [n]);
    if (rows && rows.length) console.log('Upserted:', rows[0]);
    else console.log('No row found after upsert (unexpected).');
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
})();
