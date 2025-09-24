#!/usr/bin/env node
/**
 * Pull data from remote MySQL (source domain) and upsert into local DB (SQLite via pool).
 *
 * Usage examples:
 *   node scripts/pull-from-mysql.js clients --user 7 --annex 1 --host HOST --db DB --port 3306 --login USER --password PASS
 *   node scripts/pull-from-mysql.js produits --user 7 --annex 1 --host HOST --db DB --port 3306 --login USER --password PASS
 *
 * Or use env vars: MYSQL_HOST, MYSQL_DB, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD
 */
const path = require('path');
const mysql = require('mysql2/promise');

// Force local DB to SQLite
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');
const pool = require('../config/db');

function parseArgs(argv) {
  const args = {
    entity: null,
    user: null,
    annex: null,
    host: process.env.MYSQL_HOST || null,
    db: process.env.MYSQL_DB || null,
    port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306,
    login: process.env.MYSQL_USER || null,
    password: process.env.MYSQL_PASSWORD || null,
  };
  if (argv[2]) args.entity = String(argv[2]).toLowerCase();
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--annex' && i + 1 < argv.length) { args.annex = String(argv[++i]); continue; }
    if (a === '--host' && i + 1 < argv.length) { args.host = argv[++i]; continue; }
    if (a === '--db' && i + 1 < argv.length) { args.db = argv[++i]; continue; }
    if (a === '--port' && i + 1 < argv.length) { args.port = parseInt(argv[++i], 10); continue; }
    if (a === '--login' && i + 1 < argv.length) { args.login = argv[++i]; continue; }
    if (a === '--password' && i + 1 < argv.length) { args.password = argv[++i]; continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'annex') args.annex = String(v);
      if (k === 'host') args.host = v;
      if (k === 'db') args.db = v;
      if (k === 'port') args.port = parseInt(v, 10);
      if (k === 'login') args.login = v;
      if (k === 'password') args.password = v;
    }
  }
  if (!args.entity || !['clients', 'produits'].includes(args.entity)) throw new Error('First arg must be "clients" or "produits"');
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user requis et valide');
  if (!args.annex) throw new Error('Paramètre --annex requis');
  if (!args.host || !args.db || !args.login || !args.password || !args.port) throw new Error('MySQL connexion incomplète (host, db, port, login, password)');
  return args;
}

async function fetchClients(conn, annex) {
  const [rows] = await conn.execute(
    `SELECT client_num, client, client_nom, client_prenom, client_contact, client_home, annex, telephone, email
       FROM clientele WHERE annex = ?`, [annex]
  );
  return rows || [];
}

async function fetchProduits(conn, annex) {
  const [rows] = await conn.execute(
    `SELECT id, produit_ref, produit_designation, produit_prix, produit_Qte, annex, categorie, QteMin, description, achat
       FROM produits WHERE annex = ?`, [annex]
  );
  return rows || [];
}

function normStr(s, { zeroIsEmpty = true } = {}) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (zeroIsEmpty && t === '0') return null;
  return t;
}

