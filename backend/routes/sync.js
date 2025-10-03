const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const mysql = require('mysql2/promise');
const remotePool = require('../config/remoteDb');
const { getReplicationErrors, logReplicationError } = require('../utils/replicationLog');

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

// POST /api/sync/pull/all  -> Importer clients + produits en une seule action (réservé user 7)
router.post('/pull/all', authenticateToken, async (req, res) => {
  try {
    if (req.user?.id !== 7) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const annex = req.body?.annex ?? 1;
    const targetUser = req.body?.user ?? 7;
    const src = await getMysqlPoolFrom(req.body || {});
    try {
      const clientsRows = await fetchClients(src, annex);
      const clientsResult = await upsertClientsLocal(targetUser, clientsRows);
      const produitsRows = await fetchProduits(src, annex);
      const produitsResult = await upsertProduitsLocal(targetUser, produitsRows);
      return res.json({
        success: true,
        annex,
        user: targetUser,
        clients: { source: clientsRows.length, result: clientsResult },
        produits: { source: produitsRows.length, result: produitsResult }
      });
    } finally {
      await src.end();
    }
  } catch (err) {
    console.error('Erreur pull/all:', err?.message || err);
    res.status(500).json({ error: 'Erreur synchronisation source', details: err?.message || String(err) });
  }
});

