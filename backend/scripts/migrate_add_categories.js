#!/usr/bin/env node
// Ajoute la table stock_categories et la colonne categorie (FK) à stock_designations
require('dotenv').config();
const path = require('path');
process.env.DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'app.sqlite');
const db = require('../config/db');

(async () => {
  try {
    // Créer stock_categories si absente
    await db.execute('CREATE TABLE IF NOT EXISTS stock_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)');

    // Vérifier colonne categorie dans stock_designations
    const [cols] = await db.query("SELECT name FROM pragma_table_info('stock_designations')");
    const hasCategorie = Array.isArray(cols) && cols.some(c => String(c.name) === 'categorie');
    if (!hasCategorie) {
      await db.execute('ALTER TABLE stock_designations ADD COLUMN categorie INTEGER NULL');
    }

    // Ajouter la contrainte FK si nécessaire (SQLite ne supporte pas ALTER TABLE ADD CONSTRAINT facilement) -> on s'appuie sur la logique applicative
    console.log('Migration categories appliquée.');
  } catch (e) {
    console.error('Migration categories échouée:', e && (e.message || e));
    process.exit(1);
  }
})();
