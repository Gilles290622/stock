#!/usr/bin/env node
// Verify that API responses are scoped to a given user by calling endpoints with a JWT
// Usage: node scripts/verify-scope.js --id 6

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const jwt = require('jsonwebtoken');
const db = require('../config/db');

function parseArgs() {
  const out = { id: 6, base: null };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--id') out.id = parseInt(args[++i], 10);
    else if (a === '--base') out.base = String(args[++i]);
  }
  return out;
}

async function getUserMeta(id) {
  try {
    const [rows] = await db.query(
      'SELECT u.email, p.username FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.id = ? LIMIT 1',
      [id]
    );
    if (rows && rows[0]) return { email: rows[0].email, username: rows[0].username };
  } catch (e) {
    // ignore
  }
  return {};
}

async function main() {
  const { id, base: baseArg } = parseArgs();
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant dans backend/.env');

  const meta = await getUserMeta(id);
  const payload = { id, email: meta.email, username: meta.username };
  const token = jwt.sign(payload, secret, { expiresIn: '5m' });

  const base = baseArg || process.env.VERIFY_BASE || 'http://stock';
  const headers = { Authorization: `Bearer ${token}` };

  const j = async (res) => {
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return txt; }
  };

  // Node 18+ has global fetch
  const countRes = await fetch(`${base}/api/clients/count`, { headers });
  const count = await j(countRes);
  console.log('clients/count =>', count);

  const listRes = await fetch(`${base}/api/clients`, { headers });
  const list = await j(listRes);
  console.log('clients (first 3) =>', Array.isArray(list) ? list.slice(0, 3) : list);

  if (Array.isArray(list) && list.length > 0) {
    const cid = list[0].id;
    // sanity: ensure client exists
    const cliRes = await fetch(`${base}/api/clients/${cid}`, { headers });
    console.log(`clients/${cid} status =>`, cliRes.status);
    const relRes = await fetch(`${base}/api/clients/${cid}/releve`, { headers });
    const relTxt = await relRes.text();
    let relParsed; try { relParsed = JSON.parse(relTxt); } catch { relParsed = relTxt; }
    console.log(`clients/${cid}/releve status =>`, relRes.status);
    console.log(`clients/${cid}/releve body (first 3) =>`, Array.isArray(relParsed) ? relParsed.slice(0,3) : relParsed);
  }

  // Designations checks
  const dCountRes = await fetch(`${base}/api/designations/count`, { headers });
  const dCount = await j(dCountRes);
  console.log('designations/count =>', dCount);

  const dListRes = await fetch(`${base}/api/designations`, { headers });
  const dList = await j(dListRes);
  console.log('designations (first 3) =>', Array.isArray(dList) ? dList.slice(0, 3) : dList);

  if (Array.isArray(dList) && dList.length > 0) {
    const did = dList[0].id;
    const dGetRes = await fetch(`${base}/api/designations/${did}`, { headers });
    console.log(`designations/${did} status =>`, dGetRes.status);
  }
}

main()
  .catch((e) => { console.error('verify-scope error:', e?.message || e); process.exit(1); })
  .finally(async () => { try { if (db && db.end) await db.end(); } catch {} });
