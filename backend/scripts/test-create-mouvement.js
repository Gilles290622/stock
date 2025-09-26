#!/usr/bin/env node
/**
 * Helper script to create a test mouvement with waitRemote=1 and print response.
 * Usage:
 *   node scripts/test-create-mouvement.js --token YOUR_JWT \
 *        --date 2025-09-24 --type entree --designation "TEST SYNC" \
 *        --quantite 2 --prix 100 --client "CLIENT SYNC"
 *
 * Token can also be provided via env JWT_TOKEN.
 */
const http = require('http');

function parseArgs(argv){
  const out = { date: new Date().toISOString().slice(0,10), type: 'entree', designation: 'TEST SYNC', quantite: 1, prix: 0, client: 'CLIENT SYNC', token: process.env.JWT_TOKEN || null, host: 'localhost', port: 3001 };
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a === '--token' && argv[i+1]) { out.token = argv[++i]; continue; }
    if (a === '--date' && argv[i+1]) { out.date = argv[++i]; continue; }
    if (a === '--type' && argv[i+1]) { out.type = argv[++i]; continue; }
    if (a === '--designation' && argv[i+1]) { out.designation = argv[++i]; continue; }
    if (a === '--quantite' && argv[i+1]) { out.quantite = parseInt(argv[++i],10); continue; }
    if (a === '--prix' && argv[i+1]) { out.prix = parseInt(argv[++i],10); continue; }
    if (a === '--client' && argv[i+1]) { out.client = argv[++i]; continue; }
    if (a === '--host' && argv[i+1]) { out.host = argv[++i]; continue; }
    if (a === '--port' && argv[i+1]) { out.port = parseInt(argv[++i],10); continue; }
  }
  if (!out.token) throw new Error('JWT token requis ( --token ou env JWT_TOKEN )');
  return out;
}

async function main(){
  const cfg = parseArgs(process.argv);
  const body = JSON.stringify({
    date: cfg.date,
    type: cfg.type,
    designation_name: cfg.designation,
    quantite: cfg.quantite,
    prix: cfg.prix,
    client_name: cfg.client
  });

  const options = {
    host: cfg.host,
    port: cfg.port,
    path: '/api/stockMouvements?waitRemote=1',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${cfg.token}`
    }
  };

  await new Promise((resolve,reject)=>{
    const req = http.request(options, (res)=>{
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=>{
        try {
          console.log('Status:', res.statusCode);
          const json = JSON.parse(data || '{}');
            console.log(JSON.stringify(json, null, 2));
        } catch(e){
          console.log(data);
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main().catch(e=>{ console.error('Echec test-create-mouvement:', e.message); process.exit(1); });
