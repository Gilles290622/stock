const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
// Load .env from backend directory regardless of current working directory
require("dotenv").config({ path: path.join(__dirname, ".env") });

const authenticateToken = require('./middleware/auth');

const stockMouvementsRoutes = require("./routes/stockMouvements");
const authRoutes = require("./routes/auth");
const designationsRoutes = require("./routes/designations");
const clientsRoutes = require("./routes/clients");
const stockPaiementsRouter = require('./routes/stockPaiements');
const syncRoutes = require('./routes/sync');
// Remote replication pool (can be disabled via DISABLE_REMOTE_REPLICATION=true)
let remotePool;
try {
  remotePool = require('./config/remoteDb');
  if (String(process.env.DISABLE_REMOTE_REPLICATION || '').toLowerCase() === 'true') {
    console.log('[replication] Disabled explicitly by DISABLE_REMOTE_REPLICATION env');
    remotePool = null;
  }
} catch (e) {
  console.warn('[replication] remoteDb require failed:', e?.message || e);
  remotePool = null;
}
const subscriptionGuard = require('./middleware/subscription');

const app = express();

app.use(cors());
app.use(express.json());

// Diagnose remote replication availability
if (remotePool) {
  console.log('[replication] Remote replication ENABLED ->', process.env.REMOTE_DB_HOST, process.env.REMOTE_DB_NAME);
} else {
  console.log('[replication] Remote replication DISABLED (set REMOTE_DB_HOST, REMOTE_DB_USER, REMOTE_DB_PASSWORD, REMOTE_DB_NAME in .env)');
}

// Gestion propre des erreurs de parsing JSON (renvoie du JSON au lieu de HTML)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.error('Invalid JSON payload:', err.message);
    return res.status(400).json({ message: 'Requête JSON invalide' });
  }
  next(err);
});

// ROUTES MÉTIER
app.use('/api/stockDepenses', require('./routes/stockDepenses'));
app.use('/api/stockPaiements', stockPaiementsRouter);
app.use('/api/stockFlux', require('./routes/stockFlux'));
app.use("/api", authRoutes);
// Apply subscription guard for non-admins on sales-related routes
app.use("/api/stockMouvements", authenticateToken, subscriptionGuard, stockMouvementsRoutes);
app.use("/api/designations", authenticateToken, subscriptionGuard, designationsRoutes);
app.use("/api/clients", authenticateToken, subscriptionGuard, clientsRoutes);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/sync', syncRoutes);
app.use('/api/payments', require('./routes/payments'));
// leave update-profile mounted if you have a dedicated route file
app.use('/api/update-profile', require('./routes/update-profile'));
app.use('/api/entreprise', require('./routes/entreprise'));

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

// Serve frontend à la racine (/) en prod ou via Vite middleware en dev.
let FRONTEND_AVAILABLE = false;
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
try {
  if (require('fs').existsSync(FRONTEND_DIST)) {
    FRONTEND_AVAILABLE = true;
  // Base frontend à la racine pour ce déploiement
  // (ignorer FRONTEND_BASE pour éviter /stock/stock)
  let FRONT_BASE = '/';
    // Normaliser sans slash final (sauf si racine)
    const baseNoSlash = FRONT_BASE === '/' ? '/' : FRONT_BASE.replace(/\/$/, '');

  // Servir les fichiers statiques sous le bon préfixe
    app.use(baseNoSlash, express.static(FRONTEND_DIST, { index: false }));

  // Compat: rediriger /stock ou /stock/ vers la racine
  app.get(/^\/stock\/?$/, (req, res) => res.redirect('/'));

    // Rediriger la racine vers la base si nécessaire
    if (baseNoSlash !== '/') {
      app.get('/', (req, res) => res.redirect(baseNoSlash + '/'));
    }

    // Servir index.html sur la base et fallback SPA sur les routes frontend
    const INDEX_FILE = path.join(FRONTEND_DIST, 'index.html');
    if (baseNoSlash === '/') {
      app.get('/', (req, res) => res.sendFile(INDEX_FILE));
      app.get(/^(?!\/api|\/uploads).+$/, (req, res) => res.sendFile(INDEX_FILE));
    } else {
      app.get(baseNoSlash, (req, res) => res.redirect(baseNoSlash + '/'));
      app.get(baseNoSlash + '/', (req, res) => res.sendFile(INDEX_FILE));
      const escaped = baseNoSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const spaRe = new RegExp('^' + escaped + '\\/(?!api|uploads).*$');
      app.get(spaRe, (req, res) => res.sendFile(INDEX_FILE));
    }

    console.log(`[frontend] Build statique servi sur base '${baseNoSlash}'`);
  }
} catch (e) {
  console.warn('[frontend] Static mount error:', e?.message || e);
}

