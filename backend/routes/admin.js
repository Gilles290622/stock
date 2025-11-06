const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const crypto = require('crypto');
const remotePool = require('../config/remoteDb');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const { URL } = require('url');

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
    // Envoi email si SMTP configuré
    let sent = false;
    try {
      const [urows] = await db.execute('SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [id]);
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
    } catch (e) { /* noop */ }
    return res.json({ success: true, code, expires_at: iso, sent });
  } catch (e) { return res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/admin/users/:id — supprimer un utilisateur et ses données
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  try {
    // Empêcher la suppression de soi-même
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
    }
    // Protéger les comptes admin
    const [prows] = await db.execute('SELECT role FROM profiles WHERE user_id = ? LIMIT 1', [id]);
    if (prows.length && prows[0].role === 'admin') {
      return res.status(403).json({ error: 'Impossible de supprimer un compte administrateur' });
    }

    // Suppressions tolérantes (certaines tables peuvent ne pas exister en dev)
    const tryExec = async (sql, params=[]) => {
      try { await db.execute(sql, params); } catch (_e) { /* noop */ }
    };

    // 1) Paiements (références mouvements)
    await tryExec('DELETE FROM stock_paiements WHERE user_id = ?', [id]);
    // 2) Dépenses
    await tryExec('DELETE FROM stock_depenses WHERE user_id = ?', [id]);
    // 3) Mouvements
    await tryExec('DELETE FROM stock_mouvements WHERE user_id = ?', [id]);
    // 4) Clients & Désignations
    await tryExec('DELETE FROM stock_clients WHERE user_id = ?', [id]);
    await tryExec('DELETE FROM stock_designations WHERE user_id = ?', [id]);
    // 5) Resets de mot de passe
    await tryExec('DELETE FROM password_resets WHERE user_id = ?', [id]);
    // 6) Profil
    await tryExec('DELETE FROM profiles WHERE user_id = ?', [id]);
    // 7) Utilisateur
    await tryExec('DELETE FROM users WHERE id = ?', [id]);

    // Tentative miroir sur la base distante si configurée (online depuis le local)
    if (remotePool) {
      let rconn;
      try {
        rconn = await remotePool.getConnection();
        const rtry = async (sql, params=[]) => { try { await rconn.execute(sql, params); } catch (_) {} };
        // Protéger les comptes admin distants
        try {
          const [rprows] = await rconn.execute('SELECT role FROM profiles WHERE user_id = ? LIMIT 1', [id]);
          if (rprows.length && rprows[0].role === 'admin') {
            // ne pas supprimer l'admin distant
          } else {
            await rtry('DELETE FROM stock_paiements WHERE user_id = ?', [id]);
            await rtry('DELETE FROM stock_depenses WHERE user_id = ?', [id]);
            await rtry('DELETE FROM stock_mouvements WHERE user_id = ?', [id]);
            await rtry('DELETE FROM stock_clients WHERE user_id = ?', [id]);
            await rtry('DELETE FROM stock_designations WHERE user_id = ?', [id]);
            await rtry('DELETE FROM password_resets WHERE user_id = ?', [id]);
            await rtry('DELETE FROM profiles WHERE user_id = ?', [id]);
            await rtry('DELETE FROM users WHERE id = ?', [id]);
          }
        } catch (_) { /* ignore remote errors */ }
      } catch (_) { /* remote unreachable: ignore */ }
      finally { if (rconn) rconn.release(); }
    }

    res.json({ success: true, deleted_user_id: id });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/reconcile-users — supprime en local les comptes absents en ligne (MySQL)
// body: { dryRun?: boolean, mode?: 'delete' | 'deactivate' }
router.post('/reconcile-users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!remotePool) return res.status(501).json({ error: 'Base distante non configurée (REMOTE_DB_*)' });
    const dryRun = String(req.body?.dryRun || 'false').toLowerCase() === 'true';
    const mode = (req.body?.mode === 'deactivate') ? 'deactivate' : 'delete';

    // 1) Récupérer les IDs utilisateurs distants
    let rconn;
    let remoteIds = [];
    try {
      rconn = await remotePool.getConnection();
      const [rows] = await rconn.query('SELECT id FROM users ORDER BY id ASC');
      remoteIds = (rows || []).map(r => Number(r.id)).filter(n => Number.isInteger(n));
    } finally { if (rconn) rconn.release(); }

    // 2) Récupérer les IDs locaux
    const [lrows] = await db.execute('SELECT id FROM users ORDER BY id ASC');
    const localIds = (lrows || []).map(r => Number(r.id)).filter(n => Number.isInteger(n));

    // 3) Déterminer ceux à supprimer en local = local - remote
    const remoteSet = new Set(remoteIds);
    let toDelete = localIds.filter(id => !remoteSet.has(id));

    // Ne jamais supprimer soi-même ni les admins
    const selfId = Number(req.user.id);
    toDelete = toDelete.filter(id => id !== selfId);
    // Filtrer les admins
    if (toDelete.length) {
      const placeholders = toDelete.map(() => '?').join(',');
      try {
        const [prows] = await db.execute(`SELECT user_id, role FROM profiles WHERE user_id IN (${placeholders})`, toDelete);
        const adminSet = new Set((prows || []).filter(p => p.role === 'admin').map(p => Number(p.user_id)));
        toDelete = toDelete.filter(id => !adminSet.has(id));
      } catch (_) { /* ignore */ }
    }

    const result = { success: true, mode, dryRun, remoteCount: remoteIds.length, localCount: localIds.length, toDelete, deleted: [], deactivated: [], skipped: [] };
    if (dryRun || toDelete.length === 0) {
      return res.json(result);
    }

    // 4) Appliquer suppressions ou désactivation
    const tryExec = async (sql, params=[]) => { try { await db.execute(sql, params); } catch (_e) { /* noop */ } };
    for (const id of toDelete) {
      if (mode === 'deactivate') {
        try {
          await db.execute('UPDATE profiles SET status = ? WHERE user_id = ?', ['revoked', id]);
          result.deactivated.push(id);
        } catch (_) { result.skipped.push(id); }
        continue;
      }
      // Suppression en cascade (tolérante)
      await tryExec('DELETE FROM stock_paiements WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM stock_depenses WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM stock_mouvements WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM stock_clients WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM stock_designations WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM password_resets WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM profiles WHERE user_id = ?', [id]);
      await tryExec('DELETE FROM users WHERE id = ?', [id]);
      result.deleted.push(id);
    }

    return res.json(result);
  } catch (e) {
    console.error('[reconcile-users] error:', e?.message || e);
    return res.status(500).json({ error: 'Erreur serveur lors de la réconciliation' });
  }
});

