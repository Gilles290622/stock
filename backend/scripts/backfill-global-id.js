#!/usr/bin/env node
// Backfill global_id for clients, designations, mouvements, depenses for a given user
// Usage: node backend/scripts/backfill-global-id.js --user 6

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

function parseArgs(argv) {
  const out = { user: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && argv[i+1]) { out.user = parseInt(argv[++i], 10); }
  }
  if (!Number.isInteger(out.user) || out.user < 1) {
    console.error('Usage: node backend/scripts/backfill-global-id.js --user <id>');
    process.exit(1);
  }
  return out;
}

(async () => {
  const { user } = parseArgs(process.argv);
  let conn;
  try {
    conn = await db.getConnection();
    const [[ctx]] = await conn.query(`SELECT e.global_code AS entGlobal FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?`, [user]);
    const entGlobal = ctx ? ctx.entGlobal : null;
    if (entGlobal == null) {
      console.log(`Aucun entGlobal pour user=${user}. Rien à faire.`);
      return;
    }
    await conn.beginTransaction();
    const [c1] = await conn.query('UPDATE stock_clients SET global_id = ? WHERE user_id = ? AND (global_id IS NULL OR global_id = 0)', [entGlobal, user]);
    const [c2] = await conn.query('UPDATE stock_designations SET global_id = ? WHERE user_id = ? AND (global_id IS NULL OR global_id = 0)', [entGlobal, user]);
  const [c3] = await conn.query('UPDATE stock_mouvements SET global_id = ? WHERE user_id = ? AND (global_id IS NULL OR global_id = 0)', [entGlobal, user]);
  const [c4] = await conn.query('UPDATE stock_depenses SET global_id = ? WHERE user_id = ? AND (global_id IS NULL OR global_id = 0)', [entGlobal, user]);
    await conn.commit();
    console.log(`Backfill terminé pour user=${user} -> global_id=${entGlobal}.`);
    console.log('rows changed:', {
      clients: c1?.affectedRows ?? c1?.changes ?? 0,
      designations: c2?.affectedRows ?? c2?.changes ?? 0,
      mouvements: c3?.affectedRows ?? c3?.changes ?? 0,
      depenses: c4?.affectedRows ?? c4?.changes ?? 0
    });
  } catch (e) {
    if (conn) try { await conn.rollback(); } catch {}
    console.error('backfill-global-id error:', e?.message || e);
    process.exit(1);
  } finally {
    if (conn) conn.release();
  }
})();
