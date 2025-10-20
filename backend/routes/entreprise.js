const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

// GET entreprise info for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Prefer resolve via entreprise_id -> stock_entreprise.name if available
    let entrepriseName = '';
    try {
      const [r2] = await pool.execute(
        `SELECT COALESCE(e.name, u.entreprise) AS entreprise
           FROM users u
      LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
          WHERE u.id = ? LIMIT 1`,
        [userId]
      );
      if (!r2.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
      entrepriseName = r2[0].entreprise || '';
    } catch (_) {
      const [rows] = await pool.execute('SELECT entreprise FROM users WHERE id = ? LIMIT 1', [userId]);
      if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
      entrepriseName = rows[0].entreprise || '';
    }
    return res.json({ entreprise: entrepriseName });
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
    // Upsert entreprise name into stock_entreprise and set users.entreprise_id when possible
    let setByIdDone = false;
    try {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        if (entreprise) {
          // ensure table exists, insert or fetch id
          await conn.execute('CREATE TABLE IF NOT EXISTS stock_entreprise (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT)');
          // insert or ignore, then fetch id
          try { await conn.execute('INSERT OR IGNORE INTO stock_entreprise (name) VALUES (?)', [entreprise]); } catch (_) {}
          const [rows] = await conn.execute('SELECT id FROM stock_entreprise WHERE name = ? LIMIT 1', [entreprise]);
          const entId = rows && rows.length ? rows[0].id : null;
          if (entId) {
            try {
              await conn.execute('ALTER TABLE users ADD COLUMN entreprise_id INTEGER');
            } catch (_) { /* ignore */ }
            await conn.execute('UPDATE users SET entreprise_id = ? WHERE id = ?', [entId, userId]);
            setByIdDone = true;
          }
        }
        await conn.commit();
      } catch (e) { try { await conn.rollback(); } catch (_) {} throw e; }
      finally { conn.release(); }
    } catch (_) { /* fallback to old varchar column */ }

    if (!setByIdDone) {
      await pool.execute('UPDATE users SET entreprise = ? WHERE id = ?', [entreprise || null, userId]);
    }
    // remote replication (best effort)
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          try {
            // Try mapping by name -> entreprise_id remotely if table exists
            if (entreprise) {
              await rconn.beginTransaction();
              await rconn.execute('CREATE TABLE IF NOT EXISTS stock_entreprise (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP)');
              await rconn.execute('INSERT INTO stock_entreprise (name) VALUES (?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [entreprise]);
              const [r] = await rconn.execute('SELECT id FROM stock_entreprise WHERE name = ? LIMIT 1', [entreprise]);
              const entId = r && r.length ? r[0].id : null;
              if (entId) {
                try { await rconn.execute('ALTER TABLE users ADD COLUMN entreprise_id INT NULL'); } catch (_) {}
                await rconn.execute('UPDATE users SET entreprise_id = ? WHERE id = ?', [entId, userId]);
                await rconn.commit();
              } else { await rconn.rollback(); }
            } else {
              await rconn.execute('UPDATE users SET entreprise_id = NULL WHERE id = ?', [userId]);
            }
          } catch (colErr) {
            // fallback to legacy varchar column
            await rconn.execute('UPDATE users SET entreprise = ? WHERE id = ?', [entreprise || null, userId]).catch(()=>{});
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