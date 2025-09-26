#!/usr/bin/env node
// Ajoute stock_categories et la colonne categorie (FK) à stock_designations pour MySQL
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) {
    console.error('Veuillez définir DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
    process.exit(1);
  }
  const conn = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
  try {
    await conn.execute(`CREATE TABLE IF NOT EXISTS stock_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(190) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Ajouter colonne categorie si absente
    const [cols] = await conn.execute(`SHOW COLUMNS FROM stock_designations LIKE 'categorie'`);
    if (cols.length === 0) {
      await conn.execute(`ALTER TABLE stock_designations ADD COLUMN categorie INT NULL`);
      await conn.execute(`ALTER TABLE stock_designations ADD KEY idx_designations_categorie (categorie)`);
      try {
        await conn.execute(`ALTER TABLE stock_designations ADD CONSTRAINT fk_designations_categorie FOREIGN KEY (categorie) REFERENCES stock_categories(id) ON DELETE SET NULL`);
      } catch (_) {
        // Si la contrainte existe déjà, ignorer
      }
    }
    console.log('Migration MySQL categories appliquée.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
