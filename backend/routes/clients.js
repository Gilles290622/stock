const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// Recherche rapide
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length === 0) return res.json([]);
    const userId = req.user.id;
    const like = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT id, name, contact FROM stock_clients WHERE user_id = ? AND LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 10`,
      [userId, like]
    );
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
    const [rows] = await pool.execute(
      'SELECT id, name, contact FROM stock_clients WHERE user_id = ? ORDER BY name LIMIT 20', [userId]
    );
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

  try {
    const [rows] = await pool.execute(
      `SELECT 
        m.id,
        m.date,
        m.type,
        d.name AS designation,
        m.montant,
        m.mode_paiement,
        m.observation,
        CASE
          WHEN LOWER(m.type) = 'paiement' THEN -ABS(m.montant)
          ELSE ABS(m.montant)
        END AS balance,
        SUM(
          CASE
            WHEN LOWER(m.type) = 'paiement' THEN -ABS(m.montant)
            ELSE ABS(m.montant)
          END
        ) OVER (ORDER BY m.date ASC, m.id ASC) AS solde
      FROM stock_mouvements m
      LEFT JOIN stock_designations d ON m.designation_id = d.id
      WHERE m.client_id = ?
      ORDER BY m.date ASC, m.id ASC
      `, [clientId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erreur GET /clients/:id/releve', err?.code, err?.message || err);
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
    const [rows] = await pool.execute(
      'SELECT id, name, contact FROM stock_clients WHERE id = ? AND user_id = ?', [id, userId]
    );
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

    const [existing] = await pool.execute(
      'SELECT id, name, contact FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?)',
      [userId, name]
    );
    if (existing.length > 0) return res.status(200).json(existing[0]);

    try {
      const contact = req.body?.contact ? String(req.body.contact).trim() : null;
      const [ins] = await pool.execute(
        'INSERT INTO stock_clients (user_id, name, contact) VALUES (?, ?, ?)',
        [userId, name, contact]
      );
      return res.status(201).json({ id: ins.insertId, name, contact });
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