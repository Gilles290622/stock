#!/usr/bin/env node
/**
 * Provisionne un compte administrateur en local (SQLite) et distant (MySQL).
 * - Upsert users (id, full_name, entreprise?, email, password)
 * - Upsert profiles (user_id, username, role='admin', status='active')
 * - Hash bcrypt du mot de passe
 *
 * Usage:
 *   node scripts/provision-admin.js --id 1 --username Jtservices --email jtservices@local --full_name "Jtservices" --password "Christo29@" --entreprise "JTSERVICES"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const localDb = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs() {
  const out = { id: 1, username: 'Jtservices', email: 'jtservices@local', full_name: 'Jtservices', password: 'Christo29@', entreprise: 'JTSERVICES' };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--id') out.id = parseInt(a[++i], 10);
    else if (k === '--username') out.username = String(a[++i]);
    else if (k === '--email') out.email = String(a[++i]);
    else if (k === '--full_name') out.full_name = String(a[++i]);
    else if (k === '--password') out.password = String(a[++i]);
    else if (k === '--entreprise') out.entreprise = String(a[++i]);
  }
  return out;
}

async function upsertLocal({ id, username, email, full_name, password, entreprise }) {
  const conn = await localDb.getConnection();
  try {
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);
    const [u] = await conn.query('SELECT id FROM users WHERE id = ?', [id]);
    if (u.length === 0) {
      await conn.query('INSERT INTO users (id, full_name, entreprise, email, password) VALUES (?, ?, ?, ?, ?)', [id, full_name, entreprise || null, email, hash]);
    } else {
      await conn.query('UPDATE users SET full_name = ?, entreprise = ?, email = ?, password = ? WHERE id = ?', [full_name, entreprise || null, email, hash, id]);
    }
    const [p] = await conn.query('SELECT user_id FROM profiles WHERE user_id = ?', [id]);
    if (p.length === 0) {
      await conn.query('INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)', [id, 'admin', 'active', username]);
    } else {
      await conn.query('UPDATE profiles SET username = ?, role = ?, status = ? WHERE user_id = ?', [username, 'admin', 'active', id]);
    }
    await conn.commit();
    console.log(`[local] Admin provisionné: id=${id}, username=${username}`);
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

async function upsertRemote({ id, username, email, full_name, password, entreprise }) {
  if (!remotePool) { console.warn('[remote] Pool non configuré, skip'); return; }
  let rconn;
  try {
    rconn = await remotePool.getConnection();
    await rconn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);
    // Try with entreprise column first, fallback without if unknown column
    try {
      await rconn.execute(
        `INSERT INTO users (id, full_name, entreprise, email, password, phone_number, logo)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)
         ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), entreprise=VALUES(entreprise), email=VALUES(email), password=VALUES(password)`,
        [id, full_name, entreprise || null, email, hash]
      );
    } catch (colErr) {
      if (/Unknown column 'entreprise'|ER_BAD_FIELD_ERROR/i.test(colErr?.message || '')) {
        await rconn.execute(
          `INSERT INTO users (id, full_name, email, password, phone_number, logo)
           VALUES (?, ?, ?, ?, NULL, NULL)
           ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
          [id, full_name, email, hash]
        );
      } else {
        throw colErr;
      }
    }
    const [rp] = await rconn.execute('SELECT id FROM profiles WHERE user_id = ?', [id]);
    if (rp.length === 0) {
      await rconn.execute('INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)', [id, 'admin', 'active', username]);
    } else {
      await rconn.execute('UPDATE profiles SET username = ?, role = ?, status = ? WHERE user_id = ?', [username, 'admin', 'active', id]);
    }
    await rconn.commit();
    console.log(`[remote] Admin provisionné: id=${id}, username=${username}`);
  } catch (e) {
    if (rconn) try { await rconn.rollback(); } catch {}
    throw e;
  } finally {
    if (rconn) rconn.release();
  }
}

(async () => {
  const params = parseArgs();
  try {
    await upsertLocal(params);
  } catch (e) {
    console.error('[local] échec:', e?.message || e);
    process.exitCode = 1;
  }
  try {
    await upsertRemote(params);
  } catch (e) {
    console.error('[remote] échec:', e?.message || e);
    // ne pas forcer exit si remote indispo; on laisse l'admin local opérationnel
  }
  try { if (localDb && localDb.end) await localDb.end(); } catch {}
})();
