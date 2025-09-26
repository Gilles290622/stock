const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

// IMPORTANT: /search AVANT /:id

// Liste complète (option q) sans limite
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = (req.query.q || '').trim();
    if (q) {
      const like = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT id, name, current_stock
           FROM stock_designations
          WHERE user_id = ? AND LOWER(name) LIKE LOWER(?)
          ORDER BY name`,
        [userId, like]
      );
      return res.json(rows);
    } else {
      const [rows] = await pool.execute(
        'SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? ORDER BY name',
        [userId]
      );
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
    const q = (req.query.q || '').trim();
    if (q) {
      const like = `%${q}%`;
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM stock_designations WHERE user_id = ? AND LOWER(name) LIKE LOWER(?)',
        [userId, like]
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
      return res.json({ count });
    } else {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM stock_designations WHERE user_id = ?',
        [userId]
      );
      const count = rows && rows[0] ? (rows[0].count || rows[0].COUNT || rows[0]['COUNT(*)'] || 0) : 0;
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
    const like = `%${q}%`;

    const [rows] = await pool.execute(
      `SELECT id, name, current_stock
         FROM stock_designations
        WHERE user_id = ? AND LOWER(name) LIKE LOWER(?)
        ORDER BY name
        LIMIT 10`,
      [userId, like]
    );

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
    const [rows] = await pool.execute(
      'SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? ORDER BY name LIMIT 50',
      [userId]
    );
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
    const [rows] = await pool.execute(
      'SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?',
      [id, userId]
    );
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
      const [ins] = await pool.execute(
        'INSERT INTO stock_designations (user_id, name, current_stock) VALUES (?, ?, 0)',
        [userId, name]
      );
      const payload = { id: ins.insertId, name, current_stock: 0 };
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
              `INSERT INTO stock_designations (id, user_id, name, current_stock)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
              [payload.id, userId, name, 0]
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
          await rconn.execute(
            `INSERT INTO stock_designations (id, user_id, name, current_stock)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name)`,
            [updated.id, userId, updated.name, Number(updated.current_stock || 0)]
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