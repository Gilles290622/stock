#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/db');

function parseArgs(argv){
  const out = { name: '' };
  for (let i=2;i<argv.length;i++){
    const a = String(argv[i]);
    if (a === '--name') { out.name = String(argv[i+1] || '').trim(); i++; continue; }
    if (a.startsWith('--name=')) { out.name = a.split('=')[1]; continue; }
    if (!out.name && !a.startsWith('--')) out.name = a;
  }
  return out;
}

(async () => {
  try {
    const { name } = parseArgs(process.argv);
    if (!name) { console.error('Usage: node scripts/delete-entreprise-local.js --name="NAME"'); process.exit(2); }
    const [before] = await db.execute('SELECT id FROM stock_entreprise WHERE name = ?', [name]);
    await db.execute('DELETE FROM stock_entreprise WHERE name = ?', [name]);
    console.log('Deleted', (before||[]).length, 'row(s) with name =', name);
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
})();
