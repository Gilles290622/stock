#!/usr/bin/env node
// Liste les tables de la base SQLite (hors tables internes sqlite_*)
require('dotenv').config();
const path = require('path');
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const db = require('../config/db');

(async () => {
  try {
    const [rows] = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (!rows || rows.length === 0) {
      console.log('Aucune table trouvée.');
      return;
    }
    for (const r of rows) {
      console.log(r.name);
    }
  } catch (e) {
    console.error('Erreur lors de la lecture des tables:', e && (e.message || e));
    process.exit(1);
  }
})();
