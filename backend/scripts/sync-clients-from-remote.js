#!/usr/bin/env node
/**
 * Synchronise les clients de user=6 à partir de la base distante (id>=294).
 * 1. Supprime les clients id>=294 pour user=6 sur la base distante (si demandé)
 * 2. Exporte ces clients depuis la base distante
 * 3. Remplace les clients de user=6 en local par ce jeu de données
 *
 * Usage:
 *   node backend/scripts/sync-clients-from-remote.js [--user 6] [--min-id 294] [--max-id 293] [--delete-remote] [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const localPool = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const args = { user: 6, minId: null, maxId: null, deleteRemote: false, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--min-id' && i + 1 < argv.length) { args.minId = parseInt(argv[++i], 10); continue; }
    if (a === '--max-id' && i + 1 < argv.length) { args.maxId = parseInt(argv[++i], 10); continue; }
    if (a === '--delete-remote') { args.deleteRemote = true; continue; }
    if (a === '--apply') { args.apply = true; continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'min-id') args.minId = parseInt(v, 10);
      if (k === 'max-id') args.maxId = parseInt(v, 10);
      if (k === 'delete-remote') args.deleteRemote = v === 'true' || v === '';
      if (k === 'apply') args.apply = v === 'true' || v === '';
    }
  }
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user invalide');
  if (args.minId != null && (!Number.isInteger(args.minId) || args.minId < 1)) throw new Error('Paramètre --min-id invalide');
  if (args.maxId != null && (!Number.isInteger(args.maxId) || args.maxId < 1)) throw new Error('Paramètre --max-id invalide');
  return args;
}

async function main() {
  const { user, minId, maxId, deleteRemote, apply } = parseArgs(process.argv);
  if (!remotePool) throw new Error('Remote DB non configurée');
  // 1. Supprimer les clients id>=minId pour user=6 sur la base distante
  if (deleteRemote) {
    const conn = await remotePool.getConnection();
    try {
      if (!Number.isInteger(minId)) throw new Error('delete-remote nécessite --min-id');
      const [toDel] = await conn.query('SELECT id, name FROM stock_clients WHERE user_id = ? AND id >= ?', [user, minId]);
      console.log(`[remote] Clients à supprimer (id>=${minId}, user=${user}): ${toDel.length}`);
      if (toDel.length > 0) {
        const sample = toDel.slice(0, 10).map(r => `${r.id}:${r.name}`);
        console.log('[remote] Exemples:', sample);
      }
      if (apply && toDel.length > 0) {
        await conn.beginTransaction();
        try {
          await conn.query('DELETE FROM stock_clients WHERE user_id = ? AND id >= ?', [user, minId]);
          await conn.commit();
          console.log(`[remote] Suppression effectuée.`);
        } catch (e) { await conn.rollback(); throw e; }
      } else {
        console.log('[remote] Mode simulation. Ajoutez --apply pour supprimer.');
      }
    } finally { conn.release(); }
  }

  // 2. Exporter les clients pour user=6 depuis la base distante (sans colonne contact), avec filtres optionnels (minId/maxId)
  let remoteClients = [];
  {
    const conn = await remotePool.getConnection();
    try {
      // Vérifier les colonnes existantes sur la base distante
      const [cols] = await conn.query("SHOW COLUMNS FROM stock_clients");
      const colNames = cols.map(c => c.Field);
      // Colonnes minimales: id, user_id, name, address, phone, email
      const selectCols = ['id', 'name', 'address', 'phone', 'email'].filter(c => colNames.includes(c));
      if (!selectCols.includes('id') || !selectCols.includes('name')) throw new Error('Colonnes id et name requises sur la base distante');
      const conds = ['user_id = ?'];
      const params = [user];
      if (Number.isInteger(minId)) { conds.push('id >= ?'); params.push(minId); }
      if (Number.isInteger(maxId)) { conds.push('id <= ?'); params.push(maxId); }
      const sql = `SELECT ${selectCols.join(', ')} FROM stock_clients WHERE ${conds.join(' AND ')} ORDER BY id ASC`;
      const [rows] = await conn.query(sql, params);
      remoteClients = rows;
      console.log(`[remote] Clients exportés (user=${user}${Number.isInteger(minId)?`, id>=${minId}`:''}${Number.isInteger(maxId)?`, id<=${maxId}`:''}): ${rows.length}`);
      if (rows.length > 0) {
        const sample = rows.slice(0, 10).map(r => `${r.id}:${r.name}`);
        console.log('[remote] Exemples export:', sample);
      }
    } finally { conn.release(); }
  }

  // 3. Remplacer les clients de user=6 en local par ce jeu de données
  if (remoteClients.length === 0) {
    console.log('Aucun client à synchroniser.');
    return;
  }
  const conn = await localPool.getConnection();
  try {
    // S'assurer que l'utilisateur existe en local (FK stock_clients.user_id -> users.id)
    const [u] = await conn.query('SELECT id FROM users WHERE id = ?', [user]);
    if (u.length === 0) {
      console.log(`[local] Utilisateur ${user} absent. Création d'un utilisateur local placeholder...`);
      await conn.query(
        'INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)',
        [user, `User ${user}`, `user${user}@local`, '']
      );
    }

    const [localBefore] = await conn.query('SELECT id, name FROM stock_clients WHERE user_id = ?', [user]);
    console.log(`[local] Clients avant synchro (user=${user}): ${localBefore.length}`);
    if (apply) {
      await conn.beginTransaction();
      try {
        await conn.query('DELETE FROM stock_clients WHERE user_id = ?', [user]);
        for (const c of remoteClients) {
          // Adapter à la structure locale (contact peut exister en local)
          await conn.query('INSERT INTO stock_clients (id, user_id, name, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [c.id, user, c.name, c.address || null, c.phone || null, c.email || null]);
        }
        await conn.commit();
        console.log(`[local] Synchro terminée: ${remoteClients.length} clients importés.`);
      } catch (e) { await conn.rollback(); throw e; }
    } else {
      console.log(`[local] Mode simulation. Ajoutez --apply pour synchroniser.`);
    }
  } finally { conn.release(); }
}

main().catch(err => { console.error('Erreur:', err?.stack || err); process.exit(1); });