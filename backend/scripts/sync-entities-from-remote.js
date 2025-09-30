#!/usr/bin/env node
/**
 * Synchronise des entités depuis la base distante (MySQL) vers la base locale (SQLite via pool).
 * Support: categories (global), designations (par user), mouvements (par user).
 *
 * Usage:
 *   node backend/scripts/sync-entities-from-remote.js --entity categories|designations|mouvements --user 6 [--apply]
 *   node backend/scripts/sync-entities-from-remote.js --entity all --user 6 [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const localPool = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const args = { entity: 'all', user: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--entity' && i + 1 < argv.length) { args.entity = String(argv[++i]).toLowerCase(); continue; }
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--apply') { args.apply = true; continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'entity') args.entity = String(v).toLowerCase();
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'apply') args.apply = v === 'true' || v === '';
    }
  }
  if (!remotePool) throw new Error('Remote DB non configurée (REMOTE_DB_*)');
  if (!['categories','designations','mouvements','all'].includes(args.entity)) throw new Error('Entité invalide');
  if (args.entity !== 'categories' && (!Number.isInteger(args.user) || args.user < 1)) throw new Error('Paramètre --user requis');
  return args;
}

async function ensureLocalUser(conn, userId) {
  const [u] = await conn.query('SELECT id FROM users WHERE id = ?', [userId]);
  if (u.length === 0) {
    await conn.query('INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)', [userId, `User ${userId}`, `user${userId}@local`, '']);
  }
}

async function syncCategories(apply) {
  const rconn = await remotePool.getConnection();
  const lconn = await localPool.getConnection();
  try {
    const [rows] = await rconn.query('SELECT id, name FROM stock_categories ORDER BY id ASC');
    console.log(`[categories] distant=${rows.length}`);
    const [lBefore] = await lconn.query('SELECT COUNT(*) as c FROM stock_categories');
    console.log(`[categories] local avant=${(lBefore[0]?.c) ?? 0}`);
    if (!apply) { console.log('[categories] Mode simulation. Ajoutez --apply pour synchroniser.'); return; }
    await lconn.beginTransaction();
    try {
      await lconn.query('DELETE FROM stock_categories');
      for (const c of rows) {
        await lconn.query('INSERT INTO stock_categories (id, name) VALUES (?, ?)', [c.id, c.name]);
      }
      await lconn.commit();
      console.log(`[categories] Synchro effectuée: ${rows.length} catégories.`);
    } catch (e) { await lconn.rollback(); throw e; }
  } finally { rconn.release(); lconn.release(); }
}

async function syncDesignations(userId, apply) {
  const rconn = await remotePool.getConnection();
  const lconn = await localPool.getConnection();
  try {
    const [rows] = await rconn.query('SELECT id, user_id, name, current_stock, categorie FROM stock_designations WHERE user_id = ? ORDER BY id ASC', [userId]);
    console.log(`[designations] user=${userId} distant=${rows.length}`);
    await ensureLocalUser(lconn, userId);
    const [lBefore] = await lconn.query('SELECT COUNT(*) as c FROM stock_designations WHERE user_id = ?', [userId]);
    console.log(`[designations] local avant=${(lBefore[0]?.c) ?? 0}`);
    if (!apply) { console.log('[designations] Mode simulation. Ajoutez --apply pour synchroniser.'); return; }
    await lconn.beginTransaction();
    try {
      await lconn.query('DELETE FROM stock_designations WHERE user_id = ?', [userId]);
      for (const d of rows) {
        await lconn.query('INSERT INTO stock_designations (id, user_id, name, current_stock, categorie) VALUES (?, ?, ?, ?, ?)', [d.id, userId, d.name, Number(d.current_stock || 0), d.categorie || null]);
      }
      await lconn.commit();
      console.log(`[designations] Synchro effectuée: ${rows.length} produits.`);
    } catch (e) { await lconn.rollback(); throw e; }
  } finally { rconn.release(); lconn.release(); }
}

async function syncMouvements(userId, apply) {
  const rconn = await remotePool.getConnection();
  const lconn = await localPool.getConnection();
  try {
    const [rows] = await rconn.query(`SELECT id, user_id, DATE_FORMAT(date,'%Y-%m-%d') as date, type, designation_id, quantite, prix, client_id, stock, stockR FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC`, [userId]);
    console.log(`[mouvements] user=${userId} distant=${rows.length}`);
    await ensureLocalUser(lconn, userId);
    const [lBefore] = await lconn.query('SELECT COUNT(*) as c FROM stock_mouvements WHERE user_id = ?', [userId]);
    console.log(`[mouvements] local avant=${(lBefore[0]?.c) ?? 0}`);
    if (!apply) { console.log('[mouvements] Mode simulation. Ajoutez --apply pour synchroniser.'); return; }
    await lconn.beginTransaction();
    try {
      await lconn.query('DELETE FROM stock_mouvements WHERE user_id = ?', [userId]);
      for (const m of rows) {
        await lconn.query(
          'INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [m.id, userId, m.date, m.type, m.designation_id || null, Number(m.quantite||0), Number(m.prix||0), m.client_id || null, Number(m.stock||0), Number(m.stockR||0)]
        );
      }
      await lconn.commit();
      console.log(`[mouvements] Synchro effectuée: ${rows.length} mouvements.`);
    } catch (e) { await lconn.rollback(); throw e; }
  } finally { rconn.release(); lconn.release(); }
}

async function main() {
  const { entity, user, apply } = parseArgs(process.argv);
  if (entity === 'all') {
    await syncCategories(apply);
    await syncDesignations(user, apply);
    await syncMouvements(user, apply);
    return;
  }
  if (entity === 'categories') return syncCategories(apply);
  if (entity === 'designations') return syncDesignations(user, apply);
  if (entity === 'mouvements') return syncMouvements(user, apply);
}

main().catch(err => { console.error('Erreur:', err?.stack || err); process.exit(1); });
