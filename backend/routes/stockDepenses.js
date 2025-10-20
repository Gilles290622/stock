const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

async function getEntrepriseContext(userId) {
  const [rows] = await pool.execute(
    `SELECT u.entreprise_id AS entId, COALESCE(e.name, u.entreprise) AS entName, e.global_code AS entGlobal
       FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const r = rows && rows[0];
  return { entId: (r && r.entId) ?? null, entName: (r && r.entName) || null, entGlobal: (r && r.entGlobal) ?? null };
}

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

    const { entGlobal } = await getEntrepriseContext(userId);
    const [result] = await pool.execute(
      `INSERT INTO stock_depenses (user_id, date, libelle, montant, destinataire, global_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, date, label, amount, dest, entGlobal]
    );

    res.status(201).json({
      id: result.insertId,
      date,
      libelle: label,
      montant: amount,
      destinataire: dest
    });

    // Best-effort remote replication
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          // Ensure user exists remotely (FK)
          const [ru] = await rconn.execute('SELECT id FROM users WHERE id = ?', [userId]);
          if (ru.length === 0) {
            const [lu] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
            const u = lu && lu[0];
            if (u) {
              const [ruByEmail] = await rconn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
              if (ruByEmail.length === 0) {
                await rconn.execute(
                  'INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?) ',
                  [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
                );
              }
            }
          }
          await rconn.execute(
            `INSERT INTO stock_depenses (id, user_id, date, libelle, montant, destinataire, global_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE date=VALUES(date), libelle=VALUES(libelle), montant=VALUES(montant), destinataire=VALUES(destinataire), global_id=VALUES(global_id)`,
            [result.insertId, userId, date, label, amount, dest, entGlobal]
          );
        } catch (e) {
          console.warn('Remote push (depense create) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    console.error('Erreur POST dépense:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la création de la dépense' });
  }
});

module.exports = router;
// PATCH /api/stockDepenses/:id — mettre à jour une dépense
router.patch('/:id', authenticateToken, async (req, res) => {
  let conn;
  try {
    const userId = req.user.id;
  const { entId, entName, entGlobal } = await getEntrepriseContext(userId);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    const updates = {};
    if (req.body.date !== undefined) {
      const date = String(req.body.date || '');
      if (!/\d{4}-\d{2}-\d{2}/.test(date)) return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD)' });
      updates.date = date;
    }
    if (req.body.libelle !== undefined) {
      const label = String(req.body.libelle || '').trim();
      if (!label) return res.status(400).json({ error: 'Libellé requis' });
      updates.libelle = label;
    }
    if (req.body.montant !== undefined) {
      const amount = Number(req.body.montant);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Montant doit être un nombre >= 0' });
      updates.montant = amount;
    }
    if (req.body.destinataire !== undefined) {
      const dest = String(req.body.destinataire || '').trim();
      updates.destinataire = dest || null;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [exists] = await conn.execute(
      `SELECT sd.id, sd.user_id
         FROM stock_depenses sd
        WHERE sd.id = ?
          AND (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))`,
      [id, entGlobal, entGlobal, entName || '']
    );
    if (exists.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Dépense introuvable' });
    }
    if (exists[0].user_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const setParts = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      setParts.push(`${k} = ?`);
      values.push(v);
    }
  values.push(id, userId);
  await conn.execute(`UPDATE stock_depenses SET ${setParts.join(', ')} WHERE id = ? AND user_id = ?`, values);

  const [rows] = await conn.execute(
      `SELECT sd.id, sd.user_id, strftime('%Y-%m-%d', sd.date) AS date, sd.libelle, sd.montant, sd.destinataire
         FROM stock_depenses sd
        WHERE sd.id = ?
          AND (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))`,
      [id, entGlobal, entGlobal, entName || '']
    );
    const updated = rows[0];

    await conn.commit();

    res.json(updated);

    // Best-effort remote replication
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.execute(
            `INSERT INTO stock_depenses (id, user_id, date, libelle, montant, destinataire)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE date=VALUES(date), libelle=VALUES(libelle), montant=VALUES(montant), destinataire=VALUES(destinataire)`,
            [updated.id, userId, updated.date, updated.libelle, Number(updated.montant), updated.destinataire || null]
          );
        } catch (e) {
          console.warn('Remote push (depense update) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Erreur PATCH dépense:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la dépense' });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/stockDepenses/:id — supprimer une dépense
router.delete('/:id', authenticateToken, async (req, res) => {
  let conn;
  try {
    const userId = req.user.id;
  const { entId, entName, entGlobal } = await getEntrepriseContext(userId);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID invalide' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [exists] = await conn.execute(
      `SELECT sd.id, sd.user_id
         FROM stock_depenses sd
        WHERE sd.id = ?
          AND (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))`,
      [id, entGlobal, entGlobal, entName || '']
    );
    if (exists.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Dépense introuvable' });
    }
    if (exists[0].user_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: 'Accès refusé' });
    }
    await conn.execute('DELETE FROM stock_depenses WHERE id = ? AND user_id = ?', [id, userId]);
    await conn.commit();

    res.json({ success: true });

    // Best-effort remote replication
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.execute('DELETE FROM stock_depenses WHERE id = ? AND user_id = ?', [id, userId]);
        } catch (e) {
          console.warn('Remote push (depense delete) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Erreur DELETE dépense:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la suppression de la dépense' });
  } finally {
    if (conn) conn.release();
  }
});