const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

// GET entreprise info for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute('SELECT entreprise FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.json({ entreprise: rows[0].entreprise || '' });
  } catch (e) {
    console.error('Erreur GET entreprise:', e?.message || e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT / PATCH entreprise
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let { entreprise } = req.body;
    entreprise = (entreprise || '').trim();
    if (entreprise.length > 255) {
      return res.status(400).json({ error: 'Entreprise trop longue (<=255)' });
    }
    await pool.execute('UPDATE users SET entreprise = ? WHERE id = ?', [entreprise || null, userId]);
    // remote replication (best effort)
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          try {
            await rconn.execute(
              `UPDATE users SET entreprise = ? WHERE id = ?`,
              [entreprise || null, userId]
            );
          } catch (colErr) {
            if (colErr && /Unknown column 'entreprise'|ER_BAD_FIELD_ERROR/i.test(colErr.message || '')) {
              // silently ignore if column missing remotely
            } else throw colErr;
          }
        } catch (e) {
          console.warn('Remote push (entreprise update) skipped:', e?.message || e);
        } finally { if (rconn) rconn.release(); }
      })();
    }
    return res.json({ success: true, entreprise });
  } catch (e) {
    console.error('Erreur PUT entreprise:', e?.message || e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;