const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const crypto = require('crypto');

// Simple admin guard: role=admin in profiles
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute('SELECT role FROM profiles WHERE user_id = ? LIMIT 1', [userId]);
    if (!rows.length || rows[0].role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/admin/users - list users and profiles minimal info
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.full_name, u.email,
              p.username, p.role, p.status, p.subscription_expires, p.free_days,
              COALESCE(cc.cnt, 0) AS clients_count,
              COALESCE(dd.cnt, 0) AS designations_count,
              COALESCE(mm.cnt, 0) AS mouvements_count
         FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    LEFT JOIN (
               SELECT user_id, COUNT(*) AS cnt FROM stock_clients GROUP BY user_id
              ) cc ON cc.user_id = u.id
    LEFT JOIN (
               SELECT user_id, COUNT(*) AS cnt FROM stock_designations GROUP BY user_id
              ) dd ON dd.user_id = u.id
    LEFT JOIN (
               SELECT user_id, COUNT(*) AS cnt FROM stock_mouvements GROUP BY user_id
              ) mm ON mm.user_id = u.id
        ORDER BY u.id ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/revoke - revoke access (set status=revoked)
router.post('/users/:id/revoke', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  try {
    await db.execute('UPDATE profiles SET status = ? WHERE user_id = ?', ['revoked', id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/admin/users/:id/subscription - extend subscription by months
// body: { months: 1 }
router.post('/users/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const months = Math.max(1, parseInt(req.body?.months || 1, 10));
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  try {
    // compute new expiry: if current in future, add months; else from now
    const [rows] = await db.execute('SELECT subscription_expires FROM profiles WHERE user_id = ? LIMIT 1', [id]);
    const now = new Date();
    let base = now;
    if (rows.length && rows[0].subscription_expires) {
      const cur = new Date(rows[0].subscription_expires);
      if (!isNaN(cur) && cur > now) base = cur;
    }
    const next = new Date(base);
    next.setMonth(next.getMonth() + months);
    // store as ISO string for sqlite; for mysql DATETIME accept yyyy-mm-dd hh:mm:ss
    const iso = next.toISOString().slice(0, 19).replace('T', ' ');
    await db.execute('UPDATE profiles SET subscription_expires = ?, status = ? WHERE user_id = ?', [iso, 'active', id]);
    res.json({ success: true, subscription_expires: iso });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/admin/users/:id/free-days - grant free days
// body: { days: 7 }
router.post('/users/:id/free-days', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const days = Math.max(1, parseInt(req.body?.days || 1, 10));
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  try {
    const [rows] = await db.execute('SELECT free_days FROM profiles WHERE user_id = ? LIMIT 1', [id]);
    const current = (rows.length && Number.isInteger(rows[0].free_days)) ? rows[0].free_days : (parseInt(rows[0]?.free_days, 10) || 0);
    const next = current + days;
    await db.execute('UPDATE profiles SET free_days = ? WHERE user_id = ?', [next, id]);
    res.json({ success: true, free_days: next });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/admin/payments/wave - placeholder endpoint to record a Wave payment
// body: { user_id, phone: '+2250747672761', amount: 7000, currency: 'XOF' }
router.post('/payments/wave', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id, phone, amount, currency } = req.body || {};
    if (!user_id || !amount) return res.status(400).json({ error: 'Paramètres manquants' });
    // For now, just acknowledge; integration with Wave API can be added later.
    res.json({ success: true, user_id, phone: phone || '+225 0747672761', amount: Number(amount), currency: currency || 'XOF' });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

// POST /api/admin/users/:id/reset-password-init -> admin déclenche un code de réinit
router.post('/users/:id/reset-password-init', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  try {
    const code = crypto.randomBytes(3).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    const iso = expires.toISOString().slice(0, 19).replace('T', ' ');
    await db.execute('DELETE FROM password_resets WHERE user_id = ?', [id]);
    await db.execute('INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)', [id, code, iso]);
    return res.json({ success: true, code, expires_at: iso });
  } catch (e) { return res.status(500).json({ error: 'Erreur serveur' }); }
});
