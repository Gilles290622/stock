const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  // Récupère le token depuis :
  // 1) Header Authorization: "Bearer <token>"
  // 2) req.query.token (utile pour tests)
  // 3) req.body.token (rare)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  let token = null;

  if (authHeader) {
    // supporte "Bearer xxxxx" ou juste "xxxxx"
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }

  if (!token && req.query && req.query.token) token = String(req.query.token).trim();
  if (!token && req.body && req.body.token) token = String(req.body.token).trim();

  // Vérification de la config serveur
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('authenticateToken: JWT_SECRET non défini');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!token) {
    // pas de token fourni
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const payload = jwt.verify(token, secret);
    // payload doit contenir au minimum un identifiant d'utilisateur (id)
    req.user = payload;
    return next();
  } catch (err) {
    // ExpiredToken -> 401, autres erreurs d'auth -> 403
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    console.debug('authenticateToken: jwt verify error', err.message || err);
    return res.status(403).json({ error: 'Token invalide' });
  }
}

module.exports = authenticateToken;