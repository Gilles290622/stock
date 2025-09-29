#!/usr/bin/env node
/**
 * Suppression des désignations d'un utilisateur dont la catégorie est différente d'une valeur donnée.
 *
 * Par défaut, on conserve categorie=6 et on supprime tout le reste (y compris NULL).
 *
 * Usage:
 *   node backend/scripts/delete-designations-by-category.js --user 6 [--keep-category 6] [--include-null true] [--apply]
 */

const path = require('path');
const fs = require('fs');

// Charger les variables d'environnement depuis backend/.env si présent
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Par défaut on utilise la config existante (SQLite local ou MySQL suivant env)
const localPool = require('../config/db');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const args = { user: undefined, keepCategory: 6, includeNull: true, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--keep-category' && i + 1 < argv.length) { args.keepCategory = parseInt(argv[++i], 10); continue; }
    if (a === '--include-null' && i + 1 < argv.length) { args.includeNull = String(argv[++i]).toLowerCase() !== 'false'; continue; }
    if (a === '--apply') { args.apply = true; continue; }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      const k = m[1]; const v = m[2];
      if (k === 'user') args.user = parseInt(v, 10);
      if (k === 'keep-category') args.keepCategory = parseInt(v, 10);
      if (k === 'include-null') args.includeNull = String(v).toLowerCase() !== 'false';
      if (k === 'apply') args.apply = v === 'true' || v === '';
    }
  }
  if (!Number.isInteger(args.user) || args.user <= 0) throw new Error('Paramètre --user invalide');
  if (!Number.isInteger(args.keepCategory)) throw new Error('Paramètre --keep-category invalide');
  return args;
}

function whereClause(includeNull) {
  return includeNull ? '(categorie IS NULL OR categorie <> ?)' : '(categorie <> ?)';
}

async function runOnPool(label, pool, userId, keepCategory, includeNull, apply) {
  if (!pool) { console.log(`[${label}] Pool indisponible—étape ignorée.`); return; }
  const conn = await pool.getConnection();
  try {
    const [allRows] = await conn.query('SELECT id, name, categorie FROM stock_designations WHERE user_id = ?', [userId]);
    const cond = whereClause(includeNull);
    const [toDelRows] = await conn.query(`SELECT id, name, categorie FROM stock_designations WHERE user_id = ? AND ${cond}`, [userId, keepCategory]);
    console.log(`[${label}] Désignations totales pour user ${userId}: ${allRows.length}`);
    console.log(`[${label}] A supprimer (categorie != ${keepCategory}${includeNull ? ' ou NULL' : ''}): ${toDelRows.length}`);
    if (toDelRows.length) {
      const sample = toDelRows.slice(0, 20).map(r => `${r.id}:${r.name} [cat=${r.categorie ?? 'NULL'}]`);
      console.log(`[${label}] Exemples:`, sample);
    }
    if (!apply || toDelRows.length === 0) {
      console.log(`[${label}] Mode simulation. Ajoutez --apply pour supprimer.`);
      return;
    }
    await conn.beginTransaction();
    try {
      const [res] = await conn.query(`DELETE FROM stock_designations WHERE user_id = ? AND ${cond}`, [userId, keepCategory]);
      const affected = typeof res?.affectedRows === 'number' ? res.affectedRows : (Array.isArray(res) ? res.length : 0);
      await conn.commit();
      console.log(`[${label}] Suppression effectuée. Lignes affectées: ${affected}`);
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  } finally {
    conn.release();
  }
}

async function main() {
  const { user, keepCategory, includeNull, apply } = parseArgs(process.argv);
  console.log(`Suppression des désignations pour user=${user}, conservation categorie=${keepCategory}, includeNull=${includeNull}, apply=${apply}`);
  console.log('Hypothèse: "différente de 6" inclut aussi les catégories NULL (non renseignées).');

  // Local
  await runOnPool('local', localPool, user, keepCategory, includeNull, false);
  // Remote (aperçu)
  await runOnPool('remote', remotePool, user, keepCategory, includeNull, false);

  if (apply) {
    console.log('--- Application des suppressions ---');
    await runOnPool('local', localPool, user, keepCategory, includeNull, true);
    await runOnPool('remote', remotePool, user, keepCategory, includeNull, true);
  }
}

main().catch(err => { console.error('Erreur:', err?.stack || err); process.exit(1); });
