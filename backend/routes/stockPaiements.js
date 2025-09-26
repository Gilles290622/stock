const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

function normalizeId(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function validatePayment(body) {
  const movId = normalizeId(body.mouvement_id);
  if (movId == null) throw new Error('mouvement_id invalide');

  const isoDate = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Format de date invalide (YYYY-MM-DD)');
  }

  const amt = Number(body.montant);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('Montant doit être un nombre > 0');
  }
  const amount = Math.round(amt * 100) / 100;

  return { movId, isoDate, amount };
}

// GET /api/stockPaiements?mouvement_id=123
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const mouvementId = normalizeId(req.query.mouvement_id);
    if (mouvementId == null) {
      return res.status(400).json({ error: 'Paramètre mouvement_id requis' });
    }

    const [movRows] = await pool.query(
      `SELECT id FROM stock_mouvements WHERE id = ? AND user_id = ?`,
      [mouvementId, userId]
    );
    if (movRows.length === 0) {
      return res.json([]);
    }

    const [rows] = await pool.query(
      `SELECT
         sp.id,
         sp.mouvement_id,
         sp.user_id,
         strftime('%Y-%m-%d', sp.date) AS date,
         sp.montant,
         sp.created_at
       FROM stock_paiements sp
       WHERE sp.mouvement_id = ?
       ORDER BY sp.date ASC, sp.id ASC`,
      [mouvementId]
    );

    res.json(rows.map(r => ({
      ...r,
      montant: Number(r.montant),
      user_name: ''
    })));
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ error: "Table 'stock_paiements' introuvable. Exécutez la migration SQL." });
    }
    console.error('Erreur GET /stockPaiements:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la récupération des paiements' });
  }
});

