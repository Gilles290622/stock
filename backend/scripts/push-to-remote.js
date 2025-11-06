#!/usr/bin/env node
/**
 * Push local data (SQLite via pool) to remote MySQL (Hostinger) using REMOTE_DB_* env vars.
 *
 * Usage examples:
 *   node scripts/push-to-remote.js all --user 7
 *   node scripts/push-to-remote.js categories
 *   node scripts/push-to-remote.js designations --user 7
 */
require('dotenv').config();
const pool = require('../config/db');
const remotePool = require('../config/remoteDb');

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason && (reason.stack || reason.message) || reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err && (err.stack || err.message) || err);
  process.exit(1);
});

function parseArgs(argv) {
  const args = { entity: 'all', user: null, allUsers: false };
  if (argv[2]) args.entity = String(argv[2]).toLowerCase();
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && i + 1 < argv.length) { args.user = parseInt(argv[++i], 10); continue; }
    if (a === '--all-users') { args.allUsers = true; continue; }
    const m = /^--user=(\d+)$/.exec(a); if (m) { args.user = parseInt(m[1], 10); continue; }
  }
  const valid = ['users', 'categories', 'clients', 'designations', 'mouvements', 'paiements', 'depenses', 'all'];
  if (!valid.includes(args.entity)) throw new Error('Entité invalide. Utilisez: ' + valid.join('|'));
  // Si pas d'user explicite et entité dépendante d'un user, on bascule en mode allUsers
  if (!['categories','users'].includes(args.entity) && (!Number.isInteger(args.user) || args.user < 1)) {
    args.allUsers = true;
  }
  return args;
}

