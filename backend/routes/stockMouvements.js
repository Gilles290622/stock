const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const remotePool = require('../config/remoteDb');
const { logReplicationError } = require('../utils/replicationLog');

// Normalise le type en 'entree' ou 'sortie' (tolère variantes)
function normalizeType(raw) {
  if (raw == null) return null;
  let t = String(raw).trim().toLowerCase();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const entreeKeys = ['entree', 'enter', 'in', 'entry', 'e', 'achat', 'ajout', 'add', '+'];
  const sortieKeys = ['sortie', 'out', 'exit', 's', 'vente', 'retire', 'remove', '-'];
  if (entreeKeys.includes(t) || /^en/.test(t) || /^in/.test(t)) return 'entree';
  if (sortieKeys.includes(t) || /^so/.test(t) || /^out/.test(t) || /^ex/.test(t)) return 'sortie';
  return null;
}

// Normalise un ID venant du client: "", null, undefined -> null, sinon entier
function normalizeId(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Validation (POST): désignation OBLIGATOIRE (id ou name), client OBLIGATOIRE (id ou name)
function validateMovement(body) {
  const {
    date,
    type,
    designation_id,
    designation_name,
    quantite,
    prix,
    client_id,
    client_name,
  } = body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error('Format de date invalide (YYYY-MM-DD)');
  }

  const typeNorm = normalizeType(type);
  if (!typeNorm) {
    throw new Error('Type invalide (entree|sortie)');
  }

  if (quantite == null || Number(quantite) <= 0) {
    throw new Error('Quantité doit être positive');
  }
  if (prix == null || Number(prix) < 0) {
    throw new Error('Prix non négatif requis');
  }

  const hasDesId = designation_id !== null && designation_id !== undefined && String(designation_id) !== '';
  const hasDesName = typeof designation_name === 'string' && designation_name.trim() !== '';
  if (!hasDesId && !hasDesName) {
    throw new Error('Désignation manquante (fournir id ou name)');
  }

  const hasCliId = client_id !== null && client_id !== undefined && String(client_id).trim() !== '';
  const hasCliName = typeof client_name === 'string' && client_name.trim() !== '';
  if (!hasCliId && !hasCliName) {
    throw new Error('Client obligatoire (id ou name)');
  }

  return { typeNorm };
}

// Helpers "find or create" (dans la même transaction)
async function getOrCreateDesignation(conn, userId, designation_id, designation_name) {
  const idNorm = normalizeId(designation_id);
  if (idNorm != null) {
    const [rows] = await conn.query(
      `SELECT id, current_stock
         FROM stock_designations
        WHERE id = ? AND user_id = ?`,
      [idNorm, userId]
    );
    if (rows.length > 0) return { id: rows[0].id, current_stock: Number(rows[0].current_stock ?? 0) };
  }

  const name = (designation_name || '').trim();
  if (!name) throw new Error('Désignation introuvable pour cet utilisateur');

  let [byName] = await conn.query(
    `SELECT id, current_stock
       FROM stock_designations
      WHERE user_id = ? AND LOWER(name) = LOWER(?)`,
    [userId, name]
  );
  if (byName.length > 0) {
    return { id: byName[0].id, current_stock: Number(byName[0].current_stock ?? 0) };
  }

  try {
    // Resolve entreprise global_code for this user
    const [[ctx]] = await conn.query(
      `SELECT e.global_code AS entGlobal
         FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.id = ? LIMIT 1`,
      [userId]
    );
    const entGlobal = ctx ? ctx.entGlobal : null;
    const [ins] = await conn.execute(
      `INSERT INTO stock_designations (name, user_id, current_stock, global_id)
       VALUES (?, ?, 0, ?)`,
      [name, userId, entGlobal]
    );
    return { id: ins.insertId, current_stock: 0 };
  } catch (e) {
    // Gestion des erreurs de contrainte pour différentes bases de données
    const msg = String(e?.message || e?.code || '');
    if (
      msg.includes('UNIQUE') ||
      msg.includes('constraint') ||
      msg.includes('SQLITE_CONSTRAINT') ||
      msg.includes('Duplicate entry')
    ) {
      const [retry] = await conn.query(
        `SELECT id, current_stock FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?)`,
        [userId, name]
      );
      if (retry.length > 0) {
        return { id: retry[0].id, current_stock: Number(retry[0].current_stock ?? 0) };
      }
    }
    throw e;
  }
}

