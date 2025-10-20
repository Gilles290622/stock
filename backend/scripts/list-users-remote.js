#!/usr/bin/env node
// Liste les utilisateurs distants (MySQL) avec infos profil si disponibles
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const remotePool = require('../config/remoteDb');

(async () => {
  try {
    if (!remotePool) {
      console.error('Remote DB non configurée. Définissez REMOTE_DB_HOST, REMOTE_DB_USER, REMOTE_DB_PASSWORD, REMOTE_DB_NAME.');
      process.exit(2);
    }
    const conn = await remotePool.getConnection();
    try {
      let rows = [];
      try {
        const [withProfiles] = await conn.query(
          `SELECT u.id, u.full_name, u.email, u.created_at, p.username, p.role, p.status
             FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
            ORDER BY u.id ASC`
        );
        rows = withProfiles;
      } catch (e) {
        // Fallback si table profiles absente
        const [basic] = await conn.query('SELECT id, full_name, email, created_at FROM users ORDER BY id ASC');
        rows = basic.map(r => ({ ...r, username: null, role: null, status: null }));
      }
      if (!rows || rows.length === 0) {
        console.log('Aucun utilisateur distant trouvé.');
        return;
      }
      // Deduplicate by user id in case of multiple profile rows
      const byId = new Map();
      for (const u of rows) {
        if (!byId.has(u.id)) byId.set(u.id, u);
      }
      const uniq = Array.from(byId.values());

      console.log('id\tfull_name\temail\tusername\trole\tstatus\tcreated_at');
      for (const u of uniq) {
        console.log([
          u.id,
          u.full_name || '',
          u.email || '',
          u.username || '',
          u.role || '',
          u.status || '',
          u.created_at || ''
        ].join('\t'));
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Erreur lors de la lecture des utilisateurs distants:', e && (e.message || e));
    process.exit(1);
  }
})();