async function upsertRemoteUser(userId) {
  let attempt = 0;
  while (attempt < 2) {
    const conn = await remotePool.getConnection();
    try {
      const [ru] = await conn.execute('SELECT id FROM users WHERE id = ?', [userId]);
      if (ru.length === 0) {
        const [lu] = await pool.query('SELECT id, full_name, email, password FROM users WHERE id = ?', [userId]);
        const u = lu && lu[0];
        if (u) {
          const [ruByEmail] = await conn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
          if (ruByEmail.length === 0) {
            await conn.execute('INSERT INTO users (id, full_name, email, password) VALUES (?, ?, ?, ?)', [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']);
          }
        }
      }
      return;
    } catch (e) {
      if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
        attempt++;
        if (attempt >= 2) throw e;
      } else {
        throw e;
      }
    } finally {
      conn.release();
    }
  }
}

async function pushCategories() {
  // Ensure remote table exists (in case migration not yet applied)
  const conn = await remotePool.getConnection();
  try {
    try {
      await conn.execute(
        `CREATE TABLE IF NOT EXISTS stock_categories (
           id INT AUTO_INCREMENT PRIMARY KEY,
           name VARCHAR(190) NOT NULL UNIQUE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    } catch (_) {}
    const [rows] = await pool.query(`SELECT id, name FROM stock_categories ORDER BY id ASC`);
    for (const c of rows) {
      await conn.execute(
        `INSERT INTO stock_categories (id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name)`,
        [c.id, c.name]
      );
    }
    return rows.length;
  } finally {
    conn.release();
  }
}

async function ensureRemoteProfilesSchema(conn) {
  try {
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS profiles (
         id INT AUTO_INCREMENT PRIMARY KEY,
         user_id INT NOT NULL UNIQUE,
         username VARCHAR(190) UNIQUE,
         role VARCHAR(50) DEFAULT 'user',
         status VARCHAR(50) DEFAULT 'active',
         entreprise VARCHAR(255) NULL,
         created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    // Ensure colonne 'entreprise' existe aussi sur schéma déjà créé
    try {
      const [cols] = await conn.query("SHOW COLUMNS FROM profiles LIKE 'entreprise'");
      if (!Array.isArray(cols) || cols.length === 0) {
        await conn.execute("ALTER TABLE profiles ADD COLUMN entreprise VARCHAR(255) NULL AFTER status");
      }
    } catch (e) {
      // Ignore if lack of privileges or other benign errors
      if (!/Duplicate column|exists/i.test(e && (e.message || ''))) console.warn('[profiles] ALTER ADD entreprise ignoré:', e && (e.message || e));
    }
  } catch (e) {
    console.warn('[remote] CREATE TABLE profiles ignoré:', e && (e.message || e));
  }
}

async function pushUsersAll() {
  // Synchronise tous les utilisateurs + profils (username/role/status/entreprise)
  const [loc] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.password,
            p.username, p.role, p.status,
            COALESCE(e.name, u.entreprise) AS entreprise
       FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id
  LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
      ORDER BY u.id ASC`
  );
  // Note: entreprise côté local peut être dans users selon migrations; si présent, mapper ici.
  try {
    const conn = await remotePool.getConnection();
    try {
      await ensureRemoteProfilesSchema(conn);
      // Detect presence of entreprise column to adapt upsert
      let hasEntrepriseCol = true;
      try {
        const [cols] = await conn.query("SHOW COLUMNS FROM profiles LIKE 'entreprise'");
        hasEntrepriseCol = Array.isArray(cols) && cols.length > 0;
      } catch (_) { hasEntrepriseCol = false; }
      await conn.beginTransaction();
      for (const u of loc) {
        await conn.execute(
          `INSERT INTO users (id, full_name, email, password)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
          [u.id, u.full_name || '', u.email || `user${u.id}@local`, u.password || '']
        );
        // Upsert profil
        if (hasEntrepriseCol) {
          try {
            await conn.execute(
              `INSERT INTO profiles (user_id, username, role, status, entreprise)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE username=VALUES(username), role=VALUES(role), status=VALUES(status), entreprise=VALUES(entreprise)`,
              [u.id, u.username || null, u.role || 'user', u.status || 'active', u.entreprise || null]
            );
          } catch (e) {
            // If entreprise column is actually missing, fallback dynamically
            if (/Unknown column 'entreprise'|ER_BAD_FIELD_ERROR/i.test(String(e && (e.message || e)))) {
              try { await conn.execute("ALTER TABLE profiles ADD COLUMN entreprise VARCHAR(255) NULL AFTER status"); hasEntrepriseCol = true; } catch (_) {}
              await conn.execute(
                `INSERT INTO profiles (user_id, username, role, status)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE username=VALUES(username), role=VALUES(role), status=VALUES(status)`,
                [u.id, u.username || null, u.role || 'user', u.status || 'active']
              );
            } else {
              throw e;
            }
          }
        } else {
          await conn.execute(
            `INSERT INTO profiles (user_id, username, role, status)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE username=VALUES(username), role=VALUES(role), status=VALUES(status)`,
            [u.id, u.username || null, u.role || 'user', u.status || 'active']
          );
        }
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    throw e;
  }
  return { users: loc.length };
}

async function pushClients(userId, _rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, name, address, phone, email
       FROM stock_clients WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    while (attempt < 2) {
      const conn = await remotePool.getConnection();
      try {
        await conn.beginTransaction();
        for (const c of chunk) {
          await conn.execute(
            `INSERT INTO stock_clients (id, user_id, name, address, phone, email)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), phone=VALUES(phone), email=VALUES(email)`,
            [c.id, userId, c.name, c.address || null, c.phone || null, c.email || null]
          );
        }
        await conn.commit();
        done += chunk.length;
        conn.release();
        break;
      } catch (e) {
        try { await conn.rollback(); } catch {}
        conn.release();
        if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
          attempt++;
          if (attempt >= 2) throw e;
        } else {
          throw e;
        }
      }
    }
  }
  return done;
}

async function pushDesignations(userId, _rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, name, current_stock, categorie
       FROM stock_designations WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    while (attempt < 2) {
      const conn = await remotePool.getConnection();
      try {
        await conn.beginTransaction();
        for (const d of chunk) {
          await conn.execute(
            `INSERT INTO stock_designations (id, user_id, name, current_stock, categorie)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name=VALUES(name), current_stock=VALUES(current_stock), categorie=VALUES(categorie)`,
            [d.id, userId, d.name, Number(d.current_stock || 0), d.categorie || null]
          );
        }
        await conn.commit();
        done += chunk.length;
        conn.release();
        break;
      } catch (e) {
        try { await conn.rollback(); } catch {}
        conn.release();
        if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
          attempt++;
          if (attempt >= 2) throw e;
        } else {
          throw e;
        }
      }
    }
  }
  return done;
}

async function pushMouvements(userId, _rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
       FROM stock_mouvements WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    while (attempt < 2) {
      const conn = await remotePool.getConnection();
      try {
        await conn.beginTransaction();
        for (const m of chunk) {
          await conn.execute(
            `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE date=VALUES(date), type=VALUES(type), designation_id=VALUES(designation_id), quantite=VALUES(quantite), prix=VALUES(prix), client_id=VALUES(client_id), stock=VALUES(stock), stockR=VALUES(stockR)`,
            [m.id, userId, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
          );
        }
        await conn.commit();
        done += chunk.length;
        conn.release();
        break;
      } catch (e) {
        try { await conn.rollback(); } catch {}
        conn.release();
        if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
          attempt++;
          if (attempt >= 2) throw e;
        } else {
          throw e;
        }
      }
    }
  }
  return done;
}

async function pushPaiements(userId, _rconn, { includeNull = true } = {}) {
  const where = includeNull ? 'user_id = ? OR user_id IS NULL' : 'user_id = ?';
  const [rows] = await pool.query(
    `SELECT id, mouvement_id, user_id, montant, strftime('%Y-%m-%d', date) AS date
       FROM stock_paiements WHERE ${where} ORDER BY id ASC`,
    [userId]
  );
  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    while (attempt < 2) {
      const conn = await remotePool.getConnection();
      try {
        await conn.beginTransaction();
        for (const p of chunk) {
          // Ensure mouvement exists remotely (minimal)
          const [rm] = await conn.execute('SELECT id FROM stock_mouvements WHERE id = ? AND user_id = ?', [p.mouvement_id, userId]);
          if (rm.length === 0) {
            const [lm] = await pool.query(
              `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, type, designation_id, quantite, prix, client_id, stock, stockR
                 FROM stock_mouvements WHERE id = ? AND user_id = ?`,
              [p.mouvement_id, userId]
            );
            const m = lm && lm[0];
            if (m) {
              await conn.execute(
                `INSERT INTO stock_mouvements (id, user_id, date, type, designation_id, quantite, prix, client_id, stock, stockR)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE date=VALUES(date)`,
                [m.id, userId, m.date, m.type, m.designation_id, m.quantite, m.prix, m.client_id, m.stock, m.stockR]
              );
            }
          }
          await conn.execute(
            `INSERT INTO stock_paiements (id, mouvement_id, user_id, montant, date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE montant=VALUES(montant), date=VALUES(date)`,
            [p.id, p.mouvement_id, userId, Number(p.montant), p.date]
          );
        }
        await conn.commit();
        done += chunk.length;
        conn.release();
        break;
      } catch (e) {
        try { await conn.rollback(); } catch {}
        conn.release();
        if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
          attempt++;
          if (attempt >= 2) throw e;
        } else {
          throw e;
        }
      }
    }
  }
  return done;
}

async function pushDepenses(userId, _rconn) {
  const [rows] = await pool.query(
    `SELECT id, user_id, strftime('%Y-%m-%d', date) AS date, libelle, montant, destinataire
       FROM stock_depenses WHERE user_id = ? ORDER BY id ASC`,
    [userId]
  );
  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    while (attempt < 2) {
      const conn = await remotePool.getConnection();
      try {
        await conn.beginTransaction();
        for (const d of chunk) {
          await conn.execute(
            `INSERT INTO stock_depenses (id, user_id, date, libelle, montant, destinataire)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE date=VALUES(date), libelle=VALUES(libelle), montant=VALUES(montant), destinataire=VALUES(destinataire)`,
            [d.id, userId, d.date, d.libelle, Number(d.montant), d.destinataire || null]
          );
        }
        await conn.commit();
        done += chunk.length;
        conn.release();
        break;
      } catch (e) {
        try { await conn.rollback(); } catch {}
        conn.release();
        if ((e && e.code === 'ECONNRESET') || /ECONNRESET|lost connection|server has gone away/i.test(String(e && (e.message || e)))) {
          attempt++;
          if (attempt >= 2) throw e;
        } else {
          throw e;
        }
      }
    }
  }
  return done;
}

async function main() {
  const { entity, user, allUsers } = parseArgs(process.argv);
  if (!remotePool) throw new Error('Remote DB non configurée (REMOTE_DB_*)');
  // Test rapide de connectivité
  const rconn = await remotePool.getConnection();
  try {
    const result = {};
    if (entity === 'users' || entity === 'all') {
      console.log('> Pushing users & profiles ...');
      const r = await pushUsersAll();
      result.users = r.users;
      console.log('Pushed users:', r.users);
    }
    if (entity === 'categories' || entity === 'all') {
      console.log('> Pushing categories ...');
      result.categories = await pushCategories();
      console.log('Pushed categories:', result.categories);
    }
    const pushForUser = async (uid) => {
      await upsertRemoteUser(uid);
      if (entity === 'clients' || entity === 'all') {
        const n = await pushClients(uid);
        result.clients = (result.clients || 0) + n;
      }
      if (entity === 'designations' || entity === 'all') {
        const n = await pushDesignations(uid);
        result.designations = (result.designations || 0) + n;
      }
      if (entity === 'mouvements' || entity === 'all') {
        const n = await pushMouvements(uid);
        result.mouvements = (result.mouvements || 0) + n;
      }
      if (entity === 'paiements' || entity === 'all') {
        const n = await pushPaiements(uid, null, { includeNull: !allUsers });
        result.paiements = (result.paiements || 0) + n;
      }
      if (entity === 'depenses' || entity === 'all') {
        const n = await pushDepenses(uid);
        result.depenses = (result.depenses || 0) + n;
      }
    };

    if (entity !== 'categories') {
      if (allUsers) {
        // lister tous les users locaux
        const [users] = await pool.query('SELECT id FROM users ORDER BY id ASC');
        console.log('Local users to push:', users.map(u => u.id));
        for (const u of users) {
          console.log(`> Pushing for user ${u.id} ...`);
          try {
            await pushForUser(u.id);
            console.log(`User ${u.id} done.`);
          } catch (e) {
            console.error(`Error while pushing for user ${u.id}:`, e && (e.message || e));
            throw e;
          }
        }
      } else {
        console.log(`> Pushing for user ${user} ...`);
        await pushForUser(user);
        console.log(`User ${user} done.`);
      }
    }

    console.log('Done.', { entity, user: allUsers ? 'ALL' : user, result });
  } catch (e) {
    try { await rconn.rollback(); } catch {}
    throw e;
  } finally {
    rconn.release();
  }
}

main().catch((e) => { console.error('Echec push-to-remote:', e && (e.stack || e.message) || e); process.exit(1); });
