#!/usr/bin/env node
// Ajoute la colonne 'contact' à stock_clients si absente (SQLite)
require('dotenv').config();
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
const path = require('path');
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const pool = require('../config/db');

(async () => {
  const [rows] = await pool.query("SELECT name FROM pragma_table_info('stock_clients')");
  const hasContact = Array.isArray(rows) && rows.some(r => String(r.name) === 'contact');
  if (hasContact) {
    console.log('Colonne contact déjà présente.');
    return;
  }
  await pool.execute('ALTER TABLE stock_clients ADD COLUMN contact TEXT NULL');
  console.log('Colonne contact ajoutée.');
})().catch(err => {
  console.error('Migration failed:', err && (err.message || err));
  process.exit(1);
});
