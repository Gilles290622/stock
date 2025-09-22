const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// Dossier d'upload (public/uploads/avatars)
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const AVATAR_DIR = path.join(UPLOAD_ROOT, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Multer storage : nom unique en incluant l'id utilisateur si présent
const storage = multer.diskStorage({
  destination: AVATAR_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uidPart = (req.user && req.user.id) ? `user-${req.user.id}` : `anon-${Date.now()}`;
    cb(null, `${uidPart}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype) return cb(new Error('Fichier invalide'), false);
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Seules les images sont autorisées'), false);
    cb(null, true);
  }
});

// Base publique (optionnel) ex: https://jts-services.shop
const PUBLIC_BASE = (process.env.APP_URL || '').replace(/\/$/, '');

// POST /api/upload-logo
router.post('/upload-logo', authenticateToken, (req, res) => {
  // Note: authenticateToken doit avoir rempli req.user avant multer filename()
  upload.single('logo')(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err.message || err);
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Fichier trop volumineux (<=5MB)' });
      return res.status(400).json({ error: err.message || 'Erreur lors de l\'upload' });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });

    const relativeUrl = `/uploads/avatars/${req.file.filename}`;
    const url = PUBLIC_BASE ? `${PUBLIC_BASE}${relativeUrl}` : relativeUrl;

    // Réponse : url (absolue si APP_URL défini), relativeUrl et filename
    return res.json({ success: true, url, relativeUrl, filename: req.file.filename });
  });
});

module.exports = router;