#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function sseToFile(url, outPath, ms = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const ws = fs.createWriteStream(outPath);
      res.pipe(ws);
      const timer = setTimeout(() => {
        try { req.destroy(); } catch {}
        try { ws.end(); } catch {}
        resolve();
      }, ms);
      res.on('error', (e) => { clearTimeout(timer); ws.end(); reject(e); });
    });
    req.on('error', reject);
  });
}

(async () => {
  try {
    const argv = process.argv.slice(2);
    let baseArg = null;
    for (let i = 0; i < argv.length; i++) { if (argv[i] === '--base' && argv[i+1]) { baseArg = argv[i+1]; i++; } }
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET missing');
    const token = jwt.sign({ id: 7 }, secret, { expiresIn: '2h' });
    const base = baseArg || `http://127.0.0.1:${process.env.PORT || 3001}`;

    const before = await get(`${base}/api/sync/remote-summary?token=${encodeURIComponent(token)}`);
    fs.writeFileSync(path.join(__dirname, 'push_rs_before.json'), before.body, 'utf8');

    await sseToFile(`${base}/api/sync/push/progress?token=${encodeURIComponent(token)}`,
      path.join(__dirname, 'push_stream.txt'), 15000);

    const after = await get(`${base}/api/sync/remote-summary?token=${encodeURIComponent(token)}`);
    fs.writeFileSync(path.join(__dirname, 'push_rs_after.json'), after.body, 'utf8');

    console.log('REMOTE-SUMMARY BEFORE (PUSH):', before.body);
    console.log('--- PUSH SSE (first 20 lines) ---');
    try {
      const lines = fs.readFileSync(path.join(__dirname, 'push_stream.txt'), 'utf8').split(/\r?\n/).slice(0, 20);
      for (const l of lines) console.log(l);
    } catch {}
    console.log('REMOTE-SUMMARY AFTER (PUSH):', after.body);
  } catch (e) {
    console.error('run-push-verify error:', e && (e.stack || e.message) || e);
    process.exit(1);
  }
})();
