#!/usr/bin/env node
/**
 * Keep only a specific set of users remotely (MySQL), sourced from local SQLite.
 * 1) Upsert kept users + profiles from local → remote
 * 2) Delete any other remote users (and their profiles via FK cascade)
 *
 * Usage:
 *   node scripts/sync-users-keep.js --keep=1,6,7 [--apply]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const localPool = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const args = { keep: [], apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--keep=')) {
      const ids = a.split('=')[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
      args.keep = ids;
      continue;
    }
    if (a === '--apply') { args.apply = true; continue; }
  }
  // Allow KEEP_IDS env as alternative to CLI
  if (!args.keep.length && process.env.KEEP_IDS) {
    args.keep = String(process.env.KEEP_IDS)
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0);
  }
  // Default keep list if nothing provided: include 9 as requested
  if (!args.keep.length) {
    args.keep = [1, 6, 7, 9];
    console.log('[info] Aucun --keep ni KEEP_IDS fourni. Utilisation de la liste par défaut: 1,6,7,9');
  }
  if (!remotePool) throw new Error('Remote DB non configurée (REMOTE_DB_*)');
  return args;
}

async function ensureRemoteProfilesSchema(conn) {
  try {
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS profiles (
         id INT AUTO_INCREMENT PRIMARY KEY,
         user_id INT NOT NULL UNIQUE,
         username VARCHAR(190) UNIQUE,
         role VARCHAR(50) DEFAULT 'user',
         status VARCHAR(50) DEFAULT 'active',
         entreprise VARCHAR(255) NULL,
         created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
  } catch (e) {
    console.warn('[remote] ensure profiles skipped:', e?.message || e);
  }
}

async function fetchLocalUsers(ids) {
  const conn = await localPool.getConnection();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT u.id, u.full_name, u.email, u.password, p.username, p.role, p.status, NULL as entreprise
                   FROM users u
              LEFT JOIN profiles p ON p.user_id = u.id
                  WHERE u.id IN (${placeholders})
               ORDER BY u.id ASC`;
    const [rows] = await conn.query(sql, ids);
    return rows;
  } finally { conn.release(); }
}

async function upsertRemoteUsers(rows) {
  const conn = await remotePool.getConnection();
  try {
    await ensureRemoteProfilesSchema(conn);
    await conn.beginTransaction();
    for (const u of rows) {
      await conn.execute(
        `INSERT INTO users (id, full_name, email, password)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
        [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
      );
      // Upsert profil, compatible avec schémas sans colonne 'entreprise'
      try {
        await conn.execute(
          `INSERT INTO profiles (user_id, username, role, status, entreprise)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE username=VALUES(username), role=VALUES(role), status=VALUES(status), entreprise=VALUES(entreprise)`,
          [u.id, u.username || null, u.role || 'user', u.status || 'active', u.entreprise || null]
        );
      } catch (e) {
        const msg = e && (e.message || String(e));
        if (/unknown column|doesn't exist/i.test(msg)) {
          // Re-tenter sans la colonne entreprise
          await conn.execute(
            `INSERT INTO profiles (user_id, username, role, status)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE username=VALUES(username), role=VALUES(role), status=VALUES(status)`,
            [u.id, u.username || null, u.role || 'user', u.status || 'active']
          );
        } else {
          throw e;
        }
      }
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally { conn.release(); }
}

async function deleteRemoteOthers(keepIds, apply) {
  const conn = await remotePool.getConnection();
  try {
    const [rows] = await conn.query('SELECT id FROM users ORDER BY id ASC');
    const allIds = rows.map(r => Number(r.id));
    const toDelete = allIds.filter(id => !keepIds.includes(id));
    if (!toDelete.length) {
      console.log('Aucun utilisateur à supprimer côté distant.');
      return { toDelete: [] };
    }
    console.log('Utilisateurs à supprimer (remote):', toDelete.join(','));
    if (!apply) { console.log('Dry-run: aucune suppression effectuée. Ajoutez --apply pour appliquer.'); return { toDelete }; }
    await conn.beginTransaction();
    // Supprimer profils d'abord (FK CASCADE couvrira, mais par prudence)
    const placeholders = toDelete.map(() => '?').join(',');
    await conn.query(`DELETE FROM profiles WHERE user_id IN (${placeholders})`, toDelete).catch(()=>{});
    await conn.query(`DELETE FROM users WHERE id IN (${placeholders})`, toDelete);
    await conn.commit();
    console.log('Suppressions appliquées.');
    return { toDelete };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally { conn.release(); }
}

(async () => {
  try {
    const { keep, apply } = parseArgs(process.argv);
    console.log('Keep IDs:', keep.join(','), '| mode =', apply ? 'APPLY' : 'DRY-RUN');
    const rows = await fetchLocalUsers(keep);
    if (rows.length !== keep.length) {
      const found = new Set(rows.map(r => Number(r.id)));
      const missing = keep.filter(id => !found.has(id));
      if (missing.length) console.warn('Attention: utilisateurs absents en local et donc non upsertés:', missing.join(','));
    }
    await upsertRemoteUsers(rows);
    const res = await deleteRemoteOthers(keep, apply);
    console.log('Terminé.');
  } catch (e) {
    console.error('Erreur:', e?.message || e);
    process.exit(1);
  }
})();
