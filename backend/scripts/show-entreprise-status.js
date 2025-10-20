const db = require('../config/db');
let remote = null;
try { remote = require('../config/remoteDb'); } catch(e) { remote = null; }

async function main() {
  console.log('=== LOCAL stock_entreprise schema ===');
  try {
    const [info] = await db.query("PRAGMA table_info(stock_entreprise)");
    console.table(info);
  } catch(e) { console.warn('PRAGMA failed:', e.message || e); }

  console.log('=== LOCAL stock_entreprise rows ===');
  try {
    const [rows] = await db.query('SELECT id, name, global_code FROM stock_entreprise ORDER BY id');
    console.table(rows);
  } catch(e) { console.warn('Local select failed:', e.message || e); }

  if (!remote) {
    console.log('Remote pool not configured. Set REMOTE_DB_* in backend/.env to include remote status.');
    return;
  }
  let rconn;
  try {
    rconn = await remote.getConnection();
    console.log('=== REMOTE stock_entreprise rows ===');
    const [rrows] = await rconn.execute('SELECT id, name, global_code FROM stock_entreprise ORDER BY id');
    console.table(rrows);
  } catch(e) {
    console.warn('Remote select failed:', e.message || e);
  } finally { if (rconn) rconn.release(); }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });