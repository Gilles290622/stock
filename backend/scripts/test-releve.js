#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

async function main() {
  const userId = Number(process.argv[2] || 6);
  const clientId = Number(process.argv[3] || 294);
  try {
    const sql = `SELECT 
      m.id,
      m.date,
      m.type,
      d.name AS designation,
      m.montant,
      CASE
        WHEN LOWER(m.type) = 'paiement' THEN -ABS(m.montant)
        ELSE ABS(m.montant)
      END AS balance,
      SUM(
        CASE
          WHEN LOWER(m.type) = 'paiement' THEN -ABS(m.montant)
          ELSE ABS(m.montant)
        END
      ) OVER (ORDER BY m.date ASC, m.id ASC) AS solde
    FROM stock_mouvements m
    LEFT JOIN stock_designations d ON m.designation_id = d.id AND d.user_id = m.user_id
    LEFT JOIN stock_clients c ON m.client_id = c.id AND c.user_id = m.user_id
    WHERE m.client_id = ? AND m.user_id = ?
    ORDER BY m.date ASC, m.id ASC`;
    const [rows] = await db.execute(sql, [clientId, userId]);
    console.log('rows:', rows.slice(0, 5));
  } catch (e) {
    console.error('SQL error:', e && (e.message || e));
    console.error('Error object:', e);
    process.exit(1);
  } finally {
    try { if (db && db.end) await db.end(); } catch {}
  }
}

main();
