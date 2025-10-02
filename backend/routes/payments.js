const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { createPaymentIntent, verifyWebhookSignature } = require('../utils/wave');
const authenticateToken = require('../middleware/auth');

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute('SELECT role FROM profiles WHERE user_id = ? LIMIT 1', [userId]);
    if (!rows.length || rows[0].role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    next();
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
}

// Admin: initiate a Wave payment intent for a user
router.post('/wave/initiate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id, amount = 7000, currency = 'XOF', phone = '+2250747672761' } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id requis' });
    const intent = await createPaymentIntent({ amount, currency, phone });
    // record pending
    await db.execute(
      `INSERT INTO subscriptions_payments (user_id, amount, currency, phone, provider, reference, status)
       VALUES (?, ?, ?, ?, 'wave', ?, 'pending')`,
      [user_id, parseInt(amount, 10), currency, phone, intent.reference]
    );
    res.json({ success: true, reference: intent.reference });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// Public webhook endpoint for Wave callbacks
router.post('/wave/webhook', express.json(), async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) return res.status(401).end();
    const event = req.body || {};
    const reference = event.reference;
    const status = event.status || 'succeeded';
    // lookup payment
    const [rows] = await db.execute('SELECT user_id FROM subscriptions_payments WHERE reference = ? LIMIT 1', [reference]);
    if (!rows.length) return res.status(404).end();
    const userId = rows[0].user_id;
    await db.execute('UPDATE subscriptions_payments SET status = ? WHERE reference = ?', [status, reference]);
    if (status === 'succeeded') {
      // extend subscription by 1 month
      const [p] = await db.execute('SELECT subscription_expires FROM profiles WHERE user_id = ? LIMIT 1', [userId]);
      const now = new Date();
      let base = now;
      if (p.length && p[0].subscription_expires) {
        const cur = new Date(p[0].subscription_expires);
        if (!isNaN(cur) && cur > now) base = cur;
      }
      const next = new Date(base);
      next.setMonth(next.getMonth() + 1);
      const iso = next.toISOString().slice(0, 19).replace('T', ' ');
      await db.execute('UPDATE profiles SET subscription_expires = ?, status = ? WHERE user_id = ?', [iso, 'active', userId]);
    }
    res.json({ received: true });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// User-side: initiate a Wave payment intent for self
router.post('/wave/initiate/self', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { amount = 7000, currency = 'XOF', phone } = req.body || {};
    // fallback phone: from profile if available
    let phoneRes = phone;
    if (!phoneRes) {
      try { const [p] = await db.execute('SELECT phone_number FROM users WHERE id = ? LIMIT 1', [user_id]); phoneRes = p.length ? (p[0].phone_number || '+2250747672761') : '+2250747672761'; } catch { phoneRes = '+2250747672761'; }
    }
    const intent = await createPaymentIntent({ amount, currency, phone: phoneRes });
    await db.execute(
      `INSERT INTO subscriptions_payments (user_id, amount, currency, phone, provider, reference, status)
       VALUES (?, ?, ?, ?, 'wave', ?, 'pending')`,
      [user_id, parseInt(amount, 10), currency, phoneRes, intent.reference]
    );
    res.json({ success: true, reference: intent.reference });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
