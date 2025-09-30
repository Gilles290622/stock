const db = require('../config/db');

// Blocks access for non-admins when subscription is expired and no free_days
module.exports = async function subscriptionGuard(req, res, next) {
  try {
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ error: 'Non authentifié' });
    const [rows] = await db.execute('SELECT role, status, subscription_expires, free_days FROM profiles WHERE user_id = ? LIMIT 1', [uid]);
    if (!rows.length) return res.status(403).json({ error: 'Profil introuvable' });
    const p = rows[0];
    if (p.role === 'admin') return next();
    if (p.status === 'revoked') return res.status(403).json({ error: 'Accès révoqué' });
    const now = new Date();
    const exp = p.subscription_expires ? new Date(p.subscription_expires) : null;
    const active = exp && !isNaN(exp) && exp > now;
    const free = parseInt(p.free_days, 10) > 0;
    if (active || free) return next();
    return res.status(402).json({
      error: 'Abonnement expiré',
      message: 'Votre abonnement est expiré. Veuillez renouveler (Wave +225 0747672761 — 7000 F CFA / mois).',
      code: 'SUBSCRIPTION_EXPIRED'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
