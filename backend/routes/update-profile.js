const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // mysql2 pool expected
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

// POST /api/update-profile
// Body attendu: { full_name, phone_number, logo }
// UTILISER req.user.id (ne pas faire confiance à userId du body)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { full_name, phone_number, logo, entreprise } = req.body;

    if (!full_name || typeof full_name !== 'string') {
      return res.status(400).json({ error: 'Nom invalide' });
    }

    await pool.execute(
      `UPDATE users SET full_name = ?, entreprise = COALESCE(?, entreprise), phone_number = ?, logo = ? WHERE id = ?`,
      [full_name, entreprise || null, phone_number || null, logo || null, userId]
    );

    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.full_name, u.entreprise, u.phone_number, u.logo, p.username, p.role, p.status
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
        WHERE u.id = ?`,
      [userId]
    );

    const user = rows[0] || null;
    // Best-effort remote replication of user profile fields
    if (remotePool && user) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          try {
            await rconn.execute(
              `INSERT INTO users (id, full_name, entreprise, email, password, phone_number, logo)
               VALUES (?, ?, ?, ?, COALESCE((SELECT password FROM users WHERE id = ?), ''), ?, ?)
               ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), entreprise=VALUES(entreprise), phone_number=VALUES(phone_number), logo=VALUES(logo)`,
              [userId, user.full_name, user.entreprise || null, user.email, userId, user.phone_number || null, user.logo || null]
            );
          } catch (colErr) {
            if (colErr && /Unknown column 'entreprise'|ER_BAD_FIELD_ERROR/i.test(colErr.message || '')) {
              await rconn.execute(
                `INSERT INTO users (id, full_name, email, password, phone_number, logo)
                 VALUES (?, ?, ?, COALESCE((SELECT password FROM users WHERE id = ?), ''), ?, ?)
                 ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), phone_number=VALUES(phone_number), logo=VALUES(logo)`,
                [userId, user.full_name, user.email, userId, user.phone_number || null, user.logo || null]
              );
            } else {
              throw colErr;
            }
          }

          // Upsert profile row (username/role/status) si présent
          const username = user.username || null;
          const role = user.role || 'user';
          const status = user.status || 'pending';
          if (username) {
            const [rp] = await rconn.execute('SELECT id FROM profiles WHERE user_id = ? LIMIT 1', [userId]);
            if (Array.isArray(rp) && rp.length === 0) {
              await rconn.execute(
                'INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)',
                [userId, role, status, username]
              );
            } else {
              await rconn.execute(
                'UPDATE profiles SET username = ?, role = COALESCE(role, ?), status = COALESCE(status, ?) WHERE user_id = ?',
                [username, role, status, userId]
              );
            }
          }
        } catch (e) {
          console.warn('Remote push (update-profile) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error('Erreur update-profile:', err?.code || err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});

module.exports = router;