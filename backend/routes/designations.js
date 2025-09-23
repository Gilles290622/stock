const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// IMPORTANT: /search AVANT /:id

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
      return res.status(201).json({ id: ins.insertId, name, current_stock: 0 });
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