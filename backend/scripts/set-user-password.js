#!/usr/bin/env node
// Upsert a local user/profile and set a bcrypt password
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const db = require('../config/db');

function parseArgs() {
  const out = { id: 6, email: 'user6@local', username: 'user6', full_name: 'User 6', password: 'password123' };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--id') out.id = parseInt(a[++i], 10);
    else if (k === '--email') out.email = String(a[++i]);
    else if (k === '--username') out.username = String(a[++i]);
    else if (k === '--full_name') out.full_name = String(a[++i]);
    else if (k === '--password') out.password = String(a[++i]);
  }
  return out;
}

(async () => {
  const { id, email, username, full_name, password } = parseArgs();
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);

    // Upsert user
    const [u] = await conn.query('SELECT id FROM users WHERE id = ?', [id]);
    if (u.length === 0) {
      await conn.query('INSERT INTO users (id, full_name, entreprise, email, password) VALUES (?, ?, ?, ?, ?)', [id, full_name, null, email, hash]);
    } else {
      await conn.query('UPDATE users SET full_name = ?, email = ?, password = ? WHERE id = ?', [full_name, email, hash, id]);
    }

    // Upsert profile
    const [p] = await conn.query('SELECT user_id FROM profiles WHERE user_id = ?', [id]);
    if (p.length === 0) {
      await conn.query('INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)', [id, 'user', 'active', username]);
    } else {
      await conn.query('UPDATE profiles SET username = COALESCE(?, username), role = COALESCE(role, ?), status = COALESCE(status, ?) WHERE user_id = ?', [username, 'user', 'active', id]);
    }

    await conn.commit();
    console.log(`User ${id} updated. Email=${email}, Username=${username}`);
  } catch (e) {
    if (conn) try { await conn.rollback(); } catch {}
    console.error('set-user-password error:', e?.message || e);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    try { if (db && db.end) await db.end(); } catch {}
  }
})();
