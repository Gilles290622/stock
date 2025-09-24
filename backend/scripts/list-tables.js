#!/usr/bin/env node
// Liste les tables pour SQLite ou MySQL selon DB_DRIVER
require('dotenv').config();
const db = require('../config/db');

(async () => {
  const DRIVER = (process.env.DB_DRIVER || 'mysql').toLowerCase();
  try {
    let rows;
    if (DRIVER === 'sqlite' || DRIVER === 'sqlite3') {
      [rows] = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      rows = rows.map(r => r.name);
    } else {
      // MySQL: SHOW TABLES retourne des objets { Tables_in_<db>: 'table' }
      const [r] = await db.query('SHOW TABLES');
      rows = (r || []).map(obj => Object.values(obj)[0]).filter(Boolean).sort();
    }

    if (!rows || rows.length === 0) {
      console.log('Aucune table trouvée.');
      return;
    }
    for (const name of rows) {
      console.log(name);
    }
  } catch (e) {
    console.error('Erreur lors de la lecture des tables:', e && (e.message || e));
    process.exit(1);
  }
})();
