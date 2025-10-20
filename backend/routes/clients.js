const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

// Helper to get entreprise context (id, name, global_code) for current user
async function getEntrepriseContext(userId) {
  const [rows] = await pool.execute(
    `SELECT u.entreprise_id AS entId,
            COALESCE(e.name, u.entreprise) AS entName,
            e.global_code AS entGlobal
       FROM users u
       LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
      WHERE u.id = ?
      LIMIT 1`,
    [userId]
  );
  const r = rows && rows[0];
  return { entId: (r && r.entId) ?? null, entName: (r && r.entName) || null, entGlobal: (r && r.entGlobal) ?? null };
}

// Liste complète (option q) sans limite
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const q = (req.query.q || '').trim();
    if (q) {
      const like = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT sc.id, sc.name, sc.contact
           FROM stock_clients sc
          WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
            AND LOWER(sc.name) LIKE LOWER(?)
          ORDER BY sc.name`,
        [entGlobal, entGlobal, entName || '', like]
      );
      try { console.log('[log][clients.all] user=%s q="%s" count=%d ids=%j', userId, q, rows.length, rows.map(r=>r.id).slice(0,20)); } catch {}
      return res.json(rows);
    } else {
      const [rows] = await pool.execute(
        `SELECT sc.id, sc.name, sc.contact
           FROM stock_clients sc
          WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
          ORDER BY sc.name`,
        [entGlobal, entGlobal, entName || '']
      );
      try { console.log('[log][clients.all] user=%s count=%d ids(sample)=%j', userId, rows.length, rows.map(r=>r.id).slice(0,20)); } catch {}
      return res.json(rows);
    }
  } catch (err) {
    console.error('Erreur GET clients/all:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération de tous les clients" });
  }
});

// Compte total (option q)
router.get('/count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const q = (req.query.q || '').trim();
    if (q) {
      const like = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS count
           FROM stock_clients sc
          WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
            AND LOWER(sc.name) LIKE LOWER(?)`,
        [entGlobal, entGlobal, entName || '', like]
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
      try { console.log('[log][clients.count] user=%s q="%s" count=%d', userId, q, count); } catch {}
      return res.json({ count });
    } else {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS count
           FROM stock_clients sc
          WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))`,
        [entGlobal, entGlobal, entName || '']
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
      try { console.log('[log][clients.count] user=%s count=%d', userId, count); } catch {}
      return res.json({ count });
    }
  } catch (err) {
    console.error('Erreur GET clients/count:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors du comptage des clients" });
  }
});

// Recherche rapide
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length === 0) return res.json([]);
    const userId = req.user.id;
    const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const like = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.name, sc.contact
         FROM stock_clients sc
        WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
          AND LOWER(sc.name) LIKE LOWER(?)
        ORDER BY sc.name
        LIMIT 10`,
      [entGlobal, entGlobal, entName || '', like]
    );
    try { console.log('[log][clients.search] user=%s q="%s" count=%d ids=%j', userId, q, rows.length, rows.map(r=>r.id)); } catch {}
    res.json(rows);
  } catch (err) {
    console.error('Erreur GET clients/search:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la recherche des clients" });
  }
});

// Liste partielle des clients
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.name, sc.contact
         FROM stock_clients sc
        WHERE (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
        ORDER BY sc.name
        LIMIT 20`,
      [entGlobal, entGlobal, entName || '']
    );
    try { console.log('[log][clients.list] user=%s count=%d ids=%j', userId, rows.length, rows.map(r=>r.id)); } catch {}
    res.json(rows);
  } catch (err) {
    console.error('Erreur GET clients:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération des clients" });
  }
});


// Relevé client avec balance et solde
router.get('/:id/releve', authenticateToken, async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  if (!clientId) return res.status(400).json({ error: "ID client invalide" });
  const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);

  try {
    const [rowsRaw] = await pool.execute(
      `SELECT 
        m.id,
        m.date,
        m.type,
        d.name AS designation,
        m.montant
      FROM stock_mouvements m
      LEFT JOIN stock_designations d ON m.designation_id = d.id AND d.user_id = m.user_id
      LEFT JOIN stock_clients c ON m.client_id = c.id AND c.user_id = m.user_id
      WHERE m.client_id = ?
        AND (m.global_id = ? OR (? IS NULL AND m.user_id IN (
              SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
            )))
      ORDER BY m.date ASC, m.id ASC
      `,
      [clientId, entGlobal, entGlobal, entName || '']
    );

    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    // Calcul côté serveur pour une meilleure compatibilité (pas de window function)
    let running = 0;
    let out = [];
    try {
      out = rows.map((r) => {
        const t = String(r.type || '').toLowerCase();
        const amt = Math.abs(Number(r.montant || 0));
        const balance = t === 'paiement' ? -amt : amt;
        running += balance;
        return { ...r, balance, solde: running };
      });
    } catch (e) {
      console.error('Mapping error in /clients/:id/releve', e?.message || e, { rowsType: typeof rowsRaw });
      out = [];
    }

    res.json(out);
  } catch (err) {
    console.error('Erreur GET /clients/:id/releve', err?.stack || err?.message || err);
    if (String(req.query.debug || '') === '1') {
      return res.status(500).json({
        error: "Erreur lors de la récupération du relevé client",
        details: err?.message || String(err),
        stack: process.env.NODE_ENV !== 'production' ? (err?.stack || null) : undefined
      });
    }
    res.status(500).json({ error: "Erreur lors de la récupération du relevé client" });
  }
});



// Détail d'un client
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "ID invalide" });
    }
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.name, sc.contact
         FROM stock_clients sc
        WHERE sc.id = ?
          AND (sc.global_id = ? OR (? IS NULL AND sc.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))`,
      [id, entGlobal, entGlobal, entName || '']
    );
    try { console.log('[log][clients.get] user=%s id=%s found=%s', userId, id, rows.length>0); } catch {}
    if (rows.length === 0) {
      return res.status(404).json({ error: "Client non trouvé" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Erreur GET client/:id:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération du client" });
  }
});

