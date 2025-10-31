#!/usr/bin/env node
/**
 * Restaure les données locales pour TOUS les utilisateurs présents sur la base distante,
 * en lançant pour chacun l'import non destructif via l'endpoint SSE
 *   GET /api/sync/pull-general/progress?token=...
 *
 * Usage:
 *   node backend/scripts/run-pull-all-users.js --base http://127.0.0.1
 *   node backend/scripts/run-pull-all-users.js --base http://127.0.0.1 --filter 1,7,12
 */
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const remotePool = require('../config/remoteDb');

function parseArgs(argv) {
  const out = { base: null, filter: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i+1]) { out.base = argv[++i]; continue; }
    if (a === '--filter' && argv[i+1]) { out.filter = String(argv[++i]); continue; }
  }
  return out;
}

function ssePullOnce(baseUrl, userId, token) {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}/api/sync/pull-general/progress?token=${encodeURIComponent(token)}`;
    const req = http.get(url, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const payload = line.replace(/^data:\s*/, '');
            try {
              const obj = JSON.parse(payload);
              if (obj?.step && obj?.status) {
                const lbl = obj.label || obj.step;
                const resu = obj.result || {};
                const moved = (typeof resu.pulled === 'number') ? `${resu.pulled} importés` : (typeof resu.sent === 'number' ? `${resu.sent} envoyés` : '');
                const before = resu.remoteBefore ?? resu.localBefore;
                const after = resu.remoteAfter ?? resu.localAfter;
                const ba = (typeof before === 'number' && typeof after === 'number') ? ` (${before}${before===after?'↔':'→'}${after})` : '';
                console.log(`[user ${userId}] ${lbl} (${obj.status}) ${moved}${ba}`);
              } else if (obj?.message) {
                console.log(`[user ${userId}] info:`, obj.message);
              } else if (obj?.success !== undefined) {
                console.log(`[user ${userId}] done: success=${obj.success}`);
                resolve();
              }
            } catch {}
          }
        }
      });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
  });
}

(async () => {
  try {
    if (!remotePool) throw new Error('Base distante non configurée');
    const { base, filter } = parseArgs(process.argv);
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
    const baseUrl = base || `http://127.0.0.1:${PORT}`;
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET manquant');

    let ids = [];
    const rconn = await remotePool.getConnection();
    try {
      const [rows] = await rconn.query('SELECT id FROM users ORDER BY id ASC');
      ids = rows.map(r => Number(r.id)).filter(n => Number.isInteger(n) && n > 0);
    } finally { rconn.release(); }

    if (filter) {
      const set = new Set(String(filter).split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n > 0));
      ids = ids.filter(id => set.has(id));
    }
    if (!ids.length) { console.log('Aucun utilisateur distant trouvé.'); return; }

    console.log(`Utilisateurs à traiter: ${ids.join(', ')}`);
    for (const userId of ids) {
      const token = jwt.sign({ id: userId }, secret, { expiresIn: '2h' });
      console.log(`\n==> Import utilisateur ${userId}…`);
      try {
        await ssePullOnce(baseUrl, userId, token);
      } catch (e) {
        console.error(`Erreur import user ${userId}:`, e?.message || e);
      }
    }
    console.log('\nTerminé.');
  } catch (e) {
    console.error('run-pull-all-users error:', e?.message || e);
    process.exit(1);
  }
})();
