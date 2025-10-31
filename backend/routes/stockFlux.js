const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/stockFlux?date=YYYY-MM-DD
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Entreprise scoping: get entreprise_id and legacy name
    const [[urow]] = await pool.query(
      `SELECT u.entreprise_id AS entId, COALESCE(e.name, u.entreprise) AS entName, e.global_code AS entGlobal
         FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.id = ? LIMIT 1`, [userId]
    );
    const entId = urow ? urow.entId : null;
    const entName = urow ? (urow.entName || '') : '';
    const entGlobal = urow ? urow.entGlobal : null;
    const dateJour = req.query.date || new Date().toISOString().slice(0, 10);

    // On récupère le flux complet pour l'utilisateur
    const [rowsRaw] = await pool.query(
      `
      SELECT
        *
      FROM (
        -- Mouvements DU JOUR
        SELECT
          'mouvement' AS kind,
          sm.id AS id,
          sm.created_at AS created_at,
          strftime('%H:%M', sm.created_at) AS created_time,
          strftime('%Y-%m-%d', sm.date) AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name, 'N/A') AS designation_name,
          sm.quantite AS quantite,
          sm.prix AS prix,
          sm.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name, 'N/A') AS client_name,
          sm.stock AS stock,
          sm.stockR AS stockR,
          NULL AS mouvement_id
        FROM stock_mouvements sm
        
        LEFT JOIN stock_designations d
          ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c
          ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE (sm.global_id = ? OR (? IS NULL AND sm.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
          AND strftime('%Y-%m-%d', sm.date) = ?

        UNION ALL

        -- Paiements DU JOUR
        SELECT
          CASE WHEN sm.type = 'entree' THEN 'achat' ELSE 'paiement' END AS kind,
          sp.id AS id,
          sp.created_at AS created_at,
          strftime('%H:%M', sp.created_at) AS created_time,
          strftime('%Y-%m-%d', sp.date) AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name, 'N/A') AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sp.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          sp.mouvement_id AS mouvement_id
        FROM stock_paiements sp
        JOIN stock_mouvements sm
          ON sm.id = sp.mouvement_id
        
        LEFT JOIN stock_designations d
          ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c
          ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE (sm.global_id = ? OR (? IS NULL AND sm.user_id IN (
                 SELECT id FROM users u3 WHERE COALESCE(u3.entreprise,'') = ?
               )))
          AND strftime('%Y-%m-%d', sp.date) = ?

        UNION ALL

        -- Dépenses DU JOUR
        SELECT
          'depense' AS kind,
          sd.id AS id,
          sd.created_at AS created_at,
          strftime('%H:%M', sd.created_at) AS created_time,
          strftime('%Y-%m-%d', sd.date) AS date,
          'depense' AS type,
          NULL AS designation_id,
          sd.libelle AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sd.montant AS montant,
          NULL AS client_id,
          COALESCE(sd.destinataire, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          NULL AS mouvement_id
        FROM stock_depenses sd
        WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                 SELECT id FROM users u4 WHERE COALESCE(u4.entreprise,'') = ?
               )))
          AND strftime('%Y-%m-%d', sd.date) = ?
      ) AS t
      ORDER BY created_at ASC, id ASC
      `,
      [entGlobal, entGlobal, entName, dateJour, entGlobal, entGlobal, entName, dateJour, entGlobal, entGlobal, entName, dateJour]
    );

    // Post-traitement: calculer balance et solde cumulés côté JS
    let running = 0;
    const rowsComputed = rowsRaw.map((row) => {
      const montant = Number(row.montant) || 0;
      let balance = 0;
      if (row.kind === 'paiement' && String(row.type).toLowerCase() === 'sortie') {
        balance = montant;
      } else if (row.kind === 'achat' || row.kind === 'depense') {
        balance = -montant;
      } else {
        balance = 0;
      }
      running += balance;
      return { ...row, balance, solde: running };
    });

    // Ordre de sortie: comme avant (date DESC, created_at DESC, id DESC)
    const rows = [...rowsComputed].sort((a, b) => {
      // Compare date (YYYY-MM-DD) desc
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // created_at desc (string ISO-ish)
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      // id desc
      return (a.id || 0) < (b.id || 0) ? 1 : -1;
    });

  // Construction du résumé point caisse pour la date demandée
    const achats = rows.filter(row => row.kind === "achat" && row.date === dateJour);
    const depenses = rows.filter(row => row.kind === "depense" && row.date === dateJour);
    const encaissementsDuJour = rows.filter(row => row.kind === "paiement" && row.date === dateJour);
    const recouvrements = rows.filter(row => row.kind === "paiement" && row.date !== dateJour);
  // Nouvelle section: ventes du jour (mouvements de sorties du jour)
  const ventesDuJour = rows.filter(row => row.kind === 'mouvement' && String(row.type).toLowerCase() === 'sortie' && row.date === dateJour);

    const totalAchats = achats.reduce((sum, r) => sum + Math.abs(Number(r.montant)), 0);
    const totalDepenses = depenses.reduce((sum, r) => sum + Math.abs(Number(r.montant)), 0);
    const totalEncaissements = encaissementsDuJour.reduce((sum, r) => sum + Number(r.montant), 0);
    const totalRecouvrements = recouvrements.reduce((sum, r) => sum + Number(r.montant), 0);
  const totalVentes = ventesDuJour.reduce((sum, r) => sum + Math.abs(Number(r.montant)), 0);

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
        ventesDuJour,
        totalAchats,
        totalDepenses,
        totalEncaissements,
        totalRecouvrements,
        totalVentes,
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
    const [[urow]] = await pool.query(
      `SELECT u.entreprise_id AS entId, COALESCE(e.name, u.entreprise) AS entName, e.global_code AS entGlobal
         FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.id = ? LIMIT 1`, [userId]
    );
    const entId = urow ? urow.entId : null;
    const entName = urow ? (urow.entName || '') : '';
    const entGlobal = urow ? urow.entGlobal : null;
    const rawQuery = (req.query.searchQuery || "").trim().slice(0, 100);
    const isDate = /^\d{2}\/\d{2}\/\d{4}$/.test(rawQuery);
    let searchQuery = '%%';
    let dateQuery = '1970-01-01';
    if (isDate) {
      const [dd, mm, yyyy] = rawQuery.split('/').map((x) => Number(x));
      const y = yyyy;
      const m = String(mm).padStart(2, '0');
      const d = String(dd).padStart(2, '0');
      const dateJour = `${y}-${m}-${d}`;
      const date = new Date(dateJour);
      if (isNaN(date.getTime()) || date.getFullYear() !== y || (date.getMonth() + 1) !== Number(m) || date.getDate() !== Number(d)) {
        return res.status(400).json({ error: 'Format de date invalide' });
      }
      dateQuery = dateJour;
    } else if (rawQuery) {
      searchQuery = `%${rawQuery}%`;
    } else {
      return res.status(400).json({ error: 'searchQuery requis' });
    }

    const queryParams = [
      // Mouvements
      entGlobal, entGlobal, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
      // Paiements
      entGlobal, entGlobal, entName, entGlobal, entGlobal, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
      // Dépenses
      entGlobal, entGlobal, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery
    ];

    const [rowsRaw] = await pool.query(
      `
      SELECT
        *
      FROM (
        -- Mouvements
        SELECT
          'mouvement' AS kind,
          sm.id AS id,
          sm.created_at AS created_at,
          strftime('%H:%M', sm.created_at) AS created_time,
          strftime('%Y-%m-%d', sm.date) AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name, 'N/A') AS designation_name,
          sm.quantite AS quantite,
          sm.prix AS prix,
          sm.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name, 'N/A') AS client_name,
          sm.stock AS stock,
          sm.stockR AS stockR,
          NULL AS mouvement_id
        FROM stock_mouvements sm
        
        LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE (sm.global_id = ? OR (? IS NULL AND sm.user_id IN (
                 SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
               )))
          AND (d.name LIKE ? OR c.name LIKE ? OR ? = '%%')
          AND (strftime('%Y-%m-%d', sm.date) = ? OR ? = '1970-01-01')

        UNION ALL

        -- Paiements
        SELECT
          CASE WHEN sm.type = 'entree' THEN 'achat' ELSE 'paiement' END AS kind,
          sp.id AS id,
          sp.created_at AS created_at,
          strftime('%H:%M', sp.created_at) AS created_time,
          strftime('%Y-%m-%d', sp.date) AS date,
          sm.type AS type,
          sm.designation_id AS designation_id,
          COALESCE(d.name, 'N/A') AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sp.montant AS montant,
          sm.client_id AS client_id,
          COALESCE(c.name, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          sp.mouvement_id AS mouvement_id
        FROM stock_paiements sp
        JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
        
        LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
        LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
        WHERE (sm.global_id = ? OR (? IS NULL AND sm.user_id IN (
                 SELECT id FROM users u3 WHERE COALESCE(u3.entreprise,'') = ?
               )))
          AND (d.name LIKE ? OR c.name LIKE ? OR ? = '%%')
          AND (strftime('%Y-%m-%d', sp.date) = ? OR ? = '1970-01-01')

        UNION ALL

        -- Dépenses
        SELECT
          'depense' AS kind,
          sd.id AS id,
          sd.created_at AS created_at,
          strftime('%H:%M', sd.created_at) AS created_time,
          strftime('%Y-%m-%d', sd.date) AS date,
          'depense' AS type,
          NULL AS designation_id,
          sd.libelle AS designation_name,
          NULL AS quantite,
          NULL AS prix,
          sd.montant AS montant,
          NULL AS client_id,
          COALESCE(sd.destinataire, 'N/A') AS client_name,
          NULL AS stock,
          NULL AS stockR,
          NULL AS mouvement_id
        FROM stock_depenses sd
        WHERE (sd.global_id = ? OR (? IS NULL AND sd.user_id IN (
                 SELECT id FROM users u4 WHERE COALESCE(u4.entreprise,'') = ?
               )))
          AND (sd.libelle LIKE ? OR sd.destinataire LIKE ? OR ? = '%%')
          AND (strftime('%Y-%m-%d', sd.date) = ? OR ? = '1970-01-01')
      ) AS t
      ORDER BY created_at ASC, id ASC
      `,
      [
        // Mouvements
        entId, entId, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
        // Paiements
        entId, entId, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery,
        // Dépenses
        entId, entId, entName, searchQuery, searchQuery, searchQuery, dateQuery, dateQuery
      ]
    );

    // Post-traitement: calcul JS du solde cumulé
    let running = 0;
    const rowsComputed = rowsRaw.map((row) => {
      const montant = Number(row.montant) || 0;
      let balance = 0;
      if (row.kind === 'paiement' && String(row.type).toLowerCase() === 'sortie') {
        balance = montant;
      } else if (row.kind === 'achat' || row.kind === 'depense') {
        balance = -montant;
      } else {
        balance = 0;
      }
      running += balance;
      return { ...row, balance, solde: running };
    });

    const rows = [...rowsComputed].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return (a.id || 0) < (b.id || 0) ? 1 : -1;
    });

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

  // 2. (SQLite) Recalcul du stock à implémenter côté application si nécessaire
  // TODO: recalculer le stock si votre logique l'exige

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

  // 3. (SQLite) Recalcul du stock à implémenter côté application si nécessaire
  // TODO: recalculer le stock si votre logique l'exige

  res.json({ success: true });
});
module.exports = router;