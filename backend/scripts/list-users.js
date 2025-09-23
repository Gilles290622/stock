#!/usr/bin/env node
// Liste les utilisateurs existants (id, full_name, email, created_at)
require('dotenv').config();
const path = require('path');
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const db = require('../config/db');

(async () => {
  try {
    const [rows] = await db.query('SELECT id, full_name, email, created_at FROM users ORDER BY id ASC');
    if (!rows || rows.length === 0) {
      console.log('Aucun utilisateur trouvé.');
      return;
    }
    for (const u of rows) {
      console.log(`${u.id}\t${u.full_name}\t${u.email}\t${u.created_at || ''}`);
    }
  } catch (e) {
    console.error('Erreur lors de la lecture des utilisateurs:', e && (e.message || e));
    process.exit(1);
  }
})();
