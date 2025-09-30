#!/usr/bin/env node
/**
 * Compare local SQLite vs remote MySQL for key tables, scoped by user when applicable.
 * Reports counts, missing IDs, and mismatched fields on intersecting columns.
 *
 * Usage:
 *   node backend/scripts/compare-local-remote.js --user 6 [--table clients|designations|mouvements|paiements|depenses|categories]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const localPool = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const args = { user: 6, table: null, limit: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--table' && i + 1 < argv.length) { args.table = String(argv[++i]).toLowerCase(); continue; }
    if (a === '--limit' && i + 1 < argv.length) { args.limit = parseInt(argv[++i], 10); continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'table') args.table = String(v).toLowerCase();
      if (k === 'limit') args.limit = parseInt(v, 10);
    }
  }
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user invalide');
  if (args.table && !['clients','designations','mouvements','paiements','depenses','categories'].includes(args.table)) throw new Error('Paramètre --table invalide');
  if (!remotePool) throw new Error('Remote DB non configurée (REMOTE_DB_*)');
  return args;
}

async function getLocalColumns(table) {
  const sql = `PRAGMA table_info(${table})`;
  const conn = await localPool.getConnection();
  try {
    const [rows] = await conn.query(sql);
    return rows.map(r => r.name);
  } finally { conn.release(); }
}

async function getRemoteColumns(table) {
  const conn = await remotePool.getConnection();
  try {
    const [rows] = await conn.query(`SHOW COLUMNS FROM ${table}`);
    return rows.map(r => r.Field);
  } finally { conn.release(); }
}

function intersect(a, b) {
  const set = new Set(b);
  return a.filter(x => set.has(x));
}

function normalizeValue(col, v) {
  if (v == null) return null;
  if (/^date$/i.test(col)) {
    // Normalize to YYYY-MM-DD
    if (v instanceof Date) return v.toISOString().slice(0,10);
    const s = String(v).slice(0,10);
    // Accept formats like YYYY-MM-DD or YYYY/MM/DD
    return s.replace(/\//g, '-');
  }
  if (['quantite','prix','montant','current_stock','stock','stockR'].includes(col)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return String(v);
}

async function fetchRows(pool, table, columns, scopedUserId) {
  const conn = await pool.getConnection();
  try {
    const colsSql = columns.join(', ');
    let sql, params;
    if (scopedUserId != null) { sql = `SELECT ${colsSql} FROM ${table} WHERE user_id = ? ORDER BY id ASC`; params = [scopedUserId]; }
    else { sql = `SELECT ${colsSql} FROM ${table} ORDER BY id ASC`; params = []; }
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally { conn.release(); }
}

function compareRows(commonCols, localRows, remoteRows, { limit = 10 } = {}) {
  const byIdLocal = new Map(localRows.map(r => [Number(r.id), r]));
  const byIdRemote = new Map(remoteRows.map(r => [Number(r.id), r]));
  const idsLocal = new Set(byIdLocal.keys());
  const idsRemote = new Set(byIdRemote.keys());
  const missingInRemote = Array.from(idsLocal).filter(id => !idsRemote.has(id));
  const missingInLocal = Array.from(idsRemote).filter(id => !idsLocal.has(id));
  const intersectIds = Array.from(idsLocal).filter(id => idsRemote.has(id));
  const mismatches = [];
  for (const id of intersectIds) {
    const l = byIdLocal.get(id);
    const r = byIdRemote.get(id);
    const diffs = [];
    for (const c of commonCols) {
      const lv = normalizeValue(c, l[c]);
      const rv = normalizeValue(c, r[c]);
      if (lv !== rv) diffs.push({ col: c, local: lv, remote: rv });
    }
    if (diffs.length) mismatches.push({ id, diffs });
    if (mismatches.length >= limit) break;
  }
  return { missingInRemote, missingInLocal, mismatches };
}

async function compareOne(table, opts) {
  const { user, limit } = opts;
  const perUser = table !== 'stock_categories';
  const localCols = await getLocalColumns(table);
  const remoteCols = await getRemoteColumns(table);
  // Always include id (+user_id if present)
  let desired = [];
  switch (table) {
    case 'stock_clients': desired = ['id','user_id','name','address','phone','email']; break; // exclude 'contact' (may not exist remote)
    case 'stock_designations': desired = ['id','user_id','name','current_stock','categorie']; break;
    case 'stock_mouvements': desired = ['id','user_id','date','type','designation_id','quantite','prix','client_id','stock','stockR']; break;
    case 'stock_paiements': desired = ['id','mouvement_id','user_id','montant','date']; break;
    case 'stock_depenses': desired = ['id','user_id','date','libelle','montant','destinataire']; break;
    case 'stock_categories': desired = ['id','name']; break;
    default: desired = ['id'];
  }
  const common = intersect(intersect(desired, localCols), remoteCols);
  if (!common.includes('id')) common.unshift('id');

  const [localRows, remoteRows] = await Promise.all([
    fetchRows(localPool, table, common, perUser ? user : null),
    fetchRows(remotePool, table, common, perUser ? user : null)
  ]);
  const res = compareRows(common, localRows, remoteRows, { limit });
  return {
    table,
    user: perUser ? user : null,
    columns: common,
    counts: { local: localRows.length, remote: remoteRows.length },
    missingInRemoteCount: res.missingInRemote.length,
    missingInLocalCount: res.missingInLocal.length,
    sampleMissingInRemote: res.missingInRemote.slice(0, limit),
    sampleMissingInLocal: res.missingInLocal.slice(0, limit),
    sampleMismatches: res.mismatches,
  };
}

async function main() {
  const { user, table } = parseArgs(process.argv);
  const tables = table ? [table] : ['clients','designations','mouvements','paiements','depenses','categories'];
  const nameToTable = {
    clients: 'stock_clients',
    designations: 'stock_designations',
    mouvements: 'stock_mouvements',
    paiements: 'stock_paiements',
    depenses: 'stock_depenses',
    categories: 'stock_categories',
  };
  for (const t of tables) {
    const tableName = nameToTable[t] || t;
    try {
      const r = await compareOne(tableName, { user, limit: 10 });
      console.log(`\n[${tableName}]`);
      if (r.user) console.log(` user=${r.user}`);
      console.log(' columns:', r.columns.join(', '));
      console.log(' counts: local=%d remote=%d', r.counts.local, r.counts.remote);
      console.log(' missingInRemote:', r.missingInRemoteCount, r.sampleMissingInRemote.length ? ('samples=' + r.sampleMissingInRemote.join(',')) : '');
      console.log(' missingInLocal :', r.missingInLocalCount, r.sampleMissingInLocal.length ? ('samples=' + r.sampleMissingInLocal.join(',')) : '');
      if (r.sampleMismatches.length) {
        console.log(' mismatches (sample):');
        for (const m of r.sampleMismatches) {
          console.log('  - id=%s', m.id);
          for (const d of m.diffs) console.log('     * %s: local=%j remote=%j', d.col, d.local, d.remote);
        }
      } else {
        console.log(' mismatches: 0');
      }
    } catch (e) {
      console.log(`\n[${tableName}] ERROR:`, e?.message || String(e));
    }
  }
}

main().catch(err => { console.error('Erreur:', err?.stack || err); process.exit(1); });
