const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DRIVER = (process.env.DB_DRIVER || 'mysql').toLowerCase();

if (DRIVER === 'sqlite' || DRIVER === 'sqlite3') {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  // Resolve SQLITE_FILE relative to backend root (.. from config/) when it's not absolute,
  // so running from different cwd (pm2 vs scripts) points to the same file.
  const configured = process.env.SQLITE_FILE;
  const file = configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(path.join(__dirname, '..'), configured))
    : path.join(__dirname, '..', 'data', 'app.sqlite');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(file);
  // Activer les clés étrangères
  db.pragma('foreign_keys = ON');

  // Auto-init du schéma si nécessaire (crée les tables à partir de sql/001_init.sqlite.sql)
  try {
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!hasUsers) {
      const schemaPath = path.join(__dirname, '..', 'sql', '001_init.sqlite.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        db.exec(schemaSql);
        console.log('SQLite schema initialized from', schemaPath);
      } else {
        console.warn('Schema file not found:', schemaPath);
      }
    }
  } catch (e) {
    console.error('SQLite schema init error:', e && (e.message || e));
  }

  // Adapter qui imite l'API mysql2/promise utilisée dans le code
  const adapter = {
    async getConnection() {
      let inTx = false;
      return {
        async beginTransaction() {
          db.exec('BEGIN');
          inTx = true;
        },
        async commit() {
          if (inTx) db.exec('COMMIT');
          inTx = false;
        },
        async rollback() {
          if (inTx) db.exec('ROLLBACK');
          inTx = false;
        },
        async execute(sql, params = []) {
          const trimmed = sql.trim().toLowerCase();
          if (trimmed.startsWith('select') || trimmed.startsWith('pragma')) {
            const rows = db.prepare(sql).all(params);
            return [rows];
          } else {
            const info = db.prepare(sql).run(params);
            return [{ insertId: Number(info.lastInsertRowid) || 0, affectedRows: info.changes }];
          }
        },
        async query(sql, params = []) {
          // mysql2 returns [rows] for SELECT; align that shape
          return this.execute(sql, params);
        },
        release() {
          // no-op for sqlite
        }
      };
    },
    async execute(sql, params = []) {
      const conn = await this.getConnection();
      try { return await conn.execute(sql, params); } finally { conn.release(); }
    },
    async query(sql, params = []) {
      const conn = await this.getConnection();
      try { return await conn.query(sql, params); } finally { conn.release(); }
    }
  };

  console.log('SQLite connected:', file);
  module.exports = adapter;
} else {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Test connexion au démarrage (optionnel, mais utile pour logs)
  pool.getConnection()
    .then((connection) => {
      console.log('MySQL Pool connected successfully to', process.env.DB_NAME);
      connection.release();
    })
    .catch((err) => {
      console.error('DB Pool connection error:', err.message);
    });

  // Harmoniser l'API avec l'adapter sqlite
  pool.execute = pool.execute.bind(pool);
  pool.getConnection = pool.getConnection.bind(pool);
  module.exports = pool;
}