async function getOrCreateClient(conn, userId, client_id, client_name) {
  const idNorm = normalizeId(client_id);
  if (idNorm != null) {
    const [rows] = await conn.query(
      `SELECT id
         FROM stock_clients
        WHERE id = ? AND user_id = ?`,
      [idNorm, userId]
    );
    if (rows.length > 0) return rows[0].id;
  }

  const name = (client_name || '').trim();
  if (!name) return null;

  let [byName] = await conn.query(
    `SELECT id
       FROM stock_clients
      WHERE user_id = ? AND LOWER(name) = LOWER(?)`,
    [userId, name]
  );
  if (byName.length > 0) return byName[0].id;

  try {
    // Resolve entreprise global_code for this user
    const [[ctx]] = await conn.query(
      `SELECT e.global_code AS entGlobal
         FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.id = ? LIMIT 1`,
      [userId]
    );
    const entGlobal = ctx ? ctx.entGlobal : null;
    const [ins] = await conn.execute(
      `INSERT INTO stock_clients (name, user_id, global_id)
       VALUES (?, ?, ?)`,
      [name, userId, entGlobal]
    );
    return ins.insertId;
  } catch (e) {
    const msg = String(e?.message || e?.code || '');
    if (
      msg.includes('UNIQUE') ||
      msg.includes('constraint') ||
      msg.includes('SQLITE_CONSTRAINT') ||
      msg.includes('Duplicate entry')
    ) {
      const [retry] = await conn.query(
        `SELECT id FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?)`,
        [userId, name]
      );
      if (retry.length > 0) return retry[0].id;
    }
    throw e;
  }
}

