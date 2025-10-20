let remote = null;
try { remote = require('../config/remoteDb'); } catch(e) { remote = null; }

async function main() {
  if (!remote) {
    console.error('[seed-remote-global-code] Remote DB non configurée. Définissez REMOTE_DB_* dans backend/.env');
    process.exit(2);
  }
  let conn;
  try {
    conn = await remote.getConnection();
    const [rows] = await conn.execute('SELECT id, name, global_code FROM stock_entreprise ORDER BY id');
    let upd = 0;
    for (const r of rows) {
      if (r.global_code == null || Number(r.global_code) !== Number(r.id)) {
        await conn.execute('UPDATE stock_entreprise SET global_code = ? WHERE id = ?', [r.id, r.id]);
        upd++;
        console.log('[seed-remote-global-code] set %s global_code=%s', r.name, r.id);
      }
    }
    console.log('[seed-remote-global-code] done. updates=%d', upd);
  } finally { if (conn) conn.release(); }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error(e?.message || e); process.exit(1); });