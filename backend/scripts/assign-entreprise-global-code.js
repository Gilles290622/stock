const pool = require('../config/db');
let remotePool = null;
try { remotePool = require('../config/remoteDb'); } catch (e) { remotePool = null; }

async function main() {
  if (!remotePool) {
    console.error('[assign-global-code] Remote DB non configurée. Définissez REMOTE_DB_* dans backend/.env');
    process.exitCode = 1;
    return;
  }
  const [locals] = await pool.query('SELECT id, name, global_code FROM stock_entreprise ORDER BY id');
  let updates = 0, inserts = 0;
  for (const row of locals) {
    const name = (row.name || '').trim();
    if (!name) continue;
    if (row.global_code != null) {
      continue;
    }
    let rconn;
    try {
      rconn = await remotePool.getConnection();
      const [re] = await rconn.execute('SELECT id FROM stock_entreprise WHERE name = ? LIMIT 1', [name]);
      let remoteId;
      if (re.length) {
        remoteId = re[0].id;
      } else {
        const [ins] = await rconn.execute('INSERT INTO stock_entreprise (name) VALUES (?)', [name]);
        remoteId = ins.insertId;
        inserts++;
      }
      await pool.execute('UPDATE stock_entreprise SET global_code = ? WHERE id = ?', [remoteId, row.id]);
      updates++;
      console.log('[assign-global-code] set local.%s global_code=%s', name, remoteId);
    } catch (e) {
      console.warn('[assign-global-code] échec pour %s: %s', row.name, e?.message || e);
    } finally { if (rconn) rconn.release(); }
  }
  console.log('[assign-global-code] terminé. updates=%d inserts_remote=%d', updates, inserts);
}

main().then(()=>process.exit(0)).catch((e)=>{ console.error(e); process.exit(1); });