async function upsertClientsLocal(userId, rows) {
  // Case-sensitive name key (column `client`), merge extra fields when missing
  const byName = new Map();
  for (const r of rows) {
    const name = normStr(r.client) || null;
    const contact = normStr(r.client_contact) || null;
    const address = normStr(r.client_home) || null;
    const phone = normStr(r.telephone) || null;
    const email = normStr(r.email) || null;
    if (!name) continue; // require displayable name
    const prev = byName.get(name) || { name, contact: null, address: null, phone: null, email: null };
    if (!prev.contact && contact) prev.contact = contact;
    if (!prev.address && address) prev.address = address;
    if (!prev.phone && phone) prev.phone = phone;
    if (!prev.email && email) prev.email = email;
    byName.set(name, prev);
  }

  const merged = Array.from(byName.values());
  const conn = await pool.getConnection();
  let inserted = 0, updated = 0, skipped = 0, errors = 0;
  try {
    await conn.beginTransaction();
    for (const { name, contact, address, phone, email } of merged) {
      try {
        const [exists] = await conn.execute('SELECT id, contact, address, phone, email FROM stock_clients WHERE user_id = ? AND name = ?', [userId, name]);
        if (exists.length > 0) {
          const row = exists[0];
          const toSet = {};
          const has = (v) => v != null && String(v).trim() !== '' && String(v).trim() !== '0';
          if (!has(row.contact) && has(contact)) toSet.contact = contact;
          if (!has(row.address) && has(address)) toSet.address = address;
          if (!has(row.phone) && has(phone)) toSet.phone = phone;
          if (!has(row.email) && has(email)) toSet.email = email;
          if (Object.keys(toSet).length > 0) {
            const fields = Object.keys(toSet).map((k) => `${k} = ?`).join(', ');
            const values = Object.values(toSet);
            await conn.execute(`UPDATE stock_clients SET ${fields} WHERE id = ?`, [...values, row.id]);
            updated++;
          } else {
            skipped++;
          }
        } else {
          await conn.execute(
            'INSERT INTO stock_clients (user_id, name, contact, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, name, contact || null, address || null, phone || null, email || null]
          );
          inserted++;
        }
      } catch (e) {
        const msg = String(e?.message || e?.code || e);
        if (/unique|constraint/i.test(msg)) {
          const [retry] = await conn.execute('SELECT id FROM stock_clients WHERE user_id = ? AND name = ?', [userId, name]);
          if (retry.length > 0) { skipped++; continue; }
        }
        errors++;
        console.warn('Upsert client error for', name, ':', msg);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { inserted, updated, skipped, errors, total: merged.length };
}

async function upsertProduitsLocal(userId, rows) {
  // Case-insensitive designation key, set categorie if provided
  const byKey = new Map();
  for (const r of rows) {
    const name = normStr(r.produit_designation) || null;
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name, categorieCode: Number.isFinite(+r.categorie) ? parseInt(r.categorie, 10) : null });
  }
  const merged = Array.from(byKey.values());
  const conn = await pool.getConnection();
  let inserted = 0, skipped = 0, errors = 0;
  try {
    await conn.beginTransaction();
    for (const { name, categorieCode } of merged) {
      try {
        const [exists] = await conn.execute('SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)', [userId, name]);
        if (exists.length > 0) { skipped++; continue; }
        if (Number.isInteger(categorieCode)) {
          await conn.execute('INSERT INTO stock_designations (user_id, name, current_stock, categorie) VALUES (?, ?, 0, ?)', [userId, name, categorieCode]);
        } else {
          await conn.execute('INSERT INTO stock_designations (user_id, name, current_stock) VALUES (?, ?, 0)', [userId, name]);
        }
        inserted++;
      } catch (e) {
        const msg = String(e?.message || e?.code || e);
        if (/unique|constraint/i.test(msg)) {
          const [retry] = await conn.execute('SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)', [userId, name]);
          if (retry.length > 0) { skipped++; continue; }
        }
        errors++;
        console.warn('Upsert produit error for', name, ':', msg);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { inserted, skipped, errors, total: merged.length };
}

async function main() {
  const { entity, user, annex, host, db, port, login, password } = parseArgs(process.argv);
  const src = await mysql.createPool({ host, user: login, password, database: db, port, waitForConnections: true, connectionLimit: 5 });
  try {
    if (entity === 'clients') {
      const rows = await fetchClients(src, annex);
      console.log(`Source clients rows (annex=${annex}):`, rows.length);
      const res = await upsertClientsLocal(user, rows);
      console.log('Upsert clients terminé:', res);
    } else if (entity === 'produits') {
      const rows = await fetchProduits(src, annex);
      console.log(`Source produits rows (annex=${annex}):`, rows.length);
      const res = await upsertProduitsLocal(user, rows);
      console.log('Upsert produits terminé:', res);
    }
  } finally {
    await src.end();
  }
}

main().catch((e) => { console.error('Echec pull-from-mysql:', e && (e.stack || e.message) || e); process.exit(1); });
