const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

async function getEntrepriseContext(userId) {
  const [rows] = await pool.execute(
    `SELECT u.entreprise_id AS entId, COALESCE(u.entreprise, e.name) AS entName, e.global_code AS entGlobal
       FROM users u
       LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
      WHERE u.id = ?
      LIMIT 1`,
    [userId]
  );
  const r = rows && rows[0];
  return { entId: (r && r.entId) ?? null, entName: (r && r.entName) || null, entGlobal: (r && r.entGlobal) ?? null };
}

// IMPORTANT: /search AVANT /:id

// Liste complète (option q) sans limite
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const q = (req.query.q || '').trim();
    if (q) {
      const like = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT sd.id, sd.name, sd.current_stock
           FROM stock_designations sd
          WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
            AND LOWER(sd.name) LIKE LOWER(?)
          ORDER BY sd.name`,
        [entGlobal, entGlobal, entName || '', like]
      );
      try { console.log('[log][designations.all] user=%s q="%s" count=%d ids=%j', userId, q, rows.length, rows.map(r=>r.id).slice(0,20)); } catch {}
      return res.json(rows);
    } else {
      const [rows] = await pool.execute(
        `SELECT sd.id, sd.name, sd.current_stock
           FROM stock_designations sd
          WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
          ORDER BY sd.name`,
        [entGlobal, entGlobal, entName || '']
      );
      try { console.log('[log][designations.all] user=%s count=%d ids(sample)=%j', userId, rows.length, rows.map(r=>r.id).slice(0,20)); } catch {}
      return res.json(rows);
    }
  } catch (err) {
    console.error('Erreur GET designations/all:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération de toutes les désignations" });
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
           FROM stock_designations sd
          WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))
            AND LOWER(sd.name) LIKE LOWER(?)`,
        [entGlobal, entGlobal, entName || '', like]
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
      try { console.log('[log][designations.count] user=%s q="%s" count=%d', userId, q, count); } catch {}
      return res.json({ count });
    } else {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS count
           FROM stock_designations sd
          WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                   SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
                 )))`,
        [entGlobal, entGlobal, entName || '']
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
      try { console.log('[log][designations.count] user=%s count=%d', userId, count); } catch {}
      return res.json({ count });
    }
  } catch (err) {
    console.error('Erreur GET designations/count:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors du comptage des désignations" });
  }
});

// GET /search?q=...  -> recherche limitée aux désignations de l'utilisateur connecté
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length === 0) return res.json([]);

    const userId = req.user.id;
    const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const like = `%${q}%`;

    const [rows] = await pool.execute(
      `SELECT sd.id, sd.name, sd.current_stock
         FROM stock_designations sd
        WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
          AND LOWER(sd.name) LIKE LOWER(?)
        ORDER BY sd.name
        LIMIT 10`,
      [entGlobal, entGlobal, entName || '', like]
    );
    try { console.log('[log][designations.search] user=%s q="%s" count=%d ids=%j', userId, q, rows.length, rows.map(r=>r.id)); } catch {}
    res.json(rows);
  } catch (err) {
    console.error('Erreur GET designations/search:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la recherche des désignations" });
  }
});

// GET /  -> liste limitée des désignations de l'utilisateur connecté
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const [rows] = await pool.execute(
      `SELECT sd.id, sd.name, sd.current_stock
         FROM stock_designations sd
        WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
        ORDER BY sd.name
        LIMIT 50`,
      [entGlobal, entGlobal, entName || '']
    );
    try { console.log('[log][designations.list] user=%s count=%d ids=%j', userId, rows.length, rows.map(r=>r.id)); } catch {}
    res.json(rows);
  } catch (err) {
    console.error('Erreur GET designations:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération des désignations" });
  }
});

// GET /:id  -> retourne la désignation uniquement si elle appartient à l'utilisateur connecté
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "ID invalide" });
    }

    const userId = req.user.id;
  const { entGlobal, entId, entName } = await getEntrepriseContext(userId);
    const [rows] = await pool.execute(
      `SELECT sd.id, sd.name, sd.current_stock
         FROM stock_designations sd
        WHERE sd.id = ?
          AND (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))`,
      [id, entGlobal, entGlobal, entName || '']
    );
    try { console.log('[log][designations.get] user=%s id=%s found=%s', userId, id, rows.length>0); } catch {}
    if (rows.length === 0) {
      // Ne pas révéler l'existence pour d'autres users : renvoyer 404
      return res.status(404).json({ error: "Désignation non trouvée" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Erreur GET designation/:id:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la récupération de la désignation" });
  }
});

// POST /  -> crée une désignation (scopée user). Si existe déjà, renvoie l'existante.
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    // Existe déjà ?
    const [existing] = await pool.execute(
      'SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)',
      [userId, name]
    );
    if (existing.length > 0) return res.status(200).json(existing[0]);

    // Créer
    try {
      const [ctxRows] = await pool.execute(
        `SELECT e.global_code AS entGlobal FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?`,
        [userId]
      );
      const entGlobal = (ctxRows && ctxRows[0] && ctxRows[0].entGlobal) ?? null;
      const [ins] = await pool.execute(
        'INSERT INTO stock_designations (user_id, name, current_stock, global_id) VALUES (?, ?, 0, ?)',
        [userId, name, entGlobal]
      );
      const payload = { id: ins.insertId, name, current_stock: 0 };
      try { console.log('[log][designations.create] user=%s id=%s name=%j', userId, payload.id, name); } catch {}
      // Best-effort remote replication for new designation
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
              `INSERT INTO stock_designations (id, user_id, name, current_stock, global_id)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock), global_id = VALUES(global_id)`,
              [payload.id, userId, name, 0, entGlobal]
            );
          } catch (e) {
            console.warn('Remote push (designation create) skipped:', e?.message || e);
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
          'SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)',
          [userId, name]
        );
        if (retry.length > 0) return res.status(200).json(retry[0]);
      }
      throw e;
    }
  } catch (err) {
    console.error('Erreur POST designations:', err?.code, err?.message || err);
    res.status(500).json({ error: "Erreur lors de la création de la désignation", details: err?.message || String(err) });
  }
});

module.exports = router;
/**
 * PATCH /api/designations/:id
 * Body accepts: { name }
 * - Scoped by authenticated user
 * - Enforces uniqueness of (user_id, LOWER(name))
 * - Mirrors change to remote MySQL best-effort
 */
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    const name = (req.body?.name ?? '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const [exists] = await pool.execute('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [id, userId]);
    if (exists.length === 0) return res.status(404).json({ error: 'Désignation non trouvée' });
    if (name.toLowerCase() !== String(exists[0].name || '').toLowerCase()) {
      const [dups] = await pool.execute(
        'SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
        [userId, name, id]
      );
      if (dups.length > 0) return res.status(400).json({ error: 'Nom déjà utilisé' });
    }

    await pool.execute('UPDATE stock_designations SET name = ? WHERE id = ? AND user_id = ?', [name, id, userId]);
    const [rows] = await pool.execute('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [id, userId]);
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
          // also replicate global_id for parity
          let entGlobal = null;
          try {
            const [[ctx]] = await pool.query(`SELECT e.global_code AS entGlobal FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?`, [userId]);
            entGlobal = ctx ? ctx.entGlobal : null;
          } catch {}
          await rconn.execute(
            `INSERT INTO stock_designations (id, user_id, name, current_stock, global_id)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock), global_id = VALUES(global_id)`,
            [updated.id, userId, updated.name, Number(updated.current_stock || 0), entGlobal]
          );
        } catch (e) {
          console.warn('Remote push (designation update) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }

    return res.json(updated);
  } catch (err) {
    console.error('Erreur PATCH designations/:id:', err?.code, err?.message || err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la désignation' });
  }
});