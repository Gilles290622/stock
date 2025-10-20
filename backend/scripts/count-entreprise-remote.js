#!/usr/bin/env node
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
      const [rows] = await conn.execute('SELECT COUNT(*) as c FROM stock_entreprise');
      const count = Array.isArray(rows) && rows.length ? (rows[0].c || rows[0].C || Object.values(rows[0])[0]) : 0;
      console.log('remote.stock_entreprise.count =', count);
      const [sample] = await conn.execute('SELECT id, name FROM stock_entreprise ORDER BY id ASC LIMIT 5');
      if (Array.isArray(sample) && sample.length) {
        console.log('remote.sample:');
        for (const r of sample) console.log(`${r.id}\t${r.name}`);
      }
    } finally { conn.release(); }
  } catch (e) {
    console.error('Erreur:', e.message || e);
    process.exit(1);
  }
})();