// GET /api/sync/remote-status -> check if remote pool is configured and reachable
router.get('/remote-status', authenticateToken, async (req, res) => {
  if (!remotePool) return res.json({ enabled: false });
  let conn;
  try {
    conn = await remotePool.getConnection();
    const [rows] = await conn.query('SELECT 1 as ok');
    res.json({ enabled: true, ok: rows && rows[0] && rows[0].ok === 1 });
  } catch (e) {
    res.json({ enabled: true, ok: false, error: e?.message || String(e) });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/sync/replication-errors  (user 7) -> Liste des dernières erreurs de réplication
router.get('/replication-errors', authenticateToken, (req, res) => {
  if (req.user?.id !== 7) return res.status(403).json({ error: 'Accès refusé' });
  return res.json({ errors: getReplicationErrors() });
});

// GET /api/sync/replication-errors/me -> erreurs filtrées pour l'utilisateur courant (si user_id présent dans l'entrée)
router.get('/replication-errors/me', authenticateToken, (req, res) => {
  const uid = req.user.id;
  const all = getReplicationErrors();
  const mine = all.filter(e => !('user_id' in e) || e.user_id === uid);
  res.json({ user: uid, errors: mine });
});

// POST /api/sync/push/missing-mouvements -> détecte et pousse les mouvements absents côté distant pour l'utilisateur courant
router.post('/push/missing-mouvements', authenticateToken, async (req, res) => {
  if (!remotePool) return res.status(503).json({ error: 'Remote DB non configurée (REMOTE_DB_*)' });
  const userId = req.user.id;
  let rconn;
  try {
    rconn = await remotePool.getConnection();
    // Récupérer IDs locaux
    const [localRows] = await pool.query('SELECT id FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC', [userId]);
    const localIds = localRows.map(r => r.id);
    // Récupérer IDs distants
    const [remoteRows] = await rconn.execute('SELECT id FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC', [userId]);
    const remoteIdsSet = new Set(remoteRows.map(r => r.id));
    const missing = localIds.filter(id => !remoteIdsSet.has(id));
    const pushed = []; const failed = [];
    for (const mid of missing) {
      try {
        await rconn.beginTransaction();
        await pushOneMouvement(userId, mid, rconn);
        await rconn.commit();
        pushed.push(mid);
      } catch (e) {
        try { await rconn.rollback(); } catch {}
        logReplicationError('mouvement.repair', e, { mouvement_id: mid, user_id: userId });
        failed.push({ id: mid, error: e?.message || String(e) });
      }
    }
    return res.json({
      user: userId,
      total_local: localIds.length,
      remote_present: remoteIdsSet.size,
      missing_count: missing.length,
      pushed_count: pushed.length,
      failed_count: failed.length,
      failed,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur détection/push manquants', details: err?.message || String(err) });
  } finally {
    if (rconn) rconn.release();
  }
});

// GET /api/sync/remote/mouvement/:id -> verify mouvement presence in remote DB for current user
router.get('/remote/mouvement/:id', authenticateToken, async (req, res) => {
  if (!remotePool) return res.status(503).json({ error: 'Remote DB non configurée (REMOTE_DB_*)' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });
  const userId = req.user.id;
  let conn;
  try {
    conn = await remotePool.getConnection();
    const [rows] = await conn.execute(
      `SELECT id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR
         FROM stock_mouvements WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (rows.length === 0) return res.json({ found: false });
    return res.json({ found: true, mouvement: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur interrogation base distante', details: e?.message || String(e) });
  } finally {
    if (conn) conn.release();
  }
});

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

// =====================
// PUSH to remote MySQL
// =====================

async function upsertRemoteUser(rconn, userId) {
  const [ru] = await rconn.execute('SELECT id FROM users WHERE id = ?', [userId]);
  if (ru.length === 0) {
    const [lu] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
    const u = lu && lu[0];
    if (u) {
      const [ruByEmail] = await rconn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
      if (ruByEmail.length === 0) {
        await rconn.execute('INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)', [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']);
      }
    }
  }
}

async function pushClients(userId, rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, name, address, phone, email
       FROM stock_clients WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  for (const c of rows) {
    await rconn.execute(
      `INSERT INTO stock_clients (id, user_id, name, address, phone, email)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), phone=VALUES(phone), email=VALUES(email)`,
      [c.id, userId, c.name, c.address || null, c.phone || null, c.email || null]
    );
  }
  return rows.length;
}

async function pushDesignations(userId, rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, name, current_stock, categorie
       FROM stock_designations WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  for (const d of rows) {
    await rconn.execute(
      `INSERT INTO stock_designations (id, user_id, name, current_stock, categorie)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), current_stock=VALUES(current_stock), categorie=VALUES(categorie)`,
      [d.id, userId, d.name, Number(d.current_stock || 0), d.categorie || null]
    );
  }
  return rows.length;
}

async function pushCategories(rconn) {
  // categories sont globales (pas par user)
  // Ensure remote table exists
  try {
    await rconn.execute(
      `CREATE TABLE IF NOT EXISTS stock_categories (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(190) NOT NULL UNIQUE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
  } catch (e) {
    // ignore if no DDL permission; inserts may fail later
  }
  const [rows] = await pool.query(`SELECT id, name FROM stock_categories ORDER BY id ASC`);
  for (const c of rows) {
    await rconn.execute(
      `INSERT INTO stock_categories (id, name)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [c.id, c.name]
    );
  }
  return rows.length;
}

async function pushMouvements(userId, rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
       FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  for (const m of rows) {
    await rconn.execute(
      `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE date=VALUES(date), type=VALUES(type), designation_id=VALUES(designation_id), quantite=VALUES(quantite), prix=VALUES(prix), client_id=VALUES(client_id), stock=VALUES(stock), stockR=VALUES(stockR)`,
      [m.id, userId, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
    );
  }
  return rows.length;
}

async function pushPaiements(userId, rconn) {
  const [rows] = await pool.query(
    `SELECT id, mouvement_id, user_id, montant, strftime('%Y-%m-%d', date) AS date
       FROM stock_paiements WHERE user_id = ? OR user_id IS NULL ORDER BY id ASC`,
    [userId]
  );
  for (const p of rows) {
    // Ensure mouvement exists remotely (minimal)
    const [rm] = await rconn.execute('SELECT id FROM stock_mouvements WHERE id = ? AND user_id = ?', [p.mouvement_id, userId]);
    if (rm.length === 0) {
      const [lm] = await pool.query(
        `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
           FROM stock_mouvements WHERE id = ? AND user_id = ?`,
        [p.mouvement_id, userId]
      );
      const m = lm && lm[0];
      if (m) {
        await rconn.execute(
          `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE date=VALUES(date)`,
          [m.id, userId, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
        );
      }
    }
    await rconn.execute(
      `INSERT INTO stock_paiements (id, mouvement_id, user_id, montant, date)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE montant=VALUES(montant), date=VALUES(date)`,
      [p.id, p.mouvement_id, userId, Number(p.montant), p.date]
    );
  }
  return rows.length;
}

async function pushDepenses(userId, rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, libelle, montant, destinataire
       FROM stock_depenses WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  for (const d of rows) {
    await rconn.execute(
      `INSERT INTO stock_depenses (id, user_id, date, libelle, montant, destinataire)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE date=VALUES(date), libelle=VALUES(libelle), montant=VALUES(montant), destinataire=VALUES(destinataire)`,
      [d.id, userId, d.date, d.libelle, Number(d.montant), d.destinataire || null]
    );
  }
  return rows.length;
}

// Push a single mouvement with dependencies (user, client, designation)
async function pushOneMouvement(userId, mouvementId, rconn) {
  // Load mouvement from local
  const [rows] = await pool.query(
    `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
       FROM stock_mouvements WHERE id = ? AND user_id = ?`,
    [mouvementId, userId]
  );
  if (rows.length === 0) throw new Error('Mouvement introuvable');
  const m = rows[0];

  // Ensure user exists remotely
  await upsertRemoteUser(rconn, userId);

  // Ensure client exists remotely
  if (m.client_id) {
    const [lc] = await pool.query('SELECT id, name FROM stock_clients WHERE id = ? AND user_id = ?', [m.client_id, userId]);
    const lcRow = lc && lc[0];
    if (lcRow) {
      await rconn.execute(
        `INSERT INTO stock_clients (id, user_id, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [lcRow.id, userId, lcRow.name]
      );
    }
  }

  // Ensure designation exists remotely and sync current_stock
  if (m.designation_id) {
    const [ld] = await pool.query('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [m.designation_id, userId]);
    const ldRow = ld && ld[0];
    if (ldRow) {
      await rconn.execute(
        `INSERT INTO stock_designations (id, user_id, name, current_stock)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
        [ldRow.id, userId, ldRow.name, Number(ldRow.current_stock || 0)]
      );
    }
  }

  // Upsert mouvement
  await rconn.execute(
    `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       date=VALUES(date), type=VALUES(type), designation_id=VALUES(designation_id),
       quantite=VALUES(quantite), prix=VALUES(prix), client_id=VALUES(client_id),
       stock=VALUES(stock), stockR=VALUES(stockR)`,
    [m.id, userId, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
  );
  return { id: m.id };
}

// POST /api/sync/push/mouvement/:id  -> re-push un seul mouvement (dépannage)
router.post('/push/mouvement/:id', authenticateToken, async (req, res) => {
  try {
    if (!remotePool) return res.status(503).json({ error: 'Remote DB non configurée (REMOTE_DB_*)' });
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    const rconn = await remotePool.getConnection();
    try {
      await rconn.beginTransaction();
      const result = await pushOneMouvement(userId, id, rconn);
      await rconn.commit();
      return res.json({ success: true, mouvement: result });
    } catch (e) {
      try { await rconn.rollback(); } catch {}
      console.error('Erreur push mouvement unique:', e?.message || e);
      return res.status(500).json({ error: 'Erreur lors du push du mouvement', details: e?.message || String(e) });
    } finally {
      rconn.release();
    }
  } catch (err) {
    console.error('Erreur /push/mouvement/:id:', err?.message || err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// =====================
// PULL (remote -> local)
// =====================

// Simple helper to time out remote queries to avoid hanging SSE forever
async function queryWithTimeout(conn, sql, params = [], timeoutMs = 15000) {
  return await Promise.race([
    conn.query(sql, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Remote query timeout')), timeoutMs))
  ]);
}

async function ensureLocalUser(conn, userId) {
  const [u] = await conn.query('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!u || u.length === 0) {
    await conn.query('INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)', [userId, `User ${userId}`, `user${userId}@local`, '']);
  }
}

async function pullCategoriesFromRemote(lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, 'SELECT id, name FROM stock_categories ORDER BY id ASC', [], 20000);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_categories');
    for (const c of rows) {
      await lconn.query('INSERT INTO stock_categories (id, name) VALUES (?, ?)', [c.id, c.name]);
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

async function pullClientsFromRemote(userId, lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, 'SELECT id, user_id, name, address, phone, email FROM stock_clients WHERE user_id = ? ORDER BY id ASC', [userId], 20000);
  await ensureLocalUser(lconn, userId);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_clients WHERE user_id = ?', [userId]);
    for (const c of rows) {
      await lconn.query('INSERT INTO stock_clients (id, user_id, name, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [c.id, userId, c.name, c.address || null, c.phone || null, c.email || null]);
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

async function pullDesignationsFromRemote(userId, lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, 'SELECT id, user_id, name, current_stock, categorie FROM stock_designations WHERE user_id = ? ORDER BY id ASC', [userId], 20000);
  await ensureLocalUser(lconn, userId);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_designations WHERE user_id = ?', [userId]);
    for (const d of rows) {
      await lconn.query('INSERT INTO stock_designations (id, user_id, name, current_stock, categorie) VALUES (?, ?, ?, ?, ?)', [d.id, userId, d.name, Number(d.current_stock || 0), d.categorie || null]);
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

async function pullMouvementsFromRemote(userId, lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, `SELECT id, user_id, DATE_FORMAT(date,'%Y-%m-%d') as date, type, designation_id, quantite, prix, client_id, stock, stockR FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC`, [userId], 20000);
  await ensureLocalUser(lconn, userId);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_mouvements WHERE user_id = ?', [userId]);
    for (const m of rows) {
      await lconn.query(
        'INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [m.id, userId, m.date, m.type, m.designation_id || null, Number(m.quantite||0), Number(m.prix||0), m.client_id || null, Number(m.stock||0), Number(m.stockR||0)]
      );
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

async function pullPaiementsFromRemote(userId, lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, `SELECT id, mouvement_id, user_id, montant, DATE_FORMAT(date,'%Y-%m-%d') as date FROM stock_paiements WHERE (user_id = ? OR user_id IS NULL) ORDER BY id ASC`, [userId], 20000);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_paiements WHERE user_id = ? OR user_id IS NULL', [userId]);
    for (const p of rows) {
      await lconn.query('INSERT INTO stock_paiements (id, mouvement_id, user_id, montant, date) VALUES (?, ?, ?, ?, ?)', [p.id, p.mouvement_id, p.user_id || null, Number(p.montant||0), p.date]);
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

async function pullDepensesFromRemote(userId, lconn, rconn) {
  const [rows] = await queryWithTimeout(rconn, `SELECT id, user_id, DATE_FORMAT(date,'%Y-%m-%d') as date, libelle, montant, destinataire FROM stock_depenses WHERE user_id = ? ORDER BY id ASC`, [userId], 20000);
  await lconn.beginTransaction();
  try {
    await lconn.query('DELETE FROM stock_depenses WHERE user_id = ?', [userId]);
    for (const d of rows) {
      await lconn.query('INSERT INTO stock_depenses (id, user_id, date, libelle, montant, destinataire) VALUES (?, ?, ?, ?, ?, ?)', [d.id, userId, d.date, d.libelle, Number(d.montant||0), d.destinataire || null]);
    }
    await lconn.commit();
    return rows.length;
  } catch (e) { await lconn.rollback(); throw e; }
}

// GET /api/sync/pull-general/progress -> synchro distante -> locale (toutes tables pertinentes) pour l'utilisateur courant (plus catégories)
router.get('/pull-general/progress', authenticateToken, async (req, res) => {
  try {
    if (!remotePool) {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify({ success: false, reason: 'remote_disabled' })}\n\n`);
      return res.end();
    }
  const userId = req.user.id;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const send = (event, data) => { try { res.write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`); } catch {} };
  let closed = false; req.on('close', () => { closed = true; });
  // Heartbeat to keep the connection alive and let frontend detect progress
  const hb = setInterval(() => { if (!closed) { try { res.write(`: ping\n\n`); } catch {} } }, 5000);

    // Helpers for full tables (users, profiles, subscriptions_payments)
    async function pullUsersAll(l, r) {
      let rows;
      try {
        [rows] = await queryWithTimeout(r, 'SELECT id, full_name, entreprise, email, password, phone_number, logo FROM users ORDER BY id ASC', [], 20000);
      } catch (e) {
        // Fallback sans colonne entreprise
        [rows] = await queryWithTimeout(r, 'SELECT id, full_name, email, password, phone_number, logo FROM users ORDER BY id ASC', [], 20000);
        rows = rows.map(u => ({ ...u, entreprise: null }));
      }
      const adminIds = (process.env.ADMIN_IDS || '1,7').split(',').map(s => s.trim());
      await l.beginTransaction();
      try {
        for (const u of rows) {
          const uid = String(u.id);
          const [loc] = await l.query('SELECT id, password FROM users WHERE id = ? LIMIT 1', [u.id]);
          const localHashed = loc?.length ? String(loc[0].password || '') : '';
          const remoteHashed = String(u.password || '');
          // Stratégie: ne JAMAIS écraser le password local des admins; sinon, garder le local s'il semble valide ($2...)
          let passwordToSet;
          if (loc && loc.length) {
            if (adminIds.includes(uid)) {
              passwordToSet = localHashed; // préserver admin local
            } else if (localHashed && localHashed.startsWith('$2')) {
              passwordToSet = localHashed; // garder hash local valide
            } else {
              passwordToSet = remoteHashed || localHashed || '';
            }
            await l.query(
              'UPDATE users SET full_name = ?, entreprise = ?, email = ?, password = ?, phone_number = ?, logo = ? WHERE id = ?',
              [u.full_name || '', u.entreprise || null, u.email || '', passwordToSet, u.phone_number || null, u.logo || null, u.id]
            );
          } else {
            // Insertion nouvelle: utiliser le hash distant si fourni
            passwordToSet = remoteHashed || '';
            await l.query(
              'INSERT INTO users (id, full_name, entreprise, email, password, phone_number, logo) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [u.id, u.full_name || '', u.entreprise || null, u.email || '', passwordToSet, u.phone_number || null, u.logo || null]
            );
          }
        }
        await l.commit();
        return rows.length;
      } catch (e) { await l.rollback(); throw e; }
    }
    async function pullProfilesAll(l, r) {
      let rows;
      try {
        [rows] = await queryWithTimeout(r, 'SELECT id, user_id, username, role, status, subscription_expires, free_days, auto_sync FROM profiles ORDER BY id ASC', [], 20000);
      } catch (e) {
        try {
          [rows] = await queryWithTimeout(r, 'SELECT id, user_id, username, role, status, subscription_expires, free_days FROM profiles ORDER BY id ASC', [], 20000);
          rows = rows.map(p => ({ ...p, auto_sync: 1 }));
        } catch (e2) {
          [rows] = await queryWithTimeout(r, 'SELECT id, user_id, username, role, status FROM profiles ORDER BY id ASC', [], 20000);
          rows = rows.map(p => ({ ...p, subscription_expires: null, free_days: 0, auto_sync: 1 }));
        }
      }
      await l.beginTransaction();
      try {
        for (const p of rows) {
          // Chercher par id puis par user_id pour éviter les doublons
          const [locById] = await l.query('SELECT id, user_id, role, status, subscription_expires, free_days, auto_sync FROM profiles WHERE id = ? LIMIT 1', [p.id]);
          let targetId = p.id;
          if (!locById || locById.length === 0) {
            const [locByUser] = await l.query('SELECT id, user_id, role, status, subscription_expires, free_days, auto_sync FROM profiles WHERE user_id = ? LIMIT 1', [p.user_id]);
            if (locByUser && locByUser.length) {
              targetId = locByUser[0].id;
            }
          }

          const [loc] = await l.query('SELECT id, user_id, role, status, subscription_expires, free_days, auto_sync FROM profiles WHERE id = ? LIMIT 1', [targetId]);
          const merged = {
            username: p.username || (loc && loc[0]?.username) || null,
            role: p.role || (loc && loc[0]?.role) || 'user',
            status: p.status || (loc && loc[0]?.status) || 'active',
            subscription_expires: (typeof p.subscription_expires !== 'undefined') ? (p.subscription_expires || null) : (loc && loc[0]?.subscription_expires) || null,
            free_days: Math.max(Number(p.free_days)||0, Number(loc && loc[0]?.free_days || 0)),
            auto_sync: (typeof p.auto_sync !== 'undefined') ? (p.auto_sync ? 1 : 0) : (loc && loc[0]?.auto_sync ? 1 : 0)
          };

          if (loc && loc.length) {
            await l.query('UPDATE profiles SET user_id = ?, username = ?, role = ?, status = ?, subscription_expires = ?, free_days = ?, auto_sync = ? WHERE id = ?', [p.user_id, merged.username, merged.role, merged.status, merged.subscription_expires, merged.free_days, merged.auto_sync, targetId]);
          } else {
            await l.query('INSERT INTO profiles (id, user_id, username, role, status, subscription_expires, free_days, auto_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [p.id, p.user_id, merged.username, merged.role, merged.status, merged.subscription_expires, merged.free_days, merged.auto_sync]);
          }
        }
        await l.commit();
        return rows.length;
      } catch (e) { await l.rollback(); throw e; }
    }
    async function pullSubscriptionsPaymentsAll(l, r) {
      let rows;
      try {
        [rows] = await queryWithTimeout(r, 'SELECT id, user_id, amount, currency, phone, provider, reference, status, created_at FROM subscriptions_payments ORDER BY id ASC', [], 20000);
      } catch (e) {
        // table may not exist remotely
        return 0;
      }
      await l.beginTransaction();
      try {
        await l.query('DELETE FROM subscriptions_payments');
        for (const sp of rows) {
          await l.query('INSERT INTO subscriptions_payments (id, user_id, amount, currency, phone, provider, reference, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [sp.id, sp.user_id, Number(sp.amount)||0, sp.currency || 'XOF', sp.phone || null, sp.provider || 'wave', sp.reference || null, sp.status || 'pending', sp.created_at || null]);
        }
        await l.commit();
        return rows.length;
      } catch (e) { await l.rollback(); throw e; }
    }

    const steps = [
      { key: 'users', label: 'Utilisateurs', fn: async (l, r) => ({ pulled: await pullUsersAll(l, r) }) },
      { key: 'profiles', label: 'Profils', fn: async (l, r) => ({ pulled: await pullProfilesAll(l, r) }) },
      { key: 'subscriptions', label: 'Abonnements (paiements)', fn: async (l, r) => ({ pulled: await pullSubscriptionsPaymentsAll(l, r) }) },
      { key: 'categories', label: 'Catégories', fn: async (l, r) => ({ pulled: await pullCategoriesFromRemote(l, r) }) },
      { key: 'clients', label: 'Clients', fn: async (l, r) => ({ pulled: await pullClientsFromRemote(userId, l, r) }) },
      { key: 'designations', label: 'Produits', fn: async (l, r) => ({ pulled: await pullDesignationsFromRemote(userId, l, r) }) },
      { key: 'mouvements', label: 'Mouvements', fn: async (l, r) => ({ pulled: await pullMouvementsFromRemote(userId, l, r) }) },
      { key: 'paiements', label: 'Paiements', fn: async (l, r) => ({ pulled: await pullPaiementsFromRemote(userId, l, r) }) },
      { key: 'depenses', label: 'Dépenses', fn: async (l, r) => ({ pulled: await pullDepensesFromRemote(userId, l, r) }) },
    ];

    send('start', { user: userId, steps: steps.map(s => s.key) });
    const rconn = await remotePool.getConnection();
    const lconn = await pool.getConnection();
    try {
      let hadError = false;
      for (let i = 0; i < steps.length; i++) {
        if (closed) break;
        const s = steps[i];
        send('progress', { step: s.key, label: s.label, status: 'running', index: i, total: steps.length, percent: Math.round((i / steps.length) * 100) });
        const maxRetry = 2; let attempt = 0; let lastErr = null;
        while (attempt <= maxRetry) {
          try {
            const result = await s.fn(lconn, rconn);
            const percent = Math.round(((i + 1) / steps.length) * 100);
            send('progress', { step: s.key, label: s.label, status: 'done', result, index: i + 1, total: steps.length, percent, message: `${s.label}: ${result.pulled ?? 0} importés` });
            lastErr = null; break;
          } catch (e) {
            lastErr = e;
            if (attempt < maxRetry) {
              send('progress', { step: s.key, label: s.label, status: 'retry', attempt: attempt + 1, maxRetry: maxRetry + 1, message: `Réessai ${attempt + 1}/${maxRetry + 1}…` });
              await new Promise(r => setTimeout(r, 800)); attempt++; continue;
            } else {
              send('error', { step: s.key, label: s.label, message: e?.message || String(e) });
              break;
            }
          }
        }
        if (lastErr) { hadError = true; break; }
      }
      send('done', { success: !hadError });
    } finally {
      clearInterval(hb);
      try { lconn.release(); } catch {}
      try { rconn.release(); } catch {}
      try { res.end(); } catch {}
    }
  } catch (err) {
    try {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: err?.message || String(err) })}\n\n`);
    } catch {}
    try { res.end(); } catch {}
  }
});

// GET /api/sync/check/mouvement/:id -> verify that a mouvement exists on remote for this user
router.get('/check/mouvement/:id', authenticateToken, async (req, res) => {
  try {
    if (!remotePool) return res.status(503).json({ error: 'Remote DB non configurée (REMOTE_DB_*)' });
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    let rconn;
    try {
      rconn = await remotePool.getConnection();
      const [rows] = await rconn.execute(
        `SELECT id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR
           FROM stock_mouvements WHERE id = ? AND user_id = ?`,
        [id, userId]
      );
      if (rows.length === 0) return res.json({ present: false });
      return res.json({ present: true, mouvement: rows[0] });
    } finally {
      if (rconn) rconn.release();
    }
  } catch (err) {
    console.error('Erreur check mouvement remote:', err?.message || err);
    res.status(500).json({ error: 'Erreur serveur', details: err?.message || String(err) });
  }
});

// POST /api/sync/push/:entity  -> entity in: clients|designations|mouvements|paiements|depenses|all
router.post('/push/:entity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const entity = String(req.params.entity || '').toLowerCase();
    if (!remotePool) return res.status(503).json({ error: 'Remote DB non configurée (REMOTE_DB_*)' });

    const valid = ['categories', 'clients', 'designations', 'mouvements', 'paiements', 'depenses', 'all'];
    if (!valid.includes(entity)) return res.status(400).json({ error: 'Entité invalide' });

    let rconn = await remotePool.getConnection();
    try {
      // Always ensure user exists remotely first
      await upsertRemoteUser(rconn, userId);

      const result = {};
      if (entity === 'categories' || entity === 'all') {
        await rconn.beginTransaction();
        result.categories = await pushCategories(rconn);
        await rconn.commit();
      }
      if (entity === 'clients' || entity === 'all') {
        await rconn.beginTransaction();
        result.clients = await pushClients(userId, rconn);
        await rconn.commit();
      }
      if (entity === 'designations' || entity === 'all') {
        await rconn.beginTransaction();
        result.designations = await pushDesignations(userId, rconn);
        await rconn.commit();
      }
      if (entity === 'mouvements' || entity === 'all') {
        await rconn.beginTransaction();
        result.mouvements = await pushMouvements(userId, rconn);
        await rconn.commit();
      }
      if (entity === 'paiements' || entity === 'all') {
        await rconn.beginTransaction();
        result.paiements = await pushPaiements(userId, rconn);
        await rconn.commit();
      }
      if (entity === 'depenses' || entity === 'all') {
        await rconn.beginTransaction();
        result.depenses = await pushDepenses(userId, rconn);
        await rconn.commit();
      }

      return res.json({ success: true, user: userId, entity, result });
    } catch (e) {
      try { await rconn.rollback(); } catch {}
      console.error('Erreur push sync:', e?.message || e);
      return res.status(500).json({ error: 'Erreur lors du push distant', details: e?.message || String(e) });
    } finally {
      if (rconn) rconn.release();
    }
  } catch (err) {
    console.error('Erreur /sync/push:', err?.message || err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sync/push/progress -> SSE pour suivre la progression de la synchro (push -> distant)
router.get('/push/progress', authenticateToken, async (req, res) => {
  try {
    if (!remotePool) {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify({ success: false, reason: 'remote_disabled' })}\n\n`);
      return res.end();
    }
    const userId = req.user.id;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders?.();

    const send = (event, data) => {
      try { res.write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    let closed = false;
    req.on('close', () => { closed = true; });

    const steps = [
      { key: 'categories', label: 'Catégories', fn: async (r) => ({ sent: await pushCategories(r) }) },
      { key: 'clients', label: 'Clients', fn: async (r) => ({ sent: await pushClients(userId, r) }) },
      { key: 'designations', label: 'Produits', fn: async (r) => ({ sent: await pushDesignations(userId, r) }) },
      { key: 'mouvements', label: 'Mouvements', fn: async (r) => ({ sent: await pushMouvements(userId, r) }) },
      { key: 'paiements', label: 'Paiements', fn: async (r) => ({ sent: await pushPaiements(userId, r) }) },
      { key: 'depenses', label: 'Dépenses', fn: async (r) => ({ sent: await pushDepenses(userId, r) }) },
    ];

    send('start', { user: userId, steps: steps.map(s => s.key) });

    const rconn = await remotePool.getConnection();
    try {
      await upsertRemoteUser(rconn, userId);
      for (let i = 0; i < steps.length; i++) {
        if (closed) break;
        const s = steps[i];
        send('progress', { step: s.key, label: s.label, status: 'running', index: i, total: steps.length, percent: Math.round((i / steps.length) * 100) });
        const maxRetry = 2;
        let attempt = 0;
        let lastErr = null;
        while (attempt <= maxRetry) {
          try {
            await rconn.beginTransaction();
            const result = await s.fn(rconn);
            await rconn.commit();
            const percent = Math.round(((i + 1) / steps.length) * 100);
            send('progress', { step: s.key, label: s.label, status: 'done', result, index: i + 1, total: steps.length, percent, message: `${s.label}: ${result.sent ?? 0} envoyés` });
            lastErr = null;
            break;
          } catch (e) {
            try { await rconn.rollback(); } catch {}
            lastErr = e;
            if (attempt < maxRetry) {
              send('progress', { step: s.key, label: s.label, status: 'retry', attempt: attempt + 1, maxRetry: maxRetry + 1, message: `Réessai ${attempt + 1}/${maxRetry + 1}…` });
              await new Promise(res => setTimeout(res, 800));
              attempt++;
              continue;
            } else {
              send('error', { step: s.key, label: s.label, message: e?.message || String(e) });
              break;
            }
          }
        }
        if (lastErr) break;
      }
      send('done', { success: true });
    } finally {
      rconn.release();
      res.end();
    }
  } catch (err) {
    try {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: err?.message || String(err) })}\n\n`);
    } catch {}
    try { res.end(); } catch {}
  }
});
