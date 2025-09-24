#!/usr/bin/env node
/**
 * Compte les clients annex=1 dans le dump clientele.sql
 * en considérant comme entité (client_num + client_nom + client_prenom + client_contact),
 * chaque champ pouvant être nul, dédoublonnage insensible à la casse.
 *
 * Usage:
 *   node scripts/count-clients-from-source.js [--file backend/sql/clientele.sql] [--annex 1]
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { file: path.join(__dirname, '..', 'sql', 'clientele.sql'), annex: '1' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && i + 1 < argv.length) { args.file = argv[++i]; continue; }
    if (a === '--annex' && i + 1 < argv.length) { args.annex = String(argv[++i]); continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'file') args.file = v;
      if (k === 'annex') args.annex = String(v);
    }
  }
  return args;
}

function extractInsertBody(sqlText) {
  const idx = sqlText.indexOf('INSERT INTO `clientele`');
  if (idx === -1) throw new Error("Bloc INSERT INTO `clientele` introuvable");
  const after = sqlText.slice(idx);
  const valuesIdx = after.indexOf('VALUES');
  if (valuesIdx === -1) throw new Error('Mot-clé VALUES introuvable');
  const body = after.slice(valuesIdx + 'VALUES'.length);
  const endIdx = body.indexOf(';');
  if (endIdx === -1) throw new Error('Fin de bloc VALUES non trouvée');
  return body.slice(0, endIdx).trim();
}

function* iterateTuples(valuesBody) {
  let i = 0;
  const n = valuesBody.length;
  while (i < n) {
    while (i < n && valuesBody[i] !== '(') i++;
    if (i >= n) break;
    i++;
    let inQuotes = false;
    let buf = '';
    while (i < n) {
      const ch = valuesBody[i];
      if (inQuotes) {
        if (ch === '\\') { buf += ch; i++; if (i < n) buf += valuesBody[i]; }
        else if (ch === "'") { inQuotes = false; buf += ch; }
        else { buf += ch; }
        i++;
        continue;
      } else {
        if (ch === "'") { inQuotes = true; buf += ch; i++; continue; }
        if (ch === ')') { yield buf; i++; while (i < n && /[\s,]/.test(valuesBody[i])) i++; break; }
        buf += ch; i++;
      }
    }
  }
}

function splitTopLevel(tupleContent) {
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

function normField(v, { treatZeroAsEmpty = true } = {}) {
  if (v == null) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (treatZeroAsEmpty && s === '0') return '';
  return s.toLocaleLowerCase('fr-FR');
}

async function main() {
  const { file, annex } = parseArgs(process.argv);
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error('Fichier introuvable: ' + abs);
  const sqlText = fs.readFileSync(abs, 'utf8');
  const body = extractInsertBody(sqlText);

  let tuples = 0; const set = new Set();
  for (const t of iterateTuples(body)) {
    tuples++;
    const f = splitTopLevel(t);
    const annexVal = f[8] != null ? String(f[8]).trim() : null;
    if (annex != null && annex !== undefined && String(annexVal) !== String(annex)) continue;
  const num = normField(f[0], { treatZeroAsEmpty: false }); // client_num
  const nom = normField(f[2]);
  const prenom = normField(f[4]);
  const contact = normField(f[5]); // client_contact
  if (!num && !nom && !prenom && !contact) continue;
  const key = `${num}|${nom}|${prenom}|${contact}`;
  set.add(key);
  }
  console.log(`Tuples lus: ${tuples}`);
  console.log(`Annexe filtrée: ${annex}`);
  console.log(`Clients uniques (num+nom+prenom+contact, insensible à la casse): ${set.size}`);
}

main().catch((e) => { console.error(e && (e.stack || e.message) || e); process.exit(1); });
