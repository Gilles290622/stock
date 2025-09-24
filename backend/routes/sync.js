const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const mysql = require('mysql2/promise');

function normStr(s, { zeroIsEmpty = true } = {}) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (zeroIsEmpty && t === '0') return null;
  return t;
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

async function upsertClientsLocal(userId, rows) {
  const byName = new Map();
  for (const r of rows) {
    const name = normStr(r.client) || null;
    const contact = normStr(r.client_contact) || null;
    const address = normStr(r.client_home) || null;
    const phone = normStr(r.telephone) || null;
    const email = normStr(r.email) || null;
    if (!name) continue;
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
          // Note: cela suppose que le code categorie source correspond à un id local. Sinon, laisser NULL et mapper ensuite.
          try {
            await conn.execute('INSERT INTO stock_designations (user_id, name, current_stock, categorie) VALUES (?, ?, 0, ?)', [userId, name, categorieCode]);
          } catch (_) {
            await conn.execute('INSERT INTO stock_designations (user_id, name, current_stock) VALUES (?, ?, 0)', [userId, name]);
          }
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

async function getMysqlPoolFrom(reqBody) {
  const host = process.env.MYSQL_HOST || reqBody.host || 'structure-elmorijah.com';
  const database = process.env.MYSQL_DB || reqBody.db || 'u313667830_moulins';
  const port = parseInt(process.env.MYSQL_PORT || reqBody.port || '3306', 10);
  const user = process.env.MYSQL_USER || reqBody.login || 'u313667830_moulin';
  const password = process.env.MYSQL_PASSWORD || reqBody.password || 'Gilles47@';
  return mysql.createPool({ host, user, password, database, port, waitForConnections: true, connectionLimit: 5 });
}

// POST /api/sync/:entity  { annex?: 1, user?: 7 }
router.post('/:entity', authenticateToken, async (req, res) => {
  try {
    if (req.user?.id !== 7) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const entity = String(req.params.entity || '').toLowerCase();
    if (!['clients', 'produits'].includes(entity)) {
      return res.status(400).json({ error: 'Entité invalide' });
    }
    const annex = req.body?.annex ?? 1;
    const targetUser = req.body?.user ?? 7;
    const src = await getMysqlPoolFrom(req.body || {});
    try {
      if (entity === 'clients') {
        const rows = await fetchClients(src, annex);
        const result = await upsertClientsLocal(targetUser, rows);
        return res.json({ entity, annex, user: targetUser, source: rows.length, result });
      } else {
        const rows = await fetchProduits(src, annex);
        const result = await upsertProduitsLocal(targetUser, rows);
        return res.json({ entity, annex, user: targetUser, source: rows.length, result });
      }
    } finally {
      await src.end();
    }
  } catch (err) {
    console.error('Erreur sync:', err?.message || err);
    res.status(500).json({ error: 'Erreur synchronisation', details: err?.message || String(err) });
  }
});

module.exports = router;