// POST /api/stockPaiements
router.post('/', authenticateToken, async (req, res) => {
  let conn;
  try {
    const userId = req.user.id;
    const { movId, isoDate, amount } = validatePayment(req.body);

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [movRows] = await conn.query(
      `SELECT id, montant
         FROM stock_mouvements
        WHERE id = ? AND user_id = ?`,
      [movId, userId]
    );
    if (movRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Mouvement introuvable' });
    }
    const mouvementMontant = Number(movRows[0].montant) || 0;

    const [[sumRow]] = await conn.query(
      `SELECT COALESCE(SUM(montant), 0) AS total
         FROM stock_paiements
        WHERE mouvement_id = ?`,
      [movId]
    );
    const dejaPaye = Number(sumRow.total) || 0;

    if (dejaPaye + amount - mouvementMontant > 0.000001) {
      await conn.rollback();
      return res.status(400).json({ error: 'Le montant dépasse le reste à payer' });
    }

    const [ins] = await conn.execute(
      `INSERT INTO stock_paiements (mouvement_id, user_id, montant, \`date\`)
       VALUES (?, ?, ?, ?)`,
      [movId, userId, amount, isoDate]
    );

    await conn.commit();

    const totalPaye = dejaPaye + amount;
    const reste = Math.max(mouvementMontant - totalPaye, 0);

    res.status(201).json({
      id: ins.insertId,
      mouvement_id: movId,
      user_id: userId,
      date: isoDate,
      montant: amount,
      total_paye: totalPaye,
      reste_a_payer: reste
    });

    // Best-effort remote replication of payment creation
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.beginTransaction();
          // Ensure mouvement exists remotely minimally
          const [rm] = await rconn.execute('SELECT id FROM stock_mouvements WHERE id = ? AND user_id = ?', [movId, userId]);
          if (rm.length === 0) {
            // Try shallow insert with minimal fields from local
            const [lm] = await pool.query(
              `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
               FROM stock_mouvements WHERE id = ? AND user_id = ?`, [movId, userId]
            );
            const m = lm && lm[0];
            if (m) {
              await rconn.execute(
                `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE date=VALUES(date)`,
                [m.id, m.user_id, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
              );
            }
          }
          await rconn.execute(
            `INSERT INTO stock_paiements (id, mouvement_id, user_id, montant, date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE montant=VALUES(montant), date=VALUES(date)`,
            [ins.insertId, movId, userId, amount, isoDate]
          );
          await rconn.commit();
        } catch (e) {
          if (rconn) try { await rconn.rollback(); } catch {}
          console.warn('Remote push (paiement create) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    const msg = String(err?.message || '');
    if (
      msg.includes('mouvement_id invalide') ||
      msg.includes('Format de date invalide') ||
      msg.includes('Montant doit être') ||
      msg.includes('dépasse le reste')
    ) {
      return res.status(400).json({ error: msg });
    }
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ error: "Table 'stock_paiements' introuvable. Exécutez la migration SQL." });
    }
    console.error('Erreur POST /stockPaiements:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH /api/stockPaiements/:id  { date, montant }
router.patch('/:id', authenticateToken, async (req, res) => {
  let conn;
  try {
    const userId = req.user.id;
    const id = normalizeId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'ID invalide' });

    const isoDate = String(req.body.date || '');
    if (isoDate && !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD)' });
    }
    const hasAmount = req.body.montant !== undefined && req.body.montant !== null && String(req.body.montant) !== '';
    const amount = hasAmount ? Math.round(Number(req.body.montant) * 100) / 100 : undefined;
    if (hasAmount && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ error: 'Montant doit être un nombre > 0' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Verrouiller le paiement + mouvement et vérifier appartenance
    const [payRows] = await conn.query(
      `SELECT sp.id, sp.mouvement_id, sp.montant, strftime('%Y-%m-%d', sp.date) AS date,
              sm.montant AS mouvement_montant, sm.user_id
         FROM stock_paiements sp
         JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
        WHERE sp.id = ?`,
      [id]
    );
    if (payRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Paiement introuvable' });
    }
    const row = payRows[0];
    if (row.user_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const movId = row.mouvement_id;
    const mouvementMontant = Number(row.mouvement_montant) || 0;

    // Somme des autres paiements
    const [[sumRow]] = await conn.query(
      `SELECT COALESCE(SUM(montant), 0) AS total
         FROM stock_paiements
        WHERE mouvement_id = ? AND id <> ?`,
      [movId, id]
    );
    const totalAutres = Number(sumRow.total) || 0;

    const newAmount = hasAmount ? amount : Number(row.montant) || 0;
    if (totalAutres + newAmount - mouvementMontant > 0.000001) {
      await conn.rollback();
      return res.status(400).json({ error: 'Le montant dépasse le reste à payer' });
    }

    const newDate = isoDate || row.date;

    await conn.execute(
      `UPDATE stock_paiements
          SET \`date\` = ?, montant = ?
        WHERE id = ?`,
      [newDate, newAmount, id]
    );

    await conn.commit();

    res.json({
      id,
      mouvement_id: movId,
      date: newDate,
      montant: newAmount,
      total_paye: totalAutres + newAmount,
      reste_a_payer: Math.max(mouvementMontant - (totalAutres + newAmount), 0)
    });

    // Best-effort remote replication of payment update
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.execute(
            `INSERT INTO stock_paiements (id, mouvement_id, user_id, montant, date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE montant=VALUES(montant), date=VALUES(date)`,
            [id, movId, userId, newAmount, newDate]
          );
        } catch (e) {
          console.warn('Remote push (paiement update) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Erreur PATCH /stockPaiements/:id:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la mise à jour du paiement' });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/stockPaiements/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  let conn;
  try {
    const userId = req.user.id;
    const id = normalizeId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'ID invalide' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Récupérer paiement + mouvement et vérifier appartenance
    const [payRows] = await conn.query(
      `SELECT sp.id, sp.mouvement_id, sp.montant, sm.montant AS mouvement_montant, sm.user_id
         FROM stock_paiements sp
         JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
        WHERE sp.id = ?`,
      [id]
    );
    if (payRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Paiement introuvable' });
    }
    const row = payRows[0];
    if (row.user_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Supprimer
    await conn.execute(`DELETE FROM stock_paiements WHERE id = ?`, [id]);

    // Recalcul du total payé
    const [[sumRow]] = await conn.query(
      `SELECT COALESCE(SUM(montant), 0) AS total
         FROM stock_paiements
        WHERE mouvement_id = ?`,
      [row.mouvement_id]
    );
    const totalPaye = Number(sumRow.total) || 0;
    const reste = Math.max(Number(row.mouvement_montant) - totalPaye, 0);

    await conn.commit();

    res.json({
      success: true,
      mouvement_id: row.mouvement_id,
      total_paye: totalPaye,
      reste_a_payer: reste
    });

    // Best-effort remote replication of payment delete
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.execute('DELETE FROM stock_paiements WHERE id = ? AND mouvement_id = ? AND user_id = ?', [id, row.mouvement_id, userId]);
        } catch (e) {
          console.warn('Remote push (paiement delete) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Erreur DELETE /stockPaiements/:id:', err && (err.stack || err));
    res.status(500).json({ error: 'Erreur lors de la suppression du paiement' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;