// Créer un client (si déjà existant -> renvoie l'existant)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const [ctxRows] = await pool.execute(
      `SELECT e.global_code AS entGlobal FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?`,
      [userId]
    );
    const entGlobal = (ctxRows && ctxRows[0] && ctxRows[0].entGlobal) ?? null;
    const [existing] = await pool.execute(
      'SELECT id, name, contact FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?)',
      [userId, name]
    );
    if (existing.length > 0) return res.status(200).json(existing[0]);

    try {
      const contact = req.body?.contact ? String(req.body.contact).trim() : null;
      const [ins] = await pool.execute(
        'INSERT INTO stock_clients (user_id, name, contact, global_id) VALUES (?, ?, ?, ?)',
        [userId, name, contact, entGlobal]
      );
      const payload = { id: ins.insertId, name, contact };
      try { console.log('[log][clients.create] user=%s id=%s name=%j', userId, payload.id, name); } catch {}
      // Best-effort remote replication for new client
      if (remotePool) {
        (async () => {
          let rconn;
          try {
            rconn = await remotePool.getConnection();
            // Ensure user exists remotely
            const [ru] = await rconn.execute('SELECT id FROM users WHERE id = ?', [userId]);
            if (ru.length === 0) {
              const [lu] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
              const u = lu && lu[0];
              if (u) {
                const [ruByEmail] = await rconn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
                if (ruByEmail.length === 0) {
                  await rconn.execute(
                    'INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)',
                    [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
                  );
                }
              }
            }
            await rconn.execute(
              `INSERT INTO stock_clients (id, user_id, name, address, phone, email, global_id)
               VALUES (?, ?, ?, NULL, NULL, NULL, ?)
               ON DUPLICATE KEY UPDATE name = VALUES(name), global_id = VALUES(global_id)`,
              [payload.id, userId, name, entGlobal]
            );
          } catch (e) {
            console.warn('Remote push (client create) skipped:', e?.message || e);
          } finally {
            if (rconn) rconn.release();
          }
        })();
      }
      return res.status(201).json(payload);
    } catch (e) {
      const msg = String(e?.message || e?.code || '');
      if (msg.includes('UNIQUE') || msg.toLowerCase().includes('constraint')) {
        const [retry] = await pool.execute(
          'SELECT id, name, contact FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?)',
          [userId, name]
        );
        if (retry.length > 0) return res.status(200).json(retry[0]);
      }
      throw e;
    }
  } catch (err) {
    console.error('Erreur POST clients:', err?.code, err?.message || err);
    res.status(500).json({ error: 'Erreur lors de la création du client', details: err?.message || String(err) });
  }
});

module.exports = router;
/**
 * PATCH /api/clients/:id
 * Body accepts any of: { name, contact, address, phone, email }
 * - Scoped by authenticated user
 * - Enforces uniqueness of (user_id, LOWER(name))
 * - Mirrors changes to remote MySQL best-effort
 */
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    const allowed = ['name', 'contact', 'address', 'phone', 'email'];
    const updates = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        const v = req.body[k];
        if (v === undefined) continue;
        updates[k] = v === '' ? null : String(v).trim();
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });

    // Exists and belongs to user?
    const [[ctx]] = await pool.query(
      `SELECT sc.id, sc.user_id
         FROM stock_clients sc
        WHERE sc.id = ?
          AND (sc.global_id = (SELECT e.global_code FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?)
               OR ((SELECT entreprise_id FROM users WHERE id = ?) IS NULL AND sc.user_id IN (
                    SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = COALESCE((SELECT entreprise FROM users WHERE id = ?),'')
               )))
        LIMIT 1`,
      [id, userId, userId, userId]
    );
    if (!ctx) return res.status(404).json({ error: 'Client non trouvé' });
    if (ctx.user_id !== userId) return res.status(403).json({ error: 'Accès refusé' });

    // Uniqueness for name if changing
    if (updates.name) {
      const [curr] = await pool.execute('SELECT name FROM stock_clients WHERE id = ? AND user_id = ?', [id, userId]);
      const currentName = curr && curr[0] ? String(curr[0].name || '') : '';
      if (updates.name.toLowerCase() !== currentName.toLowerCase()) {
      const [dups] = await pool.execute(
          'SELECT id FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
          [userId, updates.name, id]
        );
      if (dups.length > 0) return res.status(400).json({ error: 'Nom déjà utilisé' });
      }
    }

    // Dynamic update
    const setParts = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      setParts.push(`${k} = ?`);
      values.push(v);
    }
  values.push(id, userId);
  await pool.execute(`UPDATE stock_clients SET ${setParts.join(', ')} WHERE id = ? AND user_id = ?`, values);

  const [rows] = await pool.execute('SELECT id, name, contact, address, phone, email FROM stock_clients WHERE id = ? AND user_id = ?', [id, userId]);
    const updated = rows[0];

    // Best-effort remote replication
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          // Ensure user exists remotely
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

          await rconn.execute(
            `INSERT INTO stock_clients (id, user_id, name, address, phone, email)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), phone = VALUES(phone), email = VALUES(email)`,
            [updated.id, userId, updated.name, updated.address || null, updated.phone || null, updated.email || null]
          );
        } catch (e) {
          console.warn('Remote push (client update) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }

    return res.json(updated);
  } catch (err) {
    console.error('Erreur PATCH clients/:id:', err?.code, err?.message || err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du client' });
  }
});