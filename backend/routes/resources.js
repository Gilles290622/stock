const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Simple proxy endpoints to expose online resources to the local Admin UI
// GET /api/resources/list -> proxies to HOSTINGER_API_BASE/resources/list

function fetchJson(urlStr, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Accept': 'application/json' },
      timeout: timeoutMs
    }, (resp) => {
      let data = '';
      resp.on('data', (d) => { data += d.toString(); });
      resp.on('end', () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve([]); }
        } else {
          reject(new Error(`status ${resp.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} });
    req.end();
  });
}

router.get('/list', async (req, res) => {
  try {
    const base = (process.env.HOSTINGER_API_BASE || 'https://jts-services.shop/stock/api').replace(/\/$/, '');
    const url = `${base}/resources/list`;
    const out = await fetchJson(url);
    res.json(Array.isArray(out) ? out : []);
  } catch (e) {
    // Do not 404; return empty list to keep UI clean
    res.json([]);
  }
});

module.exports = router;
