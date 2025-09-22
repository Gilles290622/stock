const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // mysql2 pool expected
const authenticateToken = require('../middleware/auth');

// POST /api/update-profile
// Body attendu: { full_name, phone_number, logo }
// UTILISER req.user.id (ne pas faire confiance à userId du body)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { full_name, phone_number, logo } = req.body;

    if (!full_name || typeof full_name !== 'string') {
      return res.status(400).json({ error: 'Nom invalide' });
    }

    await pool.execute(
      `UPDATE users SET full_name = ?, phone_number = ?, logo = ? WHERE id = ?`,
      [full_name, phone_number || null, logo || null, userId]
    );

    const [rows] = await pool.execute(
      `SELECT id, email, full_name, phone_number, logo FROM users WHERE id = ?`,
      [userId]
    );

    return res.json({ success: true, user: rows[0] || null });
  } catch (err) {
    console.error('Erreur update-profile:', err?.code || err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});

module.exports = router;