// POST /api/admin/install-pack/publish
// Builds a password-protected payload zip and uploads it to Hostinger resources.
// Env:
//  - INSTALL_ZIP_PASSWORD: required password for 7z
//  - HOSTINGER_UPLOAD_KEY: shared secret matching PHP config upload_secret
//  - HOSTINGER_API_BASE: default https://jts-services.shop/stock/api
router.post('/install-pack/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const zipPassword = process.env.INSTALL_ZIP_PASSWORD || '';
    const uploadKey = process.env.HOSTINGER_UPLOAD_KEY || '';
    const apiBase = (process.env.HOSTINGER_API_BASE || 'https://jts-services.shop/stock/api').replace(/\/$/, '');
    if (!zipPassword) return res.status(500).json({ error: 'INSTALL_ZIP_PASSWORD manquant' });
    if (!uploadKey) return res.status(500).json({ error: 'HOSTINGER_UPLOAD_KEY manquant' });

    // 1) Build zip via PowerShell script
    const psFile = path.resolve(__dirname, '..', '..', 'scripts', 'make-payload-zip.ps1');
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}`;
    const outName = `stock_payload_${stamp}.zip`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, '-Password', zipPassword, '-Out', outName];
    const cwd = path.resolve(__dirname, '..', '..');

    const runPs = () => new Promise((resolve, reject) => {
      const proc = spawn('powershell', args, { cwd, windowsHide: true });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) return resolve({ stdout, stderr });
        return reject(new Error(`make-payload-zip.ps1 failed: code=${code}; stderr=${stderr}`));
      });
    });

    await runPs();
    const zipPath = path.resolve(__dirname, '..', '..', 'scripts', outName);
    if (!fs.existsSync(zipPath)) return res.status(500).json({ error: 'Zip non trouvé après construction' });
    const stat = fs.statSync(zipPath);

    // 1.b) Validation du mot de passe ZIP via 7-Zip (test d'intégrité)
    // Empêche l'upload d'une archive corrompue ou chiffrée avec un mot de passe différent.
    try {
      // Chercher 7z.exe (PATH ou emplacement standard)
      const sevenCandidates = [
        '7z',
        path.join(process.env['ProgramFiles'] || 'C:/Program Files', '7-Zip', '7z.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', '7-Zip', '7z.exe')
      ];
      let seven = null;
      for (const c of sevenCandidates) {
        try {
          // Pour '7z' nu, laisser spawn faire la résolution PATH
          if (c === '7z') {
            seven = '7z';
            break;
          } else if (fs.existsSync(c)) { seven = c; break; }
        } catch (_) {}
      }
      if (!seven) throw new Error('7-Zip introuvable pour validation (installer 7-Zip)');

      const testArgs = ['t', `-p${zipPassword}`, zipPath];
      const testResult = await new Promise((resolve, reject) => {
        const proc = spawn(seven, testArgs, { windowsHide: true });
        let out = '', err = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('error', reject);
        proc.on('close', code => {
          resolve({ code, out, err });
        });
      });
      if (testResult.code !== 0 || /Wrong password|Can not open encrypted archive/i.test(testResult.out + testResult.err)) {
        console.error('[install-pack/publish] zip password validation failed:', testResult.code, testResult.err || testResult.out);
        return res.status(500).json({ error: 'Validation mot de passe ZIP échouée (mot de passe incorrect ou archive corrompue).' });
      }
    } catch (ve) {
      console.error('[install-pack/publish] zip validation error:', ve?.message || ve);
      return res.status(500).json({ error: 'Impossible de valider l\'archive (7-Zip manquant ou erreur). ' + (ve?.message || '') });
    }

    // 2) Upload to PHP API as raw body
    const targetUrl = new URL(`${apiBase}/resources/upload-raw?filename=${encodeURIComponent(outName)}&key=${encodeURIComponent(uploadKey)}`);
    const mod = targetUrl.protocol === 'https:' ? https : http;
    const options = {
      method: 'POST',
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size
      },
      timeout: 300000 // 5 min
    };

    const upload = () => new Promise((resolve, reject) => {
      const reqh = mod.request(options, (resp) => {
        let body = '';
        resp.on('data', (d) => { body += d.toString(); });
        resp.on('end', () => {
          if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch { resolve({ ok: true, raw: body }); }
          } else {
            reject(new Error(`Upload failed: status=${resp.statusCode}; body=${body}`));
          }
        });
      });
      reqh.on('error', reject);
      reqh.on('timeout', () => { try { reqh.destroy(new Error('timeout')); } catch {} });
      const stream = fs.createReadStream(zipPath);
      stream.on('error', reject);
      stream.pipe(reqh);
    });

    const resp = await upload();
    const publicUrl = resp?.url ? (resp.url.startsWith('http') ? resp.url : `https://jts-services.shop${resp.url}`) : null;

    return res.json({ success: true, file: outName, size: stat.size, uploaded: !!publicUrl, url: publicUrl, apiResponse: resp });
  } catch (e) {
    console.error('[install-pack/publish] error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Erreur publication' });
  }
});
