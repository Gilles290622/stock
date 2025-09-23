#!/usr/bin/env node
// Met à jour la colonne categorie de stock_designations à partir du dump produits.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');
const db = require('../config/db');

function getBody(sql) {
  const idx = sql.indexOf('INSERT INTO `produits`');
  if (idx === -1) throw new Error('INSERT produits introuvable');
  const after = sql.slice(idx);
  const vIdx = after.indexOf('VALUES');
  const seg = after.slice(vIdx + 6);
  return seg.slice(0, seg.indexOf(';'));
}

function* iterTuples(s) {
  let i = 0; const n = s.length;
  while (i < n) {
    while (i < n && s[i] !== '(') i++;
    if (i >= n) break; i++;
    let q = false, buf='';
    while (i < n) {
      const ch = s[i];
      if (q) { if (ch === '\\') { buf += ch; i++; if (i < n) buf += s[i]; i++; continue; } if (ch === "'") { q=false; buf+="'"; i++; continue; } buf+=ch; i++; }
      else { if (ch === "'") { q=true; buf+="'"; i++; continue; } if (ch === ')') { yield buf; i++; while (i < n && /[\s,]/.test(s[i])) i++; break; } buf+=ch; i++; }
    }
  }
}

function splitFields(t) {
  const out=[]; let q=false, tok='';
  for (let i=0;i<t.length;i++){ const ch=t[i]; if(q){ if (ch==='\\'){ tok+=ch; i++; if(i<t.length) tok+=t[i]; continue;} if(ch==="'"){ q=false; tok+=ch; continue;} tok+=ch; }
  else { if(ch==="'"){ q=true; tok+=ch;} else if(ch===','){ out.push(tok.trim()); tok=''; } else { tok+=ch; } } }
  if(tok) out.push(tok.trim());
  return out.map(v=>{ const x=String(v); if(x.toLowerCase()==='null') return null; if(x.startsWith("'")&&x.endsWith("'")) return x.slice(1,-1).replace(/\\'/g,"'").replace(/''/g,"'"); return x; });
}

(async () => {
  const user = parseInt(process.argv[2] || '6', 10);
  const file = path.join(__dirname, '..', 'sql', 'produits.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const body = getBody(sql);
  const map = new Map(); // lower(name) -> categorieCode
  for (const tup of iterTuples(body)) {
    const f = splitFields(tup);
    const name = f[2] ? String(f[2]).trim() : '';
    const cat = f[6] && String(f[6]).trim() !== '' ? parseInt(String(f[6]).trim(), 10) : null;
    if (!name || !Number.isInteger(cat)) continue;
    const k = name.toLocaleLowerCase();
    if (!map.has(k)) map.set(k, cat);
  }

  let updated = 0, notFound = 0;
  const [rows] = await db.query('SELECT id, name FROM stock_designations WHERE user_id = ?', [user]);
  for (const r of rows) {
    const k = String(r.name).toLocaleLowerCase();
    const cat = map.get(k);
    if (!cat) { notFound++; continue; }
    await db.execute('UPDATE stock_designations SET categorie = ? WHERE id = ?', [cat, r.id]);
    updated++;
  }
  console.log('MAJ categories désignations:', { updated, notFound });
})();
