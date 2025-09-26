const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function runMigrations(options = {}) {
  const logs = [];
  const log = (...m) => { const line = m.join(' '); logs.push(line); console.log(line); };
  try {
    await ensureTable();
    const [rows] = await db.execute('SELECT name FROM migrations');
    const done = new Set(rows.map(r => r.name));
    const dir = path.join(__dirname, '..', 'sql', 'migrations');
    if (!fs.existsSync(dir)) {
      log('[migrate] No migrations directory, skipping');
      return { logs, applied: [], already: [], error: null };
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const applied = []; const already = [];
    for (const f of files) {
      if (done.has(f)) { log('[migrate] Already applied:', f); already.push(f); continue; }
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!sql.trim()) { log('[migrate] Empty file skip:', f); continue; }
      log('[migrate] Applying', f);
      try {
        await db.query(sql);
        await db.execute('INSERT INTO migrations (name) VALUES (?)', [f]);
        applied.push(f);
        log('[migrate] Success', f);
      } catch (e) {
        log('[migrate] Failed', f, e.message);
        return { logs, applied, already, error: e.message };
      }
    }
    log('[migrate] Done');
    return { logs, applied, already, error: null };
  } catch (e) {
    const msg = e.message || String(e);
    logs.push('[migrate] Fatal ' + msg);
    return { logs, applied: [], already: [], error: msg };
  }
}

module.exports = { runMigrations };