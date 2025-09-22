const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// Mettre à jour le profil (name, phone_number, logo)
router.post('/update-profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // authentifié
    const { full_name, phone_number, logo } = req.body;

    // Validation simple
    if (!full_name || typeof full_name !== 'string') {
      return res.status(400).json({ error: 'Nom invalide' });
    }

    // Exemple update
    await pool.execute(
      `UPDATE users SET full_name = ?, phone_number = ?, logo = ? WHERE id = ?`,
      [full_name, phone_number || null, logo || null, userId]
    );

    // Retourner le profil mis à jour
    const [rows] = await pool.execute(
      `SELECT id, email, full_name, phone_number, logo FROM users WHERE id = ?`,
      [userId]
    );
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Erreur update-profile:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});

module.exports = router;