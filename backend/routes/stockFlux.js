const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/stockFlux?date=YYYY-MM-DD
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const dateJour = req.query.date || new Date().toISOString().slice(0, 10);

    // On récupère le flux complet pour l'utilisateur
      const [rows] = await pool.query(
      `
      SELECT
        *,
        CASE
          WHEN kind = 'paiement' AND type = 'sortie' THEN montant
          WHEN kind = 'achat' THEN -montant
          WHEN kind = 'depense' THEN -montant
          ELSE 0
        END AS balance,
        SUM(
          CASE
            WHEN kind = 'paiement' AND type = 'sortie' THEN montant
            WHEN kind = 'achat' THEN -montant
            WHEN kind = 'depense' THEN -montant
            ELSE 0
          END
        ) OVER (ORDER BY created_at ASC, id ASC) AS solde
      FROM (
        -- Mouvements DU JOUR
        SELECT
          'mouvement' AS kind,
          sm.id AS id,
          sm.created_at AS created_at,
          DATE_FORMAT(sm.\`date\`, '%Y-%m-%d') AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name COLLATE utf8mb4_unicode_ci, 'N/A') AS designation_name,
          sm.quantite AS quantite,
          sm.prix AS prix,
          sm.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          sm.stock AS stock,
          sm.stockR AS stockR,
          NULL AS mouvement_id
        FROM stock_mouvements sm
        LEFT JOIN stock_designations d
          ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c
          ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE sm.user_id = ?
          AND DATE(sm.\`date\`) = ?

        UNION ALL

        -- Paiements DU JOUR
        SELECT
          CASE WHEN sm.type = 'entree' THEN 'achat' ELSE 'paiement' END AS kind,
          sp.id AS id,
          sp.created_at AS created_at,
          DATE_FORMAT(sp.\`date\`, '%Y-%m-%d') AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name COLLATE utf8mb4_unicode_ci, 'N/A') AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sp.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          sp.mouvement_id AS mouvement_id
        FROM stock_paiements sp
        JOIN stock_mouvements sm
          ON sm.id = sp.mouvement_id AND sm.user_id = ?
        LEFT JOIN stock_designations d
          ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c
          ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE DATE(sp.\`date\`) = ?

        UNION ALL

        -- Dépenses DU JOUR
        SELECT
          'depense' AS kind,
          sd.id AS id,
          sd.created_at AS created_at,
          DATE_FORMAT(sd.\`date\`, '%Y-%m-%d') AS date,
          'depense' AS type,
          NULL AS designation_id,
          sd.libelle COLLATE utf8mb4_unicode_ci AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sd.montant AS montant,
          NULL AS client_id,
          COALESCE(sd.destinataire COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          NULL AS mouvement_id
        FROM stock_depenses sd
        WHERE sd.user_id = ? AND DATE(sd.\`date\`) = ?
      ) AS t
      ORDER BY date DESC, created_at DESC, id DESC
      `,
      [userId, dateJour, userId, dateJour, userId, dateJour]
    );

    // Construction du résumé point caisse pour la date demandée
    const achats = rows.filter(row => row.kind === "achat" && row.date === dateJour);
    const depenses = rows.filter(row => row.kind === "depense" && row.date === dateJour);
    const encaissementsDuJour = rows.filter(row => row.kind === "paiement" && row.date === dateJour);
    const recouvrements = rows.filter(row => row.kind === "paiement" && row.date !== dateJour);

    const totalAchats = achats.reduce((sum, r) => sum + Math.abs(Number(r.montant)), 0);
    const totalDepenses = depenses.reduce((sum, r) => sum + Math.abs(Number(r.montant)), 0);
    const totalEncaissements = encaissementsDuJour.reduce((sum, r) => sum + Number(r.montant), 0);
    const totalRecouvrements = recouvrements.reduce((sum, r) => sum + Number(r.montant), 0);

    const totalEntrees = totalEncaissements + totalRecouvrements;
    const totalSorties = totalAchats + totalDepenses;
    const soldeCloture = totalEntrees - totalSorties;

    res.json({
      flux: rows, // pour affichage principal ou autres usages
      pointCaisse: {
        date: dateJour,
        achats,
        depenses,
        encaissementsDuJour,
        recouvrements,
        totalAchats,
        totalDepenses,
        totalEncaissements,
        totalRecouvrements,
        totalEntrees,
        totalSorties,
        soldeCloture,
      }
    });
  } catch (err) {
    console.error('Erreur GET /api/stockFlux:', err && (err.stack || err.message || err));
    res.status(500).json({ error: 'Erreur lors de la récupération du flux', details: err.message || err });
  }
});


