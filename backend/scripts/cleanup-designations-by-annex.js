#!/usr/bin/env node
/**
 * Réconciliation des désignations d'un utilisateur avec un dump produits.sql filtré par annexe.
 * Supprime (optionnel) les désignations de user_id qui ne figurent pas dans le dump pour l'annexe ciblée.
 *
 * Usage:
 *   node scripts/cleanup-designations-by-annex.js --user 7 --annex 1 [--file backend/sql/produits.sql] [--apply]
 */

const fs = require('fs');
const path = require('path');

process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const pool = require('../config/db');

function parseArgs(argv) {
  const args = { user: undefined, annex: undefined, file: path.join(__dirname, '..', 'sql', 'produits.sql'), apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--annex' && i + 1 < argv.length) { args.annex = String(argv[++i]); continue; }
    if (a === '--file' && i + 1 < argv.length) { args.file = argv[++i]; continue; }
    if (a === '--apply') { args.apply = true; continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'annex') args.annex = String(v);
      if (k === 'file') args.file = v;
      if (k === 'apply') args.apply = v === 'true' || v === '';
    }
  }
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user invalide');
  if (args.annex == null) throw new Error('Paramètre --annex requis');
  return args;
}

function extractInsertBlock(sqlText) {
  const insertIdx = sqlText.indexOf('INSERT INTO `produits`');
  if (insertIdx === -1) throw new Error("Bloc INSERT INTO `produits` introuvable");
  const after = sqlText.slice(insertIdx);
  const valuesIdx = after.indexOf('VALUES');
  if (valuesIdx === -1) throw new Error('Mot-clé VALUES introuvable');
  const body = after.slice(valuesIdx + 'VALUES'.length);
  const endIdx = body.indexOf(';');
  if (endIdx === -1) throw new Error('Point-virgule de fin du bloc VALUES introuvable');
  return body.slice(0, endIdx).trim();
}

function* iterateTuples(valuesBody) {
  let i = 0; const n = valuesBody.length;
  while (i < n) {
    while (i < n && valuesBody[i] !== '(') i++;
    if (i >= n) break; i++;
    let inQuotes = false; let buf = '';
    while (i < n) {
      const ch = valuesBody[i];
      if (inQuotes) {
        if (ch === '\\') { buf += ch; i++; if (i < n) buf += valuesBody[i]; i++; continue; }
        if (ch === "'") { inQuotes = false; buf += ch; i++; continue; }
        buf += ch; i++; continue;
      } else {
        if (ch === "'") { inQuotes = true; buf += ch; i++; continue; }
        if (ch === ')') { yield buf; i++; while (i < n && /[\s,]/.test(valuesBody[i])) i++; break; }
        buf += ch; i++;
      }
    }
  }
}

function splitFields(tupleContent) {
  const out = []; let inQuotes = false; let token = '';
  for (let i = 0; i < tupleContent.length; i++) {
    const ch = tupleContent[i];
    if (inQuotes) {
      if (ch === '\\') { token += ch; i++; if (i < tupleContent.length) token += tupleContent[i]; continue; }
      if (ch === "'") { inQuotes = false; token += ch; }
      else { token += ch; }
    } else {
      if (ch === "'") { inQuotes = true; token += ch; }
      else if (ch === ',') { out.push(token.trim()); token = ''; }
      else { token += ch; }
    }
  }
  if (token.length > 0) out.push(token.trim());
  return out.map(unquoteSqlString);
}

function unquoteSqlString(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (/^null$/i.test(v)) return null;
  if (v.startsWith("'") && v.endsWith("'")) {
    let s = v.slice(1, -1);
    s = s.replace(/\\'/g, "'");
    s = s.replace(/''/g, "'");
    return s;
  }
  return v;
}

async function main() {
  const { user, annex, file, apply } = parseArgs(process.argv);
  const absFile = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(absFile)) throw new Error('Fichier introuvable: ' + absFile);
  const sqlText = fs.readFileSync(absFile, 'utf8');
  const body = extractInsertBlock(sqlText);

  const allowed = new Set();
  let tuples = 0; let allowedCount = 0;
  for (const tuple of iterateTuples(body)) {
    tuples++;
    const f = splitFields(tuple);
    const designation = f[2] != null ? String(f[2]).trim() : '';
    const annexVal = f[5] != null ? String(f[5]).trim() : null;
    if (!designation) continue;
    if (annexVal === String(annex)) {
      const key = designation.toLocaleLowerCase();
      if (!allowed.has(key)) { allowed.add(key); allowedCount++; }
    }
  }

  console.log(`Tuples dans dump: ${tuples}`);
  console.log(`Désignations autorisées pour annexe=${annex}: ${allowedCount}`);

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, name FROM stock_designations WHERE user_id = ?', [user]);
    const toDelete = rows.filter(r => !allowed.has(String(r.name).toLocaleLowerCase()));
    console.log(`Désignations existantes pour user ${user}: ${rows.length}`);
    console.log(`A supprimer (non présentes pour annexe=${annex}): ${toDelete.length}`);
    const preview = toDelete.slice(0, 20).map(r => r.name);
    if (toDelete.length > 0) console.log('Exemples à supprimer:', preview);

    if (apply && toDelete.length > 0) {
      await conn.beginTransaction();
      try {
        // Supprimer en batch, éviter de dépasser la limite SQLite des variables en chunkant
        const chunkSize = 200;
        for (let i = 0; i < toDelete.length; i += chunkSize) {
          const chunk = toDelete.slice(i, i + chunkSize);
          const params = [];
          const ids = chunk.map(r => { params.push(r.id); return '?'; }).join(',');
          await conn.execute(`DELETE FROM stock_designations WHERE id IN (${ids})`, params);
        }
        await conn.commit();
        console.log('Suppressions appliquées.');
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    } else {
      console.log('Mode simulation (dry-run). Ajoutez --apply pour confirmer la suppression.');
    }
  } finally {
    conn.release();
  }
}

main().catch(err => { console.error('Echec cleanup désignations:', err && (err.stack || err.message) || err); process.exit(1); });
