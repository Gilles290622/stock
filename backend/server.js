const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

const authenticateToken = require('./middleware/auth');

const stockMouvementsRoutes = require("./routes/stockMouvements");
const authRoutes = require("./routes/auth");
const designationsRoutes = require("./routes/designations");
const clientsRoutes = require("./routes/clients");
const stockPaiementsRouter = require('./routes/stockPaiements');

const app = express();

app.use(cors());
app.use(express.json());

// ROUTES MÉTIER
app.use('/api/stockDepenses', require('./routes/stockDepenses'));
app.use('/api/stockPaiements', stockPaiementsRouter);
app.use('/api/stockFlux', require('./routes/stockFlux'));
app.use("/api", authRoutes);
app.use("/api/stockMouvements", stockMouvementsRoutes);
app.use("/api/designations", designationsRoutes);
app.use("/api/clients", clientsRoutes);
// leave update-profile mounted if you have a dedicated route file
app.use('/api/update-profile', require('./routes/update-profile'));

// === UPLOAD AVATARS (sécurisé) ===
// Dossier d'upload (crée si inexistant)
const UPLOAD_ROOT = path.join(__dirname, "uploads");
const AVATAR_DIR = path.join(UPLOAD_ROOT, "avatars");
const fs = require("fs");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// expose /uploads/* statically (serve avatars via /uploads/avatars/...)
app.use('/uploads', express.static(UPLOAD_ROOT));

// Multer config : validation + limite taille
const storage = multer.diskStorage({
  destination: AVATAR_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    // if user is authenticated, prefer user-id in filename
    const uid = req.user && req.user.id ? `user-${req.user.id}` : `anon-${Date.now()}`;
    cb(null, `${uid}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype) return cb(new Error('Invalid file'), false);
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'), false);
    cb(null, true);
  }
});

// Build absolute URL base if provided (useful in production behind proxy)
const PUBLIC_BASE = (process.env.APP_URL || '').replace(/\/$/, ''); // ex. https://jts-services.shop

// Route d'upload sécurisé : require token -> use req.user.id for filename
app.post('/api/upload-logo', authenticateToken, (req, res, next) => {
  // Wrap multer so we can catch errors and have req.user available in filename
  upload.single('logo')(req, res, (err) => {
    if (err) {
      // Multer error or fileFilter error
      console.error('Upload error:', err.message || err);
      // Differentiate size error if needed
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Fichier trop volumineux (<=5MB)' });
      return res.status(400).json({ error: err.message || 'Erreur lors de l\'upload' });
    }
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé" });

    // Construire URL relative et absolue si besoin
    const relativeUrl = `/uploads/avatars/${req.file.filename}`;
    const url = PUBLIC_BASE ? `${PUBLIC_BASE}${relativeUrl}` : relativeUrl;

    // Optionnel : ici tu pourrais supprimer l'ancien avatar si tu enregistres le nom en BDD
    // et/ou mettre à jour la table users avec le nouveau logo en utilisant req.user.id.

    return res.json({ success: true, url, filename: req.file.filename, relativeUrl });
  });
});

// Note: remove any duplicate definition of /api/update-profile below if you mount the route file above.
// If you don't have routes/update-profile.js, re-add a secured handler here using authenticateToken.

// healthcheck
app.get("/", (req, res) => res.send("ok backend running"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log("API démarrée sur le port", PORT);
});

module.exports = app;