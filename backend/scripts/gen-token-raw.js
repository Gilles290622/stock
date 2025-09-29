#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const db = require('../config/db');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i+1]) return process.argv[i+1];
  return def;
}

(async () => {
  try {
    const id = parseInt(arg('id', '7'), 10);
    let email, username;
    try {
      const [rows] = await db.query('SELECT u.email, p.username FROM users u LEFT JOIN profiles p ON u.id=p.user_id WHERE u.id=? LIMIT 1', [id]);
      if (rows && rows[0]) { email = rows[0].email; username = rows[0].username; }
    } catch {}
    const token = jwt.sign({ id, email, username }, process.env.JWT_SECRET, { expiresIn: '2h' });
    process.stdout.write(token);
  } catch (e) {
    console.error('gen-token-raw error:', e?.message || e);
    process.exit(1);
  } finally {
    try { if (db && db.end) await db.end(); } catch {}
  }
})();
