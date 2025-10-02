#!/usr/bin/env node
// Ajoute ou met à jour des free_days pour un user donné (débloque l'accès non-admin)
// Usage: node scripts/grant-free-days.js --id 8 --days 30
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

function parseArgs() {
  const out = { id: null, days: 7 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--id') out.id = parseInt(a[++i], 10);
    else if (k === '--days') out.days = parseInt(a[++i], 10);
  }
  if (!out.id || isNaN(out.days)) {
    console.error('Usage: node scripts/grant-free-days.js --id <user_id> --days <n>');
    process.exit(1);
  }
  return out;
}

(async () => {
  const { id, days } = parseArgs();
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [p] = await conn.execute('SELECT user_id, free_days FROM profiles WHERE user_id = ? LIMIT 1', [id]);
    if (p.length === 0) {
      await conn.execute('INSERT INTO profiles (user_id, role, status, username, free_days) VALUES (?, ?, ?, ?, ?)', [id, 'user', 'active', `user${id}`, days]);
    } else {
      await conn.execute('UPDATE profiles SET free_days = COALESCE(free_days, 0) + ? WHERE user_id = ?', [days, id]);
    }
    await conn.commit();
    console.log(`free_days += ${days} pour user_id=${id}`);
  } catch (e) {
    if (conn) try { await conn.rollback(); } catch {}
    console.error('grant-free-days error:', e?.message || e);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    try { if (db && db.end) await db.end(); } catch {}
  }
})();
