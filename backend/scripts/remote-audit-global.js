#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const remote = require('../config/remoteDb');

(async () => {
  try {
    if (!remote) {
      console.error('Remote DB non configurée. Définissez REMOTE_DB_*.');
      process.exit(2);
    }
    const conn = await remote.getConnection();
    try {
      const queries = {
        entreprises: `SELECT id, name, global_code FROM stock_entreprise ORDER BY id`,
        clients: `SELECT global_id, COUNT(*) AS n FROM stock_clients GROUP BY global_id ORDER BY global_id`,
        designations: `SELECT global_id, COUNT(*) AS n FROM stock_designations GROUP BY global_id ORDER BY global_id`,
        mouvements: `SELECT global_id, COUNT(*) AS n FROM stock_mouvements GROUP BY global_id ORDER BY global_id`,
        paiements: `SELECT global_id, COUNT(*) AS n FROM stock_paiements GROUP BY global_id ORDER BY global_id`,
        depenses: `SELECT global_id, COUNT(*) AS n FROM stock_depenses GROUP BY global_id ORDER BY global_id`
      };
      console.log('=== Remote Entreprises ===');
      const [erows] = await conn.query(queries.entreprises);
      console.table(erows);
      for (const k of ['clients','designations','mouvements','paiements','depenses']) {
        try {
          const [rows] = await conn.query(queries[k]);
          console.log(`=== Remote ${k} by global_id ===`);
          console.table(rows);
        } catch (e) {
          console.warn(`Skip ${k}:`, e.message || e);
        }
      }
    } finally { conn.release(); }
  } catch (e) {
    console.error('remote-audit-global error:', e?.message || e);
    process.exit(1);
  }
})();
