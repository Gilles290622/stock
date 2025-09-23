#!/usr/bin/env node
/**
 * Import des produits depuis backend/sql/produits.sql dans stock_designations
 * - Map: produit_designation -> stock_designations.name
 * - Le prix (produit_prix) n'est pas stocké car le schéma ne prévoit pas de colonne de prix
 * - Déduplication insensible à la casse par (user_id, name)
 *
 * Usage:
 *   node scripts/import-produits.js --user 6 [--file backend/sql/produits.sql] [--annex 1]
 */

const fs = require('fs');
const path = require('path');

// Forcer SQLite par défaut si non défini, pour éviter le besoin d'un .env spécifique
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');

const pool = require('../config/db');

function parseArgs(argv) {
  const args = { user: 6, file: path.join(__dirname, '..', 'sql', 'produits.sql'), annex: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--file' && i + 1 < argv.length) { args.file = argv[++i]; continue; }
    if (a === '--annex' && i + 1 < argv.length) { args.annex = String(argv[++i]); continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'file') args.file = v;
      if (k === 'annex') args.annex = String(v);
    }
  }
  if (!Number.isInteger(args.user) || args.user < 1) throw new Error('Paramètre --user invalide');
  return args;
}

function extractInsertBlock(sqlText) {
  // Récupérer la portion VALUES (...) ... ; de l'INSERT INTO `produits`
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
  // Itérer sur chaque tuple parenthésé: ( ... ), ( ... ), ...
  let i = 0;
  const n = valuesBody.length;
  while (i < n) {
    // chercher le prochain '('
    while (i < n && valuesBody[i] !== '(') i++;
    if (i >= n) break;
    i++; // skip '('
    let inQuotes = false;
    let buf = '';
    while (i < n) {
      const ch = valuesBody[i];
      if (inQuotes) {
        if (ch === '\\') { // escape char
          buf += ch;
          i++;
          if (i < n) buf += valuesBody[i];
        } else if (ch === "'") {
          // Peut être fin de quotes
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
          // fin du tuple
          yield buf;
          i++; // skip ')'
          // consommer éventuelle virgule et espaces
          while (i < n && /[\s,]/.test(valuesBody[i])) i++;
          break;
        }
        buf += ch;
        i++;
      }
    }
  }
}

function splitFields(tupleContent) {
  // Split par virgules top-level en respectant les quotes
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
  // NULL non quoted
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (/^null$/i.test(v)) return null;
  if (v.startsWith("'") && v.endsWith("'")) {
    let s = v.slice(1, -1);
    // dé-échappe les séquences \'
    s = s.replace(/\\'/g, "'");
    // MySQL style '' -> '
    s = s.replace(/''/g, "'");
    return s;
  }
  return v;
}

async function main() {
  const { user, file, annex } = parseArgs(process.argv);
  const absFile = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(absFile)) throw new Error('Fichier introuvable: ' + absFile);
  const sqlText = fs.readFileSync(absFile, 'utf8');

  const body = extractInsertBlock(sqlText);

  // Collecte unique des désignations + code categorie par produit
  const entries = []; // { name, categorieCode? }
  const seen = new Set();
  let totalTuples = 0;
  for (const tuple of iterateTuples(body)) {
    totalTuples++;
    const fields = splitFields(tuple);
    // colonnes: id, produit_ref, produit_designation, produit_prix, ...
    const designation = fields[2] != null ? String(fields[2]).trim() : '';
    const annexVal = fields[5] != null ? String(fields[5]).trim() : null; // 'annex' dans dump produits
    const categorieCode = fields[6] != null && String(fields[6]).trim() !== '' ? parseInt(String(fields[6]).trim(), 10) : null; // colonne 'categorie' dans dump produits
    if (!designation) continue;
    if (annex != null && annex !== undefined) {
      // Appliquer le filtre d'annexe s'il est fourni (comparaison texte stricte)
      if (annexVal !== String(annex)) continue;
    }
    const key = designation.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ name: designation, categorieCode: Number.isInteger(categorieCode) ? categorieCode : null });
    }
  }

  console.log(`Produits trouvés dans le dump: ${totalTuples}`);
  console.log(`Désignations uniques (insensibles à la casse): ${entries.length}`);

  const conn = await pool.getConnection();
  let inserted = 0;
  let skippedExisting = 0;
  let errors = 0;
  try {
    await conn.beginTransaction();
    for (const { name, categorieCode } of entries) {
      try {
        // Vérifier existence insensible à la casse
        const [existsRows] = await conn.execute(
          'SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)',
          [user, name]
        );
        if (existsRows.length > 0) {
          skippedExisting++;
          continue;
        }
        // Insérer avec categorie si code présent (on suppose que stock_categories importée a ids concordants 1..n)
        if (Number.isInteger(categorieCode)) {
          await conn.execute(
            'INSERT INTO stock_designations (user_id, name, current_stock, categorie) VALUES (?, ?, 0, ?)',
            [user, name, categorieCode]
          );
        } else {
          await conn.execute(
            'INSERT INTO stock_designations (user_id, name, current_stock) VALUES (?, ?, 0)',
            [user, name]
          );
        }
        inserted++;
      } catch (e) {
        const msg = String(e && (e.message || e.code) || e);
        // doublon concurrent? retenter la sélection
        if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('constraint')) {
          const [existsRows2] = await conn.execute(
            'SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)',
            [user, name]
          );
          if (existsRows2.length > 0) {
            skippedExisting++;
            continue;
          }
        }
        errors++;
        console.warn('Erreur insertion pour', name, ':', msg);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  console.log('Import terminé:');
  console.log('- Insérés:', inserted);
  console.log('- Déjà existants:', skippedExisting);
  console.log('- Erreurs:', errors);
  if (inserted === 0 && skippedExisting > 0) {
    console.log('Note: toutes les désignations semblent déjà présentes pour cet utilisateur.');
  }
}

main().catch((err) => {
  console.error('Echec import:', err && (err.stack || err.message) || err);
  process.exit(1);
});
