#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const db = require('../config/db');

function args() {
  const out = { id: 6, base: 'http://localhost' };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--id') out.id = parseInt(a[++i], 10);
    else if (a[i] === '--base') out.base = String(a[++i]);
  }
  return out;
}

async function getMeta(id) {
  try {
    const [rows] = await db.query('SELECT u.email, p.username FROM users u LEFT JOIN profiles p ON u.id=p.user_id WHERE u.id=? LIMIT 1', [id]);
    if (rows && rows[0]) return { email: rows[0].email, username: rows[0].username };
  } catch {}
  return {};
}

async function j(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

async function main() {
  const { id, base } = args();
  const meta = await getMeta(id);
  const token = jwt.sign({ id, email: meta.email, username: meta.username }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const headers = { Authorization: `Bearer ${token}` };

  const endpoints = [
    `${base}/api/clients/count`,
    `${base}/api/designations/count`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers });
      const body = await j(res);
      console.log('GET', url, 'status=', res.status, '->', body);
    } catch (e) {
      console.error('Request failed:', url, e?.message || e);
    }
  }
}

main()
  .catch((e) => { console.error('hit-counts error:', e?.message || e); process.exit(1); })
  .finally(async () => { try { if (db && db.end) await db.end(); } catch {} });
