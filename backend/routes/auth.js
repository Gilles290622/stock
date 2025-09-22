const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Inscription (register) - Adapté au schéma : users (full_name, email, password) + profiles (username, etc.)
router.post('/register', async (req, res) => {
  const { email, password, username, full_name } = req.body;  // Ajout full_name (requis pour users)
  console.log('Register request received:', { email, username, full_name });  // Log trace

  if (!email || !password || !username || !full_name) {  // Validation étendue
    console.log('Validation failed: missing fields');
    return res.status(400).json({ message: "Tous les champs sont requis (email, password, username, full_name)" });
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
      'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
      [full_name, email, hashedPassword]
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

    // Génère token
    const payload = { id: userId, email, username };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
    console.log('Token generated');

    res.status(201).json({ token, user: payload });
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

// Connexion (login) - Fixé en promise-based
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  console.log('Login request received:', { identifier });  // Log trace
  
  if (!identifier || !password) {
    return res.status(400).json({ message: "Tous les champs sont requis" });
  }

  try {
    // SELECT avec JOIN pour récupérer username depuis profiles (si besoin)
    const [users] = await db.execute(
      'SELECT u.id, u.email, u.password, p.username FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ? OR p.username = ? LIMIT 1',
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

    res.json({ token, user: payload });
  } catch (err) {
    console.error('Login error:', err.message || err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;