// Vite middleware (développement) : monte le front directement sur le même port (80 / 3001)
if (!FRONTEND_AVAILABLE && process.env.NODE_ENV !== 'production') {
  (async () => {
    try {
      const { createServer } = require('vite');
      const vite = await createServer({
        root: path.join(__dirname, '..', 'frontend'),
        base: '/',
        server: { middlewareMode: true },
        appType: 'spa'
      });
      // Inject Vite middlewares (handles HMR, assets, etc.)
      app.use(vite.middlewares);
      const fsPromises = require('fs').promises;
      const INDEX_PATH = path.join(__dirname, '..', 'frontend', 'index.html');
      async function serveIndex(req, res, next) {
        try {
          let html = await fsPromises.readFile(INDEX_PATH, 'utf-8');
            // transformIndexHtml applique HMR client + réécrit base
      html = await vite.transformIndexHtml('/', html);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
        } catch (e) { next(e); }
      }
  app.get('/', serveIndex);
  app.get(/^\/(?!api|uploads)(.*)$/, serveIndex);
  console.log('[frontend] Vite dev middleware actif sur / (HMR)');
    } catch (e) {
      console.warn('[frontend] Vite middleware non initialisé:', e?.message || e);
    }
  })();
}

// Healthcheck (JSON) moved to /api/health to avoid overriding SPA root route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', frontend: FRONTEND_AVAILABLE, timestamp: Date.now() });
});

// Version endpoint (for frontend refresh logic) – never swallow silently
let __backendVersion = '0.0.0';
try {
  const backendPkg = require('./package.json');
  if (backendPkg && backendPkg.version) __backendVersion = backendPkg.version;
} catch (e) {
  console.warn('[version] Impossible de charger package.json:', e?.message || e);
}
app.get('/api/version', (req, res) => {
  res.json({ version: __backendVersion, buildTime: process.env.BUILD_TIME || null });
});

// Global diagnostics (debug des crash silencieux)
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err && (err.stack || err.message) || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason && (reason.stack || reason.message) || reason);
});

  // --- Admin trigger migrations endpoint ---
  try {
    const { runMigrations } = require('./scripts/migrationsRunner');
    app.post('/api/admin/run-migrations', authenticateToken, async (req, res) => {
      try {
        const db = require('./config/db');
        // Vérifie d'abord via ID autorisé pour fallback rapide
        const allowedIds = (process.env.ADMIN_IDS || '1,7').split(',').map(s=>s.trim());
        let isAdmin = allowedIds.includes(String(req.user.id));
        if (!isAdmin) {
          // Vérifie rôle dans profiles
          try {
            const [rows] = await db.execute('SELECT role FROM profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
            if (rows.length && rows[0].role === 'admin') isAdmin = true;
          } catch {}
        }
        if (!isAdmin) {
          return res.status(403).json({ error: 'Accès refusé' });
        }
        const result = await runMigrations();
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Erreur' });
      }
    });
  } catch (e) {
    console.warn('[admin-migrations] endpoint not loaded:', e?.message || e);
  }

let PORT = parseInt(process.env.PORT, 10) || 3001;
if (PORT === 80) {
  console.log('[startup] Tentative d\'écoute sur le port 80');
}
app.listen(PORT, '0.0.0.0', () => {
  console.log("API démarrée sur le port", PORT, '| cwd=', process.cwd(), '| driver=', process.env.DB_DRIVER, '| sqliteFile=', process.env.SQLITE_FILE);
  // Heartbeat + diagnostics timers to detect silent exits
  setTimeout(() => console.log('[lifecycle] heartbeat 3s OK'), 3000);
  setInterval(() => {
    const mem = process.memoryUsage();
    console.log('[lifecycle] tick', new Date().toISOString(), 'rssMB=', (mem.rss/1024/1024).toFixed(1));
  }, 15000).unref();
});

process.on('exit', (code) => {
  console.log('[lifecycle] process exit event code=', code);
});

module.exports = app;