// Nouvelle route pour la recherche textuelle
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const rawQuery = (req.query.searchQuery || "").trim().slice(0, 100);
    const isDate = /^\d{2}\/\d{2}\/\d{4}$/.test(rawQuery.trim());
    let dateJour = null;
    let searchQuery = '%%';
    let dateQuery = '1970-01-01';
    if (isDate) {
      const [d, m, y] = rawQuery.split("/");
      dateJour = `${y}-${m}-${d}`;
      const date = new Date(dateJour);
      if (isNaN(date.getTime()) || date.getFullYear() != y || date.getMonth() + 1 != m || date.getDate() != d) {
        return res.status(400).json({ error: "Format de date invalide" });
      }
      dateQuery = dateJour;
    } else if (rawQuery) {
      searchQuery = `%${rawQuery}%`;
    } else {
      return res.status(400).json({ error: "searchQuery requis" });
    }

    const queryParams = [
      // Mouvements
      userId, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
      // Paiements
      userId, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
      // Dépenses
      userId, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery
    ];

    const [rows] = await pool.query(
      `
      SELECT
        *,
        CASE
          WHEN kind = 'paiement' AND type = 'sortie' THEN montant
          WHEN kind = 'achat' THEN -montant
          WHEN kind = 'depense' THEN -montant
          ELSE 0
        END AS balance,
        SUM(
          CASE
            WHEN kind = 'paiement' AND type = 'sortie' THEN montant
            WHEN kind = 'achat' THEN -montant
            WHEN kind = 'depense' THEN -montant
            ELSE 0
          END
        ) OVER (ORDER BY created_at ASC, id ASC) AS solde
      FROM (
        -- Mouvements
        SELECT
          'mouvement' AS kind,
          sm.id AS id,
          sm.created_at AS created_at,
          DATE_FORMAT(sm.\`date\`, '%Y-%m-%d') AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name COLLATE utf8mb4_unicode_ci, 'N/A') AS designation_name,
          sm.quantite AS quantite,
          sm.prix AS prix,
          sm.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          sm.stock AS stock,
          sm.stockR AS stockR,
          NULL AS mouvement_id
        FROM stock_mouvements sm
        LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE sm.user_id = ?
          AND (d.name LIKE ? OR c.name LIKE ? OR ? = '%%')
          AND (DATE(sm.\`date\`) = ? OR ? = '1970-01-01')

        UNION ALL

        -- Paiements
        SELECT
          CASE WHEN sm.type = 'entree' THEN 'achat' ELSE 'paiement' END AS kind,
          sp.id AS id,
          sp.created_at AS created_at,
          DATE_FORMAT(sp.\`date\`, '%Y-%m-%d') AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name COLLATE utf8mb4_unicode_ci, 'N/A') AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sp.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          sp.mouvement_id AS mouvement_id
        FROM stock_paiements sp
        JOIN stock_mouvements sm ON sm.id = sp.mouvement_id AND sm.user_id = sm.user_id
        LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE sm.user_id = ?
          AND (d.name LIKE ? OR c.name LIKE ? OR ? = '%%')
          AND (DATE(sp.\`date\`) = ? OR ? = '1970-01-01')

        UNION ALL

        -- Dépenses
        SELECT
          'depense' AS kind,
          sd.id AS id,
          sd.created_at AS created_at,
          DATE_FORMAT(sd.\`date\`, '%Y-%m-%d') AS date,
          'depense' AS type,
          NULL AS designation_id,
          sd.libelle COLLATE utf8mb4_unicode_ci AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sd.montant AS montant,
          NULL AS client_id,
          COALESCE(sd.destinataire COLLATE utf8mb4_unicode_ci, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          NULL AS mouvement_id
        FROM stock_depenses sd
        WHERE sd.user_id = ?
          AND (sd.libelle LIKE ? OR sd.destinataire LIKE ? OR ? = '%%')
          AND (DATE(sd.\`date\`) = ? OR ? = '1970-01-01')
      ) AS t
      ORDER BY date DESC, created_at DESC, id DESC
      `,
      queryParams
    );

    res.json({ flux: rows });
  } catch (err) {
    console.error('Erreur GET /api/stockFlux/search:', err && (err.stack || err.message || err));
    res.status(500).json({ error: 'Erreur lors de la recherche', details: err.message || err });
  }
});

// Edit mouvement
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { date, designation_id, quantite, prix, client_id } = req.body;
  const userId = req.user.id;

  // 1. Met à jour le mouvement
  await pool.query(
    `UPDATE stock_mouvements SET date=?, designation_id=?, quantite=?, prix=?, client_id=? WHERE id=? AND user_id=?`,
    [date, designation_id, quantite, prix, client_id, id, userId]
  );

  // 2. Recalcule tous les mouvements postérieurs (exemple pour stock)
  await pool.query(
    `CALL recalculer_stock_apres_mouvement(?, ?, ?)`, // écris cette procédure stockée selon ta logique
    [designation_id, date, userId]
  );

  res.json({ success: true });
});

// Delete mouvement
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // 1. Trouve les infos du mouvement supprimé
  const [row] = await pool.query(`SELECT designation_id, date FROM stock_mouvements WHERE id=? AND user_id=?`, [id, userId]);
  if (!row.length) return res.status(404).json({ error: 'Introuvable' });

  // 2. Supprime le mouvement
  await pool.query(`DELETE FROM stock_mouvements WHERE id=? AND user_id=?`, [id, userId]);

  // 3. Recalcule les mouvements postérieurs
  await pool.query(`CALL recalculer_stock_apres_mouvement(?, ?, ?)`, [row[0].designation_id, row[0].date, userId]);

  res.json({ success: true });
});
module.exports = router;