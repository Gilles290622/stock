#!/usr/bin/env node
const url = process.argv[2] || 'http://stock/api/login';
const identifier = process.argv[3] || 'user6@local';
const password = process.argv[4] || 'password123';

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const text = await res.text();
    console.log('status =', res.status);
    try { console.log(JSON.parse(text)); } catch { console.log(text); }
  } catch (e) {
    console.error('test-login error:', e?.message || e);
    process.exit(1);
  }
})();
