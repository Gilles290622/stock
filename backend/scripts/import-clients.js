#!/usr/bin/env node
/**
 * Import des clients depuis backend/sql/clientele.sql dans stock_clients
 * - Map: client -> name, client_contact -> contact
 * - Déduplication sensible à la casse: on considère deux noms différents si leur casse diffère
 *
 * Usage:
 *   node scripts/import-clients.js --user 6 [--file backend/sql/clientele.sql] [--annex 1]
 */

const fs = require('fs');
const path = require('path');

process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const pool = require('../config/db');

function parseArgs(argv) {
  const args = { user: 6, file: path.join(__dirname, '..', 'sql', 'clientele.sql'), annex: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) {
      args.user = parseInt(argv[++i], 10);
    } else if (a === '--file' && i + 1 < argv.length) {
      args.file = argv[++i];
    } else if (a === '--annex' && i + 1 < argv.length) {
      args.annex = String(argv[++i]);
    } else {
      const m = /^--([^=]+)=(.*)$/.exec(a);
      if (m) {
        const k = m[1];
        const v = m[2];
        if (k === 'user') args.user = parseInt(v, 10);
        if (k === 'file') args.file = v;
        if (k === 'annex') args.annex = String(v);
      }
    }
  }
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user invalide');
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
        if (ch === '\\') {
          buf += ch;
          i++;
          if (i < n) buf += valuesBody[i];
        } else if (ch === "'") {
          inQuotes = false;
          buf += ch;
        } else {
          buf += ch;
        }
        i++;
        continue;
      } else {
        if (ch === "'") {
          inQuotes = true;
          buf += ch;
          i++;
          continue;
        }
        if (ch === ')') {
          yield buf;
          i++;
          while (i < n && /[\s,]/.test(valuesBody[i])) i++;
          break;
        }
        buf += ch;
        i++;
      }
    }
  }
}

function splitTopLevel(tupleContent) {
  const out = [];
  let inQuotes = false;
  let token = '';
  for (let i = 0; i < tupleContent.length; i++) {
    const ch = tupleContent[i];
    if (inQuotes) {
      if (ch === '\\') {
        token += ch;
        i++;
        if (i < tupleContent.length) token += tupleContent[i];
        continue;
      }
      if (ch === "'") {
        inQuotes = false;
        token += ch;
      } else {
        token += ch;
      }
    } else {
      if (ch === "'") {
        inQuotes = true;
        token += ch;
      } else if (ch === ',') {
        out.push(token.trim());
        token = '';
      } else {
        token += ch;
      }
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
  const { user, file, annex } = parseArgs(process.argv);
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error('Fichier introuvable: ' + abs);
  const sqlText = fs.readFileSync(abs, 'utf8');
  const body = extractInsertBody(sqlText);

  const entries = [];
  const byKey = new Map(); // key -> { name, contact, address, phone, email }
  let total = 0;
  for (const t of iterateTuples(body)) {
    total++;
    const f = splitTopLevel(t);
    // colonnes clientele: client_num, client, client_nom, client_c, client_prenom, client_contact, ...
    const name = f[1] != null ? String(f[1]).trim() : '';
  let contact = f[5] != null ? String(f[5]).trim() : null;
  let address = f[7] != null ? String(f[7]).trim() : null; // client_home
    const annexVal = f[8] != null ? String(f[8]).trim() : null; // 'annex' dans dump clientele
  let phone = f[9] != null ? String(f[9]).trim() : null; // telephone
  let email = f[10] != null ? String(f[10]).trim() : null; // email
    if (!name) continue;
    if (annex != null && annex !== undefined) {
      if (annexVal !== String(annex)) continue; // filtrage par annexe
    }
    // normaliser contact: ignorer valeurs vides ou '0'
    const normStr = (s) => {
      if (s == null) return null;
      const t = String(s).replace(/\s+/g, ' ').trim();
      return t && t !== '0' ? t : null;
    };
    contact = normStr(contact);
    address = normStr(address);
    phone = normStr(phone);
    email = normStr(email);
  const key = name; // clé sensible à la casse
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { name, contact: contact || null, address: address || null, phone: phone || null, email: email || null });
    } else {
      // fusionner: préférer un contact non-null
      if (!prev.contact && contact) prev.contact = contact;
      if (!prev.address && address) prev.address = address;
      if (!prev.phone && phone) prev.phone = phone;
      if (!prev.email && email) prev.email = email;
    }
  }

  console.log(`Tuples lus: ${total}`);
  const merged = Array.from(byKey.values());
  console.log(`Clients uniques par nom: ${merged.length}`);

  const conn = await pool.getConnection();
  let inserted = 0, skipped = 0, updated = 0, errors = 0;
  try {
    await conn.beginTransaction();
    for (const { name, contact, address, phone, email } of merged) {
      try {
        const [exists] = await conn.execute('SELECT id, contact, address, phone, email FROM stock_clients WHERE user_id = ? AND name = ?', [user, name]);
        if (exists.length > 0) {
          // mettre à jour le contact si inexistant et nouveau contact disponible
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
          continue;
        }

        await conn.execute('INSERT INTO stock_clients (user_id, name, contact, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [user, name, contact || null, address || null, phone || null, email || null]);
        inserted++;
      } catch (e) {
        const msg = String(e && (e.message || e.code) || e);
        if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('constraint')) {
          const [exists2] = await conn.execute('SELECT id, contact, address, phone, email FROM stock_clients WHERE user_id = ? AND name = ?', [user, name]);
          if (exists2.length > 0) {
            const row2 = exists2[0];
            const toSet2 = {};
            const has2 = (v) => v != null && String(v).trim() !== '' && String(v).trim() !== '0';
            if (!has2(row2.contact) && has2(contact)) toSet2.contact = contact;
            if (!has2(row2.address) && has2(address)) toSet2.address = address;
            if (!has2(row2.phone) && has2(phone)) toSet2.phone = phone;
            if (!has2(row2.email) && has2(email)) toSet2.email = email;
            if (Object.keys(toSet2).length > 0) {
              const fields2 = Object.keys(toSet2).map((k) => `${k} = ?`).join(', ');
              const values2 = Object.values(toSet2);
              await conn.execute(`UPDATE stock_clients SET ${fields2} WHERE id = ?`, [...values2, row2.id]);
              updated++;
            } else {
              skipped++;
            }
            continue;
          }
        }
        errors++;
        console.warn('Erreur insertion client', name, ':', msg);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  console.log('Import clients terminé:');
  console.log('- Insérés:', inserted);
  console.log('- Déjà existants:', skipped);
  console.log('- Mis à jour (contact):', updated);
  console.log('- Erreurs:', errors);
}

main().catch(err => {
  console.error('Echec import clients:', err && (err.stack || err.message) || err);
  process.exit(1);
});
