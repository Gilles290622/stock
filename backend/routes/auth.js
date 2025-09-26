const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const remotePool = require('../config/remoteDb');
const authenticateToken = require('../middleware/auth');

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

    // Insert dans users (sans username, avec full_name)
    const [insertResult] = await conn.execute(
      'INSERT INTO users (full_name, entreprise, email, password) VALUES (?, ?, ?, ?)',
      [full_name, entreprise || null, email, hashedPassword]
    );
    const userId = insertResult.insertId;
    console.log('User inserted in users, ID:', userId);

    // Insert dans profiles (avec username, role, status, etc.)
    await conn.execute(
      'INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)',
      [userId, 'user', 'pending', username]
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
          // Upsert user
          try {
            await rconn.execute(
              `INSERT INTO users (id, full_name, entreprise, email, password, phone_number, logo)
               VALUES (?, ?, ?, ?, ?, NULL, NULL)
               ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), entreprise=VALUES(entreprise), email=VALUES(email), password=VALUES(password)`,
              [userId, full_name, entreprise || null, email, hashedPassword]
            );
          } catch (colErr) {
            // Fallback si la colonne entreprise n'existe pas encore sur la base distante
            if (colErr && /Unknown column 'entreprise'|ER_BAD_FIELD_ERROR/i.test(colErr.message || '')) {
              await rconn.execute(
                `INSERT INTO users (id, full_name, email, password, phone_number, logo)
                 VALUES (?, ?, ?, ?, NULL, NULL)
                 ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email), password=VALUES(password)`,
                [userId, full_name, email, hashedPassword]
              );
            } else {
              throw colErr;
            }
          }
          // Upsert profile by user_id (username unique may differ)
          const [rp] = await rconn.execute('SELECT id FROM profiles WHERE user_id = ?', [userId]);
          if (rp.length === 0) {
            await rconn.execute(
              'INSERT INTO profiles (user_id, role, status, username) VALUES (?, ?, ?, ?)',
              [userId, 'user', 'pending', username]
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
  const { identifier, password } = req.body;
  console.log('Login request received:', { identifier });  // Log trace
  
  if (!identifier || !password) {
    return res.status(400).json({ message: "Tous les champs sont requis" });
  }

  try {
    // SELECT avec JOIN pour récupérer username depuis profiles (si besoin)
    const [users] = await db.execute(
  `SELECT u.id, u.email, u.password, u.full_name, u.entreprise, u.phone_number, u.logo, p.username
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
        WHERE u.email = ? OR p.username = ?
        LIMIT 1`,
      [identifier, identifier]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ message: 'Utilisateur non trouvé' });
    }
    
    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Mot de passe incorrect' });
    }

    const payload = { id: user.id, email: user.email, username: user.username };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    console.log('Login successful for user:', user.id);
    const fullUser = {
      id: user.id,
      email: user.email,
      username: user.username,
  full_name: user.full_name || '',
  entreprise: user.entreprise || '',
      phone_number: user.phone_number || null,
      logo: user.logo || '',
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
  `SELECT u.id, u.email, u.full_name, u.entreprise, u.phone_number, u.logo, p.username
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
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
        logo: u.logo || ''
      }
    });
  } catch (e) {
    console.error('Erreur /api/me:', e?.message || e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;