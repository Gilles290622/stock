#!/usr/bin/env node
// Lists tables on the remote MySQL using REMOTE_DB_* config
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
      const [rows] = await conn.query('SHOW TABLES');
      const names = (rows || []).map(o => Object.values(o)[0]).filter(Boolean).sort();
      if (!names.length) { console.log('Aucune table distante.'); return; }
      for (const n of names) console.log(n);
    } finally { conn.release(); }
  } catch (e) {
    console.error('Erreur remote SHOW TABLES:', e && (e.message || e));
    process.exit(1);
  }
})();
