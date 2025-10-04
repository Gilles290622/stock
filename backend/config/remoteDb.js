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
      connectTimeout: 8000
    };
    if (String(REMOTE_DB_SSL || '').toLowerCase() === 'true') {
      cfg.ssl = { rejectUnauthorized: false };
    }
    pool = mysql.createPool(cfg);
    // Light async validation without throwing fatal errors
    (async () => {
      let conn;
      try {
        conn = await pool.getConnection();
        // Quick ping
        await conn.query('SELECT 1');
        // Optional: ensure entreprise column
        try {
          const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'entreprise'");
          if (!Array.isArray(cols) || cols.length === 0) {
            try {
              await conn.query("ALTER TABLE users ADD COLUMN entreprise VARCHAR(255) NULL AFTER full_name");
              console.log('[remoteDb] Colonne entreprise ajoutée sur la base distante');
            } catch (alterErr) {
              console.warn('[remoteDb] ALTER entreprise ignoré:', alterErr?.message || alterErr);
            }
          }
        } catch (colCheckErr) {
          console.warn('[remoteDb] Column check entreprise ignoré:', colCheckErr?.message || colCheckErr);
        }
      } catch (pingErr) {
        console.warn('[remoteDb] Ping distant échoué (continuation en mode local):', pingErr?.message || pingErr);
      } finally { if (conn) conn.release(); }
    })();
  } catch (e) {
    console.warn('Remote DB pool init skipped:', e?.message || e);
    pool = null;
  }
}

module.exports = pool;
