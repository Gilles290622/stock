#!/usr/bin/env node
// Importe les catégories depuis backend/sql/categories.sql dans stock_categories
require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');
const db = require('../config/db');

function extractValues(sql) {
  const idx = sql.indexOf('INSERT INTO `categories`');
  if (idx === -1) throw new Error('INSERT INTO `categories` introuvable');
  const after = sql.slice(idx);
  const vIdx = after.indexOf('VALUES');
  const segment = after.slice(vIdx + 6);
  const end = segment.indexOf(';');
  return segment.slice(0, end).trim();
}

function* iterTuples(body) {
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && body[i] !== '(') i++;
    if (i >= n) break;
    i++;
    let inQuotes = false, buf = '';
    while (i < n) {
      const ch = body[i];
      if (inQuotes) {
        if (ch === '\\') { buf += ch; i++; if (i < n) buf += body[i]; i++; continue; }
        if (ch === "'") { inQuotes = false; buf += ch; i++; continue; }
        buf += ch; i++; continue;
      } else {
        if (ch === "'") { inQuotes = true; buf += ch; i++; continue; }
        if (ch === ')') { yield buf; i++; while (i < n && /[\s,]/.test(body[i])) i++; break; }
        buf += ch; i++;
      }
    }
  }
}

function splitFields(s) {
  const out = [];
  let inQuotes = false, t = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '\\') { t += ch; i++; if (i < s.length) t += s[i]; continue; }
      if (ch === "'") { inQuotes = false; t += ch; continue; }
      t += ch;
    } else {
      if (ch === "'") { inQuotes = true; t += ch; }
      else if (ch === ',') { out.push(t.trim()); t=''; }
      else { t += ch; }
    }
  }
  if (t) out.push(t.trim());
  return out.map(v => {
    const x = String(v);
    if (x.toLowerCase() === 'null') return null;
    if (x.startsWith("'") && x.endsWith("'")) return x.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'");
    return x;
  });
}

(async () => {
  const file = path.join(__dirname, '..', 'sql', 'categories.sql');
  if (!fs.existsSync(file)) throw new Error('Fichier introuvable: ' + file);
  const sql = fs.readFileSync(file, 'utf8');
  const body = extractValues(sql);
  const names = [];
  const seen = new Set();
  for (const tup of iterTuples(body)) {
    const f = splitFields(tup);
    const name = f[1] ? String(f[1]).trim() : '';
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  let inserted = 0, skipped = 0;
  for (const name of names) {
    try {
      await db.execute('INSERT INTO stock_categories (name) VALUES (?)', [name]);
      inserted++;
    } catch (e) {
      const msg = String(e && (e.message || e.code) || e);
      if (msg.toLowerCase().includes('unique')) { skipped++; continue; }
      throw e;
    }
  }
  console.log('Import catégories terminé:', { inserted, skipped });
})();