// GET /api/stockMouvements — liste avec noms liés
router.get('/', authenticateToken, async (req, res) => {
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

    const [rows] = await pool.query(
      `
      SELECT
        sm.id,
        sm.user_id,
        strftime('%Y-%m-%d', sm.date) AS date,
        sm.type,
        sm.designation_id,
        sm.stock,
        sm.quantite,
        sm.prix,
        sm.client_id,
        sm.montant,
        sm.stockR,
        COALESCE(d.name, 'N/A') AS designation_name,
        COALESCE(c.name, 'N/A') AS client_name
      FROM stock_mouvements sm
      
      LEFT JOIN stock_designations d
        ON d.id = sm.designation_id
       AND d.user_id = sm.user_id
      LEFT JOIN stock_clients c
        ON c.id = sm.client_id
       AND c.user_id = sm.user_id
      WHERE (sm.global_id = ? OR (? IS NULL AND sm.user_id IN (
               SELECT id FROM users u2 WHERE COALESCE(u2.entreprise,'') = ?
             )))
      ORDER BY sm.date DESC, sm.id DESC
      `,
      [entGlobal, entGlobal, entName]
    );

    res.json(rows);
  } catch (err) {
    console.error('Erreur GET mouvements:', err.stack || err);
    res.status(500).json({
      error: 'Erreur lors de la récupération des mouvements',
      details: err.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// POST /api/stockMouvements — entree ajoute, sortie retranche (client OBLIGATOIRE)
router.post('/', authenticateToken, async (req, res) => {
  console.log('Requête POST reçue pour stockMouvements:', req.body);
  let conn;
  try {
    const userId = req.user.id;
    console.log('Utilisateur authentifié:', req.user);

    // Vérifie que l'utilisateur existe
    const [userRows] = await pool.query(`SELECT id FROM users WHERE id = ?`, [userId]);
    if (!Array.isArray(userRows) || userRows.length === 0) {
      return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.' });
    }

    const payload = {
      ...req.body,
      designation_id: normalizeId(req.body.designation_id),
      client_id: normalizeId(req.body.client_id),
    };
    const { typeNorm } = validateMovement(payload);

    const {
      date,
      designation_id,
      designation_name,
      quantite,
      prix,
      client_id,
      client_name,
    } = payload;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const des = await getOrCreateDesignation(conn, userId, designation_id, designation_name);
    const cliId = await getOrCreateClient(conn, userId, client_id, client_name);
    if (cliId == null) {
      throw new Error('Client obligatoire (id ou name)');
    }

    const currentStock = Number(des.current_stock ?? 0);
    const qty = Math.trunc(Number(quantite));
    const unitPrice = Math.trunc(Number(prix));
    const delta = typeNorm === 'entree' ? qty : -qty;

    const stock = Math.trunc(currentStock);
    const newCurrent = currentStock + delta;
    const stockR = Math.trunc(newCurrent);

    // Empêcher un stock négatif lors d'une sortie
    if (typeNorm === 'sortie' && newCurrent < 0) {
      throw new Error('Stock insuffisant');
    }

    // Resolve global_id for this user's entreprise
    const [[ctx]] = await conn.query(`SELECT e.global_code AS entGlobal FROM users u LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id WHERE u.id = ?`, [userId]);
    const entGlobal = ctx ? ctx.entGlobal : null;
    const [result] = await conn.execute(
      `INSERT INTO stock_mouvements
      (date, type, designation_id, quantite, prix, client_id, stock, stockR, user_id, global_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, typeNorm, des.id, qty, unitPrice, cliId, stock, stockR, userId, entGlobal]
    );

    await conn.execute(
      `UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?`,
      [newCurrent, des.id, userId]
    );

    await conn.commit();
    const newId = result?.insertId ?? result?.lastID ?? result?.lastInsertRowid ?? result?.lastInsertId;

    // Remote replication (optional synchronous if waitRemote=1 query param)
    let remoteInfo = null;
    if (remotePool) {
      const waitRemote = req.query.waitRemote === '1';
      const replicate = async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.beginTransaction();
          const [localUserRows] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
            const u = localUserRows && localUserRows[0];
            if (u) {
              const [ruById] = await rconn.execute('SELECT id FROM users WHERE id = ?', [u.id]);
              if (ruById.length === 0) {
                const [ruByEmail] = await rconn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
                if (ruByEmail.length === 0) {
                  await rconn.execute(
                    'INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)',
                    [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
                  );
                }
              }
            }
          if (cliId) {
            const [lc] = await pool.query('SELECT id, name FROM stock_clients WHERE id = ? AND user_id = ?', [cliId, userId]);
            const lcRow = lc && lc[0];
            if (lcRow) {
              await rconn.execute(
                `INSERT INTO stock_clients (id, user_id, name)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name)`,
                [lcRow.id, userId, lcRow.name]
              );
            }
          }
          if (des?.id) {
            const [ld] = await pool.query('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [des.id, userId]);
            const ldRow = ld && ld[0];
            if (ldRow) {
              await rconn.execute(
                `INSERT INTO stock_designations (id, user_id, name, current_stock)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
                [ldRow.id, userId, ldRow.name, Number(ldRow.current_stock || 0)]
              );
            }
          }
          await rconn.execute(
            `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR, global_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               date=VALUES(date), type=VALUES(type), designation_id=VALUES(designation_id),
               quantite=VALUES(quantite), prix=VALUES(prix), client_id=VALUES(client_id),
               stock=VALUES(stock), stockR=VALUES(stockR), global_id=VALUES(global_id)`,
            [newId, userId, date, typeNorm, des.id, qty, unitPrice, cliId, stock, stockR, entGlobal]
          );
          await rconn.commit();
          remoteInfo = { success: true };
        } catch (e) {
          if (rconn) try { await rconn.rollback(); } catch {}
          logReplicationError('mouvement.insert', e, { mouvement_id: newId, user_id: userId });
          remoteInfo = { success: false, error: e?.message || String(e) };
        } finally {
          if (rconn) rconn.release();
        }
      };
      if (waitRemote) {
        await replicate();
      } else {
        replicate(); // fire and forget
      }
    }

    res.status(201).json({
      id: newId,
      type: typeNorm,
      designation_id: des.id,
      client_id: cliId,
      stock,
      stockR,
      current_stock: newCurrent,
      remote: remoteInfo,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    const msg = String(err?.message || '');
    if (
      msg.startsWith('Format de date invalide') ||
      msg.includes('Type invalide') ||
      msg.includes('Quantité') ||
      msg.includes('Prix') ||
      msg.includes('Désignation manquante') ||
      msg.includes('Désignation introuvable') ||
      msg.includes('Stock insuffisant') ||
      msg.includes('Client obligatoire')
    ) {
      return res.status(400).json({ error: msg });
    }
    console.error('Erreur POST mouvement:', err.stack || err);
    res.status(500).json({
      error: "Erreur lors de l'ajout du mouvement",
      details: err.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH /api/stockMouvements/:id — édition avec recalculs (client OBLIGATOIRE au final)
router.patch('/:id', authenticateToken, async (req, res) => {
  console.log('Requête PATCH reçue pour stockMouvements/:id:', req.params.id, req.body);
  let conn;
  try {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    // Normaliser champs pouvant être ""
    const designation_id = normalizeId(req.body.designation_id);
    const client_id = normalizeId(req.body.client_id);
    const designation_name = req.body.designation_name;
    const client_name = req.body.client_name;

    const date = req.body.date;
    const type = req.body.type;
    const quantite = req.body.quantite;
    const prix = req.body.prix;

    // Validations légères (optionnelles)
    let newDate = date != null ? String(date).trim() : undefined;
    if (newDate != null) {
      // Accepte JJ/MM/AAAA et convertit en ISO
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(newDate)) {
        const [d, m, y] = newDate.split('/');
        newDate = `${y}-${m}-${d}`;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD ou JJ/MM/AAAA)' });
      }
    }
    let newType = type != null ? normalizeType(type) : undefined;
    if (type != null && !newType) {
      return res.status(400).json({ error: 'Type invalide (entree|sortie)' });
    }
    let newQty = quantite != null ? Math.trunc(Number(quantite)) : undefined;
    if (quantite != null && !(Number.isFinite(newQty) && newQty > 0)) {
      return res.status(400).json({ error: 'Quantité doit être positive' });
    }
    let newPrice = prix != null ? Math.trunc(Number(prix)) : undefined;
    if (prix != null && !(Number.isFinite(newPrice) && newPrice >= 0)) {
      return res.status(400).json({ error: 'Prix non négatif requis' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lire le mouvement actuel (date formatée)
    const [rows] = await conn.query(
      `SELECT id,
              strftime('%Y-%m-%d', date) AS date,
              type, designation_id, quantite, prix, client_id
         FROM stock_mouvements
        WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Mouvement introuvable' });
    }
    const old = rows[0];
    const oldDate = old.date; // 'YYYY-MM-DD'
    const oldTypeNorm = normalizeType(old.type) || old.type;
    const oldQty = Math.trunc(Number(old.quantite));
    const oldDelta = oldTypeNorm === 'entree' ? oldQty : -oldQty;
    const oldDesId = old.designation_id;

    // Verrouille l'ancienne désignation
    const [oldDesRows] = await conn.query(
      `SELECT id, current_stock FROM stock_designations
        WHERE id = ? AND user_id = ?`,
      [oldDesId, userId]
    );
    if (!oldDesRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Désignation introuvable' });
    }
    const oldDesStockRow = oldDesRows[0];

    // Résoudre la désignation cible (si fournie)
    let targetDesId = oldDesId;
    let newDesStockRow = null;
    if (designation_id != null || (designation_name && String(designation_name).trim() !== '')) {
      const resolved = await getOrCreateDesignation(conn, userId, designation_id, designation_name);
      targetDesId = resolved.id;
      if (targetDesId !== oldDesId) {
        const [nd] = await conn.query(
          `SELECT id, current_stock FROM stock_designations
           WHERE id = ? AND user_id = ?`,
          [targetDesId, userId]
        );
        if (!nd.length) {
          await conn.rollback();
          return res.status(404).json({ error: 'Nouvelle désignation introuvable' });
        }
        newDesStockRow = nd[0];
      }
    }

    // Résoudre client (OBLIGATOIRE au final)
    let targetClientId = old.client_id;
    if (client_id != null || (client_name && String(client_name).trim() !== '')) {
      const cid = await getOrCreateClient(conn, userId, client_id, client_name);
      targetClientId = cid;
    }
    if (targetClientId == null) {
      await conn.rollback();
      return res.status(400).json({ error: 'Client obligatoire (id ou name)' });
    }

    // Valeurs finales
    const finalDate = newDate ?? oldDate; // 'YYYY-MM-DD'
    const finalType = newType ?? oldTypeNorm;
    const finalQty = newQty ?? oldQty;
    const finalPrice = newPrice ?? Math.trunc(Number(old.prix));
    const newDelta = finalType === 'entree' ? finalQty : -finalQty;
    const deltaDiffSameDes = newDelta - oldDelta;

    // 1) Retirer l'ancien impact (comme DELETE)
    await conn.execute(
      `UPDATE stock_mouvements
          SET stock = stock - ?, stockR = stockR - ?
        WHERE user_id = ? AND designation_id = ?
          AND (date > ? OR (date = ? AND id > ?))`,
      [oldDelta, oldDelta, userId, oldDesId, oldDate, oldDate, id]
    );

    // 2) Stock de base avant la nouvelle position
    const [[baseRow]] = await conn.query(
      `SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite ELSE -quantite END), 0) AS total
         FROM stock_mouvements
        WHERE user_id = ?
          AND designation_id = ?
          AND id <> ?
          AND (date < ? OR (date = ? AND id < ?))`,
      [userId, targetDesId, id, finalDate, finalDate, id]
    );
    const baseSum = Number(baseRow?.total ?? 0);
    const newStock = Math.trunc(baseSum);
    const newStockR = Math.trunc(baseSum + newDelta);

    // 3) Mettre à jour la ligne
    await conn.execute(
      `UPDATE stock_mouvements
          SET date = ?, type = ?, designation_id = ?, quantite = ?, prix = ?, client_id = ?, stock = ?, stockR = ?
        WHERE id = ? AND user_id = ?`,
      [finalDate, finalType, targetDesId, finalQty, finalPrice, targetClientId, newStock, newStockR, id, userId]
    );

    // 4) Propager le nouvel impact
    await conn.execute(
      `UPDATE stock_mouvements
          SET stock = stock + ?, stockR = stockR + ?
        WHERE user_id = ? AND designation_id = ?
          AND (date > ? OR (date = ? AND id > ?))`,
      [newDelta, newDelta, userId, targetDesId, finalDate, finalDate, id]
    );

    // 5) Mettre à jour current_stock
    if (targetDesId === oldDesId) {
      const newCurrent = Number(oldDesStockRow.current_stock ?? 0) + deltaDiffSameDes;
      await conn.execute(
        `UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?`,
        [newCurrent, oldDesId, userId]
      );
    } else {
      const newCurrentOld = Number(oldDesStockRow.current_stock ?? 0) - oldDelta;
      await conn.execute(
        `UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?`,
        [newCurrentOld, oldDesId, userId]
      );
      const currentNewDes = Number(newDesStockRow.current_stock ?? 0) + newDelta;
      await conn.execute(
        `UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?`,
        [currentNewDes, targetDesId, userId]
      );
    }

    await conn.commit();

    // Best-effort remote upsert replication after edit
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.beginTransaction();

          // Ensure user exists remotely
          const [ruById] = await rconn.execute('SELECT id FROM users WHERE id = ?', [userId]);
          if (ruById.length === 0) {
            const [localUserRows] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
            const u = localUserRows && localUserRows[0];
            if (u) {
              const [ruByEmail] = await rconn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
              if (ruByEmail.length === 0) {
                await rconn.execute(
                  'INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)',
                  [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
                );
              }
            }
          }

          // Ensure client exists remotely
          if (targetClientId != null) {
            const [lc] = await pool.query('SELECT id, name FROM stock_clients WHERE id = ? AND user_id = ?', [targetClientId, userId]);
            const lcRow = lc && lc[0];
            if (lcRow) {
              await rconn.execute(
                `INSERT INTO stock_clients (id, user_id, name)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name)`,
                [lcRow.id, userId, lcRow.name]
              );
            }
          }

          // Ensure designation(s) exist remotely and update current_stock for both old and new when needed
          if (targetDesId != null) {
            const [ld] = await pool.query('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [targetDesId, userId]);
            const ldRow = ld && ld[0];
            if (ldRow) {
              await rconn.execute(
                `INSERT INTO stock_designations (id, user_id, name, current_stock)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
                [ldRow.id, userId, ldRow.name, Number(ldRow.current_stock || 0)]
              );
            }
          }
          if (oldDesId != null && oldDesId !== targetDesId) {
            const [ldOld] = await pool.query('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [oldDesId, userId]);
            const ldOldRow = ldOld && ldOld[0];
            if (ldOldRow) {
              await rconn.execute(
                `INSERT INTO stock_designations (id, user_id, name, current_stock)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
                [ldOldRow.id, userId, ldOldRow.name, Number(ldOldRow.current_stock || 0)]
              );
            }
          }

          // Upsert mouvement by id with final values
          await rconn.execute(
            `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               date=VALUES(date), type=VALUES(type), designation_id=VALUES(designation_id),
               quantite=VALUES(quantite), prix=VALUES(prix), client_id=VALUES(client_id),
               stock=VALUES(stock), stockR=VALUES(stockR)`,
            [id, userId, finalDate, finalType, targetDesId, finalQty, finalPrice, targetClientId, newStock, newStockR]
          );

          await rconn.commit();
        } catch (e) {
          if (rconn) { try { await rconn.rollback(); } catch {}
          }
          logReplicationError('mouvement.edit', e, { mouvement_id: id, user_id: userId });
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    const msg = String(err?.message || '');
    if (
      msg.startsWith('Format de date invalide') ||
      msg.includes('Type invalide') ||
      msg.includes('Quantité') ||
      msg.includes('Prix') ||
      msg.includes('Désignation introuvable') ||
      msg.includes('Nouvelle désignation introuvable') ||
      msg.includes('Client obligatoire')
    ) {
      return res.status(400).json({ error: msg });
    }
    console.error('Erreur PATCH mouvement:', err.stack || err);
    res.status(500).json({
      error: "Erreur lors de la mise à jour du mouvement",
      details: err.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/stockMouvements/:id — supprime n'importe quelle ligne et réajuste
router.delete('/:id', authenticateToken, async (req, res) => {
  console.log('Requête DELETE reçue pour stockMouvements/:id:', req.params.id);
  let conn;
  try {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lire le mouvement
    const [movRows] = await conn.query(
      `SELECT id, designation_id, type, quantite, strftime('%Y-%m-%d', date) AS date
         FROM stock_mouvements
        WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (movRows.length === 0) {
      console.warn(`DELETE stock_mouvements: mouvement introuvable id=${id} userId=${userId}`);
      await conn.rollback();
      return res.status(404).json({ error: 'Mouvement introuvable' });
    }
    
    const mov = movRows[0];

    // Si pas de designation, supprime simplement
    if (!mov.designation_id) {
      await conn.execute(`DELETE FROM stock_mouvements WHERE id = ? AND user_id = ?`, [mov.id, userId]);
      await conn.commit();
      return res.json({ success: true, adjusted_rows: 0, current_stock: null, updated_movements: [] });
    }

    // Charger la désignation
    const [desRows] = await conn.query(
      `SELECT current_stock
         FROM stock_designations
        WHERE id = ? AND user_id = ?`,
      [mov.designation_id, userId]
    );
    if (!desRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Désignation introuvable pour cet utilisateur' });
    }

    const currentStock = Number(desRows[0].current_stock ?? 0);
    const qty = Math.trunc(Number(mov.quantite));
    const typeNorm = normalizeType(mov.type) || mov.type;
    const delta = typeNorm === 'entree' ? qty : -qty;

    // Ajuster les lignes postérieures
    const [updRes] = await conn.execute(
      `UPDATE stock_mouvements
          SET stock = stock - ?, stockR = stockR - ?
        WHERE user_id = ? AND designation_id = ?
          AND (date > ? OR (date = ? AND id > ?))`,
      [delta, delta, userId, mov.designation_id, mov.date, mov.date, mov.id]
    );

    // Supprime le mouvement
    await conn.execute(
      `DELETE FROM stock_mouvements WHERE id = ? AND user_id = ?`,
      [mov.id, userId]
    );

    // Met à jour current_stock
    const newCurrent = currentStock - delta;
    await conn.execute(
      `UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?`,
      [newCurrent, mov.designation_id, userId]
    );

    // Récupère l'état canonique des mouvements pour cette désignation
    const [updatedMovements] = await conn.query(
      `SELECT id, designation_id, type, quantite, strftime('%Y-%m-%d', date) AS date, stock, stockR, created_at
         FROM stock_mouvements
        WHERE user_id = ? AND designation_id = ?
        ORDER BY date ASC, id ASC`,
      [userId, mov.designation_id]
    );

    await conn.commit();

    res.json({
      success: true,
      adjusted_rows: updRes.affectedRows,
      current_stock: newCurrent,
      updated_movements: updatedMovements
    });

    // Best-effort remote delete replication
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.beginTransaction();
          await rconn.execute('DELETE FROM stock_mouvements WHERE id = ? AND user_id = ?', [mov.id, userId]);
          // Update remote designation current_stock to reflect local
          const [ld] = await pool.query('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ?', [mov.designation_id, userId]);
          const ldRow = ld && ld[0];
          if (ldRow) {
            await rconn.execute(
              `INSERT INTO stock_designations (id, user_id, name, current_stock)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE name = VALUES(name), current_stock = VALUES(current_stock)`,
              [ldRow.id, userId, ldRow.name, Number(ldRow.current_stock || 0)]
            );
          }
          await rconn.commit();
        } catch (e) {
          logReplicationError('mouvement.delete', e, { mouvement_id: mov.id, user_id: userId });
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Erreur DELETE mouvement:', err.stack || err);
    res.status(500).json({
      error: 'Erreur lors de la suppression du mouvement',
      details: err.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;