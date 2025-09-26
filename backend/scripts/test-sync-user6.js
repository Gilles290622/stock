#!/usr/bin/env node
/**
 * Script de test automatisé de la réplication pour l'utilisateur 6.
 *
 * Etapes:
 *  1. Crée un mouvement (waitRemote=1) avec désignation & client uniques
 *  2. Vérifie la réponse (remote.success)
 *  3. Interroge /api/sync/check/mouvement/:id
 *  4. Si absent: tente /api/sync/push/mouvement/:id puis re-vérifie
 *  5. Affiche un récapitulatif
 *
 * Usage:
 *   node scripts/test-sync-user6.js
 *   node scripts/test-sync-user6.js --token AUTRE_TOKEN
 *   JWT_TOKEN=xxx node scripts/test-sync-user6.js
 *
 * NOTE: Le token par défaut ci-dessous est celui que tu as fourni. Il expirera.
 *       Remplace-le si nécessaire ou passe --token.
 */
const http = require('http');

// === Token fourni (user id = 6). Peut être expiré; remplacé si --token ou env JWT_TOKEN ===
const EMBEDDED_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NiwiZW1haWwiOiJiYW5rb2xlZGlkaWVyQGdtYWlsLmNvbSIsInVzZXJuYW1lIjoiYm9ndmV0IiwiaWF0IjoxNzU4NzQ2MjE5LCJleHAiOjE3NTg3NTM0MTl9.cFoR075OmZKDVFAbDLERKnr7IsZYISzzgQdJqqL2-OE';

function parseArgs(argv){
  const cfg = { token: process.env.JWT_TOKEN || EMBEDDED_TOKEN, host: 'localhost', port: 3001 };
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a === '--token' && argv[i+1]) { cfg.token = argv[++i]; continue; }
    if (a === '--host' && argv[i+1]) { cfg.host = argv[++i]; continue; }
    if (a === '--port' && argv[i+1]) { cfg.port = parseInt(argv[++i],10); continue; }
  }
  if (!cfg.token) throw new Error('Token JWT requis');
  return cfg;
}

function httpRequest({method='GET', path, token, bodyObj, host, port}) {
  return new Promise((resolve, reject)=> {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'Accept':'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({ host, port, path, method, headers }, (res)=>{
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=>{
        let parsed = null;
        try { parsed = JSON.parse(data); } catch(_) {}
        resolve({ status: res.statusCode, headers: res.headers, raw: data, json: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main(){
  const cfg = parseArgs(process.argv);
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const suffix = Date.now().toString().slice(-6);
  const designation = `TEST_SYNC_${suffix}`;
  const client = `CLIENT_SYNC_${suffix}`;

  console.log('--- Test réplication user 6 ---');
  console.log('Date:', dateStr);
  console.log('Designation:', designation);
  console.log('Client:', client);

  // 1) Création du mouvement avec attente remote
  const createRes = await httpRequest({
    method: 'POST',
    path: `/api/stockMouvements?waitRemote=1`,
    token: cfg.token,
    host: cfg.host,
    port: cfg.port,
    bodyObj: {
      date: dateStr,
      type: 'entree',
      designation_name: designation,
      quantite: 2,
      prix: 100,
      client_name: client
    }
  });

  console.log('\n[CREATE] status', createRes.status);
  console.log(JSON.stringify(createRes.json, null, 2));
  if (createRes.status !== 201) {
    console.error('Echec création mouvement, arrêt.');
    process.exit(1);
  }
  const movId = createRes.json.id;

  // 2) Vérification check
  const check1 = await httpRequest({
    path: `/api/sync/check/mouvement/${movId}`,
    token: cfg.token,
    host: cfg.host,
    port: cfg.port
  });
  console.log('\n[CHECK 1] status', check1.status);
  console.log(JSON.stringify(check1.json, null, 2));

  let finalPresent = check1.json && check1.json.present;

  // 3) Si absent, tenter push/mouvement/:id puis re-check
  if (!finalPresent) {
    console.log('\n[PUSH RETRY] mouvement absent, tentative push unitaire ...');
    const pushRes = await httpRequest({
      method: 'POST',
      path: `/api/sync/push/mouvement/${movId}`,
      token: cfg.token,
      host: cfg.host,
      port: cfg.port
    });
    console.log('[PUSH RETRY] status', pushRes.status, pushRes.json ? JSON.stringify(pushRes.json, null, 2) : pushRes.raw);

    const check2 = await httpRequest({
      path: `/api/sync/check/mouvement/${movId}`,
      token: cfg.token,
      host: cfg.host,
      port: cfg.port
    });
    console.log('\n[CHECK 2] status', check2.status);
    console.log(JSON.stringify(check2.json, null, 2));
    finalPresent = check2.json && check2.json.present;
  }

  console.log('\n=== Résumé ===');
  console.log('Mouvement ID:', movId);
  console.log('Présent distant:', finalPresent);
  if (createRes.json && createRes.json.remote && createRes.json.remote.success === false) {
    console.log('Erreur initiale remote:', createRes.json.remote.error);
  }
  if (!finalPresent) {
    console.log('\nConseil: vérifier /api/sync/replication-errors avec un token user 7.');
  }
}

main().catch(e=>{ console.error('Echec test-sync-user6:', e.stack || e.message); process.exit(1); });
