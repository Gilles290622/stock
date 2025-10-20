#!/usr/bin/env node
/**
 * Sync remote stock_entreprise to match local (SQLite) names exactly.
 * - Inserts missing names on remote
 * - Optionally deletes remote-only names (and sets users.entreprise_id = NULL)
 * Usage:
 *   node scripts/sync-entreprise-remote.js [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const localDb = require('../config/db');
const remoteDb = require('../config/remoteDb');

function parseArgs(argv){ return { apply: argv.includes('--apply') }; }

async function getLocalNames(){
  const [rows] = await localDb.execute(`SELECT name FROM stock_entreprise ORDER BY name ASC`);
  return rows.map(r => r.name);
}
async function getRemoteNames(conn){
  const [rows] = await conn.execute('SELECT name FROM stock_entreprise ORDER BY name ASC');
  return rows.map(r => r.name);
}

(async () => {
  try {
    if (!remoteDb) throw new Error('Remote DB non configurée (REMOTE_DB_*)');
    const { apply } = parseArgs(process.argv.map(String));
    const local = await getLocalNames();
    const conn = await remoteDb.getConnection();
    try {
      await conn.execute(`CREATE TABLE IF NOT EXISTS stock_entreprise (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const remote = await getRemoteNames(conn);
      const setLocal = new Set(local);
      const setRemote = new Set(remote);
      const toInsert = local.filter(n => !setRemote.has(n));
      const toDelete = remote.filter(n => !setLocal.has(n));
      console.log('Local names:', local);
      console.log('Remote names:', remote);
      console.log('To insert (remote):', toInsert);
      console.log('To delete (remote):', toDelete);
      if (!apply) { console.log('Dry-run. Ajouter --apply pour appliquer.'); return; }
      await conn.beginTransaction();
      for (const name of toInsert) {
        await conn.execute('INSERT INTO stock_entreprise (name) VALUES (?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [name]);
      }
      if (toDelete.length) {
        // Nullify users.entreprise_id referencing soon-to-be-deleted rows
        const [idsRows] = await conn.execute(
          `SELECT id FROM stock_entreprise WHERE name IN (${toDelete.map(()=>'?').join(',')})`,
          toDelete
        );
        const ids = idsRows.map(r => r.id);
        if (ids.length) {
          await conn.execute(`UPDATE users SET entreprise_id = NULL WHERE entreprise_id IN (${ids.map(()=>'?').join(',')})`, ids);
          await conn.execute(`DELETE FROM stock_entreprise WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
        }
      }
      await conn.commit();
      console.log('Appliqué.');
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally { conn.release(); }
  } catch (e) {
    console.error('Erreur sync entreprise:', e.message || e);
    process.exit(1);
  }
})();
