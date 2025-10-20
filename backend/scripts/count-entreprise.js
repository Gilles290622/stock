#!/usr/bin/env node
// Prints count of rows in stock_entreprise and a sample of names
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

(async () => {
  try {
    const [rows] = await db.execute('SELECT COUNT(*) as c FROM stock_entreprise');
    const count = Array.isArray(rows) && rows.length ? (rows[0].c || rows[0].C || Object.values(rows[0])[0]) : 0;
    console.log('stock_entreprise.count =', count);
    const [sample] = await db.execute('SELECT id, name FROM stock_entreprise ORDER BY id ASC LIMIT 5');
    if (Array.isArray(sample) && sample.length) {
      console.log('sample:');
      for (const r of sample) console.log(`${r.id}\t${r.name}`);
    }
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
})();
