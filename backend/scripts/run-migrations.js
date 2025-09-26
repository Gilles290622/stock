#!/usr/bin/env node
// Simple migration runner for MySQL (and tolerant for empty)
// Usage: node scripts/run-migrations.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runMigrations } = require('./migrationsRunner');
const db = require('../config/db');

(async () => {
  const result = await runMigrations();
  if (result.error) {
    console.error('[migrate] EXIT WITH ERROR');
    process.exit(1);
  }
  try { await db.end(); } catch {}
})();
