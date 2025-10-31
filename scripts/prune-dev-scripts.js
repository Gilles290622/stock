#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'backend', 'scripts');
const targets = [
  'gen-token-raw.js',
  'grant-free-days.js',
  'hit-counts.js',
  'hit-search.js',
  'compare-local-remote.js',
  'cleanup-designations-by-annex.js',
  'count-clients-from-source.js',
  'count-clients.js',
  'count-entreprise-remote.js',
  'count-entreprise.js',
  'delete-designations-by-category.js',
  'delete-entreprise-local.js',
  'list-remote-tables.js',
  'list-tables.js',
  'remote-audit-global.js',
  'sync-clients-from-remote.js',
  'sync-entities-from-remote.js',
  'test-count.js',
  'test-create-mouvement.js',
  'test-login.js',
  'test-releve.js',
  'test-request.js',
  'test-sync-user6.js',
  'upsert-entreprise.js',
  'verify-scope.js',
  'pull_stream.txt',
  'push_stream.txt',
  'rs_after.json',
  'rs_before.json',
  'push_rs_after.json',
  'push_rs_before.json'
];

let deleted = 0;
for (const name of targets) {
  const p = path.join(base, name);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted++;
      console.log('deleted', p);
    }
  } catch (e) {
    console.warn('skip', p, e.message);
  }
}
console.log('total deleted =', deleted);
