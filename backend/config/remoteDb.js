const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Optional remote MySQL pool for replication (Hostinger)
// Configure with REMOTE_DB_HOST, REMOTE_DB_USER, REMOTE_DB_PASSWORD, REMOTE_DB_NAME
// Optionally REMOTE_DB_SSL=true to enable basic SSL

let pool = null;

const {
  REMOTE_DB_HOST,
  REMOTE_DB_USER,
  REMOTE_DB_PASSWORD,
  REMOTE_DB_NAME,
  REMOTE_DB_SSL
} = process.env;

if (REMOTE_DB_HOST && REMOTE_DB_USER && REMOTE_DB_PASSWORD && REMOTE_DB_NAME) {
  try {
    const mysql = require('mysql2/promise');
    const cfg = {
      host: REMOTE_DB_HOST,
      user: REMOTE_DB_USER,
      password: REMOTE_DB_PASSWORD,
      database: REMOTE_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    };
    if (String(REMOTE_DB_SSL || '').toLowerCase() === 'true') {
      cfg.ssl = { rejectUnauthorized: false };
    }
    pool = mysql.createPool(cfg);
    // Lazy test on use; no throw here to avoid crashing local-only runs
    ;(async () => {
      // Auto-migration légère: ajouter colonne 'entreprise' si manquante
      try {
        const conn = await pool.getConnection();
        try {
          const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'entreprise'");
          if (!Array.isArray(cols) || cols.length === 0) {
            await conn.query("ALTER TABLE users ADD COLUMN entreprise VARCHAR(255) NULL AFTER full_name");
            console.log('[remoteDb] Colonne entreprise ajoutée sur la base distante');
          }
        } finally { conn.release(); }
      } catch (e) {
        // Ne pas bloquer si absence de droits ou table manquante
        console.warn('[remoteDb] Auto-migration entreprise ignorée:', e?.message || e);
      }
    })();
  } catch (e) {
    console.warn('Remote DB pool init skipped:', e?.message || e);
    pool = null;
  }
}

module.exports = pool;
