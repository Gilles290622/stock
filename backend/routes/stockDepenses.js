const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// POST /api/stockDepenses — insérer une dépense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, libelle, montant, destinataire } = req.body || {};

    // Validations minimales
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD)' });
    }
    const label = String(libelle || '').trim();
    if (!label) return res.status(400).json({ error: 'Libellé requis' });

    const amount = Number(montant);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Montant doit être un nombre >= 0' });
    }

    const dest = String(destinataire || '').trim() || null;

    const [result] = await pool.execute(
      `INSERT INTO stock_depenses (user_id, date, libelle, montant, destinataire)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, date, label, amount, dest]
    );

    res.status(201).json({
      id: result.insertId,
      date,
      libelle: label,
      montant: amount,
      destinataire: dest
    });
  } catch (err) {
    console.error('Erreur POST dépense:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la création de la dépense' });
  }
});

module.exports = router;