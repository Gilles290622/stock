#!/usr/bin/env node
// Stream /api/sync/pull-general/progress until 'done' and print progress in console.
// Usage: node backend/scripts/run-pull-until-done.js --base http://127.0.0.1

const http = require('http');
const urlLib = require('url');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

function parseArgs(argv) {
  const out = { base: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i+1]) { out.base = argv[++i]; continue; }
  }
  return out;
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const { base } = parseArgs(process.argv);
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET manquant');
    const token = jwt.sign({ id: 7 }, jwtSecret, { expiresIn: '2h' });
    const baseUrl = base || `http://127.0.0.1:${PORT}`;

    const before = await get(`${baseUrl}/api/sync/remote-summary?token=${encodeURIComponent(token)}`);
    console.log('REMOTE-SUMMARY BEFORE:', before.body);

    const sseUrl = `${baseUrl}/api/sync/pull-general/progress?token=${encodeURIComponent(token)}`;
    await new Promise((resolve, reject) => {
      const req = http.get(sseUrl, (res) => {
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          // keep last partial line
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('event:')) {
              const ev = line.replace(/^event:\s*/, '');
              if (ev === 'progress') {
                // next line should be data:
                // ignore here; we'll rely on separate data lines too
              } else if (ev === 'done') {
                console.log('event: done');
                resolve();
              } else if (ev === 'error') {
                // Let data line print the error message
              }
            } else if (line.startsWith('data:')) {
              const payload = line.replace(/^data:\s*/, '');
              try {
                const obj = JSON.parse(payload);
                if (obj?.step && obj?.status) {
                  const lbl = obj.label || obj.step;
                  const resu = obj.result || {};
                  const sent = (typeof resu.pulled === 'number') ? `${resu.pulled} importés` : (typeof resu.sent === 'number' ? `${resu.sent} envoyés` : '');
                  const before = resu.remoteBefore ?? resu.localBefore;
                  const after = resu.remoteAfter ?? resu.localAfter;
                  const ba = (typeof before === 'number' && typeof after === 'number') ? ` (${before}${before===after?'↔':'→'}${after})` : '';
                  console.log(`progress: ${lbl} (${obj.status}) ${sent}${ba}`);
                } else if (obj?.message) {
                  console.log('info:', obj.message);
                }
              } catch {
                // raw data
                if (payload) console.log('data:', payload);
              }
            }
          }
        });
        res.on('end', () => resolve());
      });
      req.on('error', reject);
    });

    const after = await get(`${baseUrl}/api/sync/remote-summary?token=${encodeURIComponent(token)}`);
    console.log('REMOTE-SUMMARY AFTER:', after.body);
  } catch (e) {
    console.error('run-pull-until-done error:', e?.message || e);
    process.exit(1);
  }
})();
