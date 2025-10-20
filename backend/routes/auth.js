const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');
const crypto = require('crypto');

// Inscription (register) - Adapté au schéma : users (full_name, email, password) + profiles (username, etc.)
router.post('/register', async (req, res) => {
  let { email, password, username, full_name, entreprise } = req.body;  // Ajout full_name + entreprise
  // Trim inputs (basic normalization)
  email = (email || '').trim();
  password = password || '';
  username = (username || '').trim();
  full_name = (full_name || '').trim();
  entreprise = (entreprise || '').trim();
  console.log('Register request received:', { email, username, full_name });  // Log trace

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET missing - cannot register securely');
    return res.status(500).json({ message: 'Configuration JWT manquante (JWT_SECRET)' });
  }

  if (!email || !password || !username || !full_name) {  // entreprise optionnel
    console.log('Validation failed: missing fields');
    return res.status(400).json({ message: "Champs requis manquants (email, password, username, full_name)" });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email invalide' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Mot de passe trop court (>= 6 caractères)' });
  }

  if (username.length < 3) {
    return res.status(400).json({ message: "Nom d'utilisateur trop court (>= 3 caractères)" });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Check existence email dans users
    const [existingUsers] = await conn.execute('SELECT 1 FROM users WHERE email = ? LIMIT 1', [email]);
    if (existingUsers.length > 0) {
      console.log('User already exists (email)');
      await conn.rollback();
      return res.status(400).json({ message: "Utilisateur déjà existant (email)" });
    }

    // Check existence username dans profiles
    const [existingProfiles] = await conn.execute('SELECT 1 FROM profiles WHERE username = ? LIMIT 1', [username]);
    if (existingProfiles.length > 0) {
      console.log('Username already taken');
      await conn.rollback();
      return res.status(400).json({ message: "Nom d'utilisateur déjà pris" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Password hashed successfully');

    // Insert dans users (sans username, avec full_name); try to map entreprise name to entreprise_id
    let entrepriseId = null;
    if (entreprise) {
      try {
        await conn.execute('CREATE TABLE IF NOT EXISTS stock_entreprise (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT)');
        try { await conn.execute('INSERT OR IGNORE INTO stock_entreprise (name) VALUES (?)', [entreprise]); } catch (_) {}
        const [erows] = await conn.execute('SELECT id FROM stock_entreprise WHERE name = ? LIMIT 1', [entreprise]);
        if (erows && erows.length) entrepriseId = erows[0].id;
        try { await conn.execute('ALTER TABLE users ADD COLUMN entreprise_id INTEGER'); } catch (_) {}
      } catch (_) { /* ignore if table/alter not possible */ }
    }
    const [insertResult] = await conn.execute(
      entrepriseId != null
        ? 'INSERT INTO users (full_name, entreprise_id, email, password) VALUES (?, ?, ?, ?)'
        : 'INSERT INTO users (full_name, entreprise, email, password) VALUES (?, ?, ?, ?)',
      entrepriseId != null
        ? [full_name, entrepriseId, email, hashedPassword]
        : [full_name, entreprise || null, email, hashedPassword]
    );
    const userId = insertResult.insertId;
    console.log('User inserted in users, ID:', userId);

    // Insert dans profiles (avec username, role, status, etc.)
    await conn.execute(
      'INSERT INTO profiles (user_id, role, status, username, free_days) VALUES (?, ?, ?, ?, ?)',
      [userId, 'user', 'pending', username, 7]
    );
    console.log('Profile inserted for user ID:', userId);

  await conn.commit();

    // Best-effort remote replication of user + profile
    if (remotePool) {
      (async () => {
        let rconn;
        try {
          rconn = await remotePool.getConnection();
          await rconn.beginTransaction();
          // Upsert user with entreprise_id if possible
          try {
            if (entreprise) {
              await rconn.execute('CREATE TABLE IF NOT EXISTS stock_entreprise (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP)');
              await rconn.execute('INSERT INTO stock_entreprise (name) VALUES (?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [entreprise]);
              const [re] = await rconn.execute('SELECT id FROM stock_entreprise WHERE name = ? LIMIT 1', [entreprise]);
              const entId = re && re.length ? re[0].id : null;
              if (entId) {
                try { await rconn.execute('ALTER TABLE users ADD COLUMN entreprise_id INT NULL'); } catch (_) {}
                await rconn.execute(
                  `INSERT INTO users (id, full_name, entreprise_id, email, password, phone_number, logo)
                   VALUES (?, ?, ?, ?, ?, NULL, NULL)
                   ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), entreprise_id=VALUES(entreprise_id), email=VALUES(email), password=VALUES(password)`,
                  [userId, full_name, entId, email, hashedPassword]
                );
              } else {
                await rconn.execute(
                  `INSERT INTO users (id, full_name, email, password, phone_number, logo)
                   VALUES (?, ?, ?, ?, NULL, NULL)
                   ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
                  [userId, full_name, email, hashedPassword]
                );
              }
            } else {
              await rconn.execute(
                `INSERT INTO users (id, full_name, email, password, phone_number, logo)
                 VALUES (?, ?, ?, ?, NULL, NULL)
                 ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
                [userId, full_name, email, hashedPassword]
              );
            }
          } catch (colErr) {
            // Fallback legacy
            await rconn.execute(
              `INSERT INTO users (id, full_name, entreprise, email, password, phone_number, logo)
               VALUES (?, ?, ?, ?, ?, NULL, NULL)
               ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), entreprise=VALUES(entreprise), email=VALUES(email), password=VALUES(password)`,
              [userId, full_name, entreprise || null, email, hashedPassword]
            ).catch(()=>{});
          }
          // Upsert profile by user_id (username unique may differ)
          const [rp] = await rconn.execute('SELECT id FROM profiles WHERE user_id = ?', [userId]);
          if (rp.length === 0) {
            await rconn.execute(
              'INSERT INTO profiles (user_id, role, status, username, free_days) VALUES (?, ?, ?, ?, ?)',
              [userId, 'user', 'pending', username, 7]
            );
          } else {
            await rconn.execute(
              'UPDATE profiles SET username = ?, role = COALESCE(role, ?), status = COALESCE(status, ?) WHERE user_id = ?',
              [username, 'user', 'pending', userId]
            );
          }
          await rconn.commit();
        } catch (e) {
          if (rconn) try { await rconn.rollback(); } catch {}
          console.warn('Remote push (register) skipped:', e?.message || e);
        } finally {
          if (rconn) rconn.release();
        }
      })();
    }

    // Génère token + réponse uniforme (comme /login et /me)
  const payload = { id: userId, email, username };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    console.log('Token generated');

    const fullUser = {
      id: userId,
      email,
      username,
      full_name,
      phone_number: null,
      logo: '',
      entreprise: entreprise || ''
    };

    res.status(201).json({ token, user: fullUser });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    // Gestion duplication explicite si pas intercepté plus haut
    if (err && err.code === 'ER_DUP_ENTRY') {
      console.error('Register duplicate entry:', err.message);
      return res.status(400).json({ message: "Email ou nom d'utilisateur déjà utilisé" });
    }
    console.error('Register error:', err.message || err);  // Log erreur
    res.status(500).json({ message: "Erreur serveur" });
  } finally {
    if (conn) conn.release();
  }
});

// === Simple in-memory rate limit for /login (per IP) ===
const _loginHits = new Map(); // ip -> { count, ts }
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOGIN_MAX_ATTEMPTS = 20; // window

function loginRateLimit(req, res, next) {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = _loginHits.get(ip) || { count: 0, ts: now };
    if (now - rec.ts > LOGIN_WINDOW_MS) {
      rec.count = 0; rec.ts = now;
    }
    rec.count++;
    _loginHits.set(ip, rec);
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Trop de tentatives de connexion, réessayez plus tard' });
    }
  } catch (_) { /* swallow */ }
  next();
}

// Connexion (login) - Fixé en promise-based
router.post('/login', loginRateLimit, async (req, res) => {
  const { identifier, password } = req.body || {};
  console.log('[auth.login] request', { identifier: identifier || null });
  
  if (!identifier || !password) {
    return res.status(400).json({ message: "Tous les champs sont requis" });
  }

  try {
    console.log('[auth.login] querying user by identifier');
    // SELECT avec JOIN pour récupérer username depuis profiles (si besoin)
    const [users] = await db.execute(
  `SELECT u.id, u.email, u.password, u.full_name,
          COALESCE(e.name, u.entreprise) AS entreprise,
          u.phone_number, u.logo,
          p.username, p.role, p.status
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.email = ? OR p.username = ?
        LIMIT 1`,
      [identifier, identifier]
    );
    
    console.log('[auth.login] query result length =', users && users.length);
    if (!users || users.length === 0) {
      return res.status(401).json({ message: 'Utilisateur non trouvé' });
    }
    
    const user = users[0];
    console.log('[auth.login] user row fetched', { id: user.id, hasPwd: !!user.password });
    // Guard against empty/invalid password hashes to avoid 500 errors
    if (!user.password || typeof user.password !== 'string' || !user.password.startsWith('$2')) {
      return res.status(401).json({ message: 'Mot de passe incorrect' });
    }
    let match = false;
    try {
      match = await bcrypt.compare(password, user.password);
    } catch (cmpErr) {
      console.warn('bcrypt compare error (treated as mismatch):', cmpErr?.message || cmpErr);
      match = false;
    }
    if (!match) {
      return res.status(401).json({ message: 'Mot de passe incorrect' });
    }

    const payload = { id: user.id, email: user.email, username: user.username };
    let token;
    try {
      token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    } catch (signErr) {
      console.error('[auth.login] jwt.sign error:', signErr?.message || signErr);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
    console.log('[auth.login] success for user:', user.id);
    const fullUser = {
      id: user.id,
      email: user.email,
      username: user.username,
  full_name: user.full_name || '',
  entreprise: user.entreprise || '',
      phone_number: user.phone_number || null,
      logo: user.logo || '',
      role: user.role || 'user',
      status: user.status || 'active'
    };
    res.json({ token, user: fullUser });
  } catch (err) {
    console.error('Login error:', err.message || err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/me  -> retourne le profil complet (auth requis)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute(
  `SELECT u.id, u.email, u.full_name,
          COALESCE(e.name, u.entreprise) AS entreprise,
          u.phone_number, u.logo,
          p.username, p.role, p.status, p.subscription_expires, p.free_days, p.auto_sync
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         LEFT JOIN stock_entreprise e ON e.id = u.entreprise_id
        WHERE u.id = ? LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const u = rows[0];
    return res.json({
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
  full_name: u.full_name || '',
  entreprise: u.entreprise || '',
        phone_number: u.phone_number || null,
        logo: u.logo || '',
        role: u.role || 'user',
        status: u.status || 'active',
        subscription_expires: u.subscription_expires || null,
        free_days: (typeof u.free_days !== 'undefined' ? u.free_days : null),
        auto_sync: (typeof u.auto_sync !== 'undefined' ? !!u.auto_sync : true)
      }
    });
  } catch (e) {
    console.error('Erreur /api/me:', e?.message || e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// --- Password reset with password_resets table ---
// POST /api/auth/reset-password/init { identifier }
router.post('/auth/reset-password/init', async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ message: 'Identifiant requis' });
    const [rows] = await db.execute(
      `SELECT u.id FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ? OR p.username = ? LIMIT 1`,
      [identifier, identifier]
    );
    if (!rows.length) return res.status(404).json({ message: 'Utilisateur introuvable' });
    const userId = rows[0].id;
    const code = crypto.randomBytes(3).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const iso = expires.toISOString().slice(0, 19).replace('T', ' ');
    // purge anciens codes
    await db.execute('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    await db.execute('INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)', [userId, code, iso]);
    // Envoi email si SMTP configuré
    let sent = false;
    try {
      const [urows] = await db.execute('SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [userId]);
      const to = (urows.length && urows[0].email) ? urows[0].email : null;
      if (to) {
        const { sendMail } = require('../utils/mailer');
        await sendMail({
          to,
          subject: 'Code de réinitialisation de mot de passe',
          text: `Votre code de réinitialisation est: ${code} (valide jusqu'au ${iso}).`,
          html: `<p>Votre code de réinitialisation est: <b>${code}</b></p><p>Valide jusqu'au ${iso}.</p>`
        });
        sent = true;
      }
    } catch (e) { /* noop: retournera sent:false */ }
    // Toujours renvoyer le code pour faciliter les tests locaux
    return res.json({ message: 'Code de réinitialisation généré', code, user_id: userId, expires_at: iso, sent });
  } catch (e) { return res.status(500).json({ message: 'Erreur serveur' }); }
});

// POST /api/auth/reset-password/complete { identifier, code, new_password }
router.post('/auth/reset-password/complete', async (req, res) => {
  try {
    const { identifier, code, new_password } = req.body || {};
    if (!identifier || !code || !new_password) return res.status(400).json({ message: 'Champs requis' });
    const [rows] = await db.execute(
      `SELECT u.id FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ? OR p.username = ? LIMIT 1`,
      [identifier, identifier]
    );
    if (!rows.length) return res.status(404).json({ message: 'Utilisateur introuvable' });
    const userId = rows[0].id;
    const [pr] = await db.execute('SELECT code, expires_at FROM password_resets WHERE user_id = ? LIMIT 1', [userId]);
    if (!pr.length || String(pr[0].code) !== String(code)) return res.status(400).json({ message: 'Code invalide' });
    const exp = new Date(pr[0].expires_at);
    if (isNaN(exp) || exp < new Date()) return res.status(400).json({ message: 'Code expiré' });
    if (String(new_password).length < 6) return res.status(400).json({ message: 'Mot de passe trop court' });
    const hash = await require('bcrypt').hash(new_password, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hash, userId]);
    // consommer le code
    await db.execute('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ message: 'Erreur serveur' }); }
});