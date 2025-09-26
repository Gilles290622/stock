# Production & Déploiement

## Build front + service statique via backend

1. Depuis la racine (Windows PowerShell):
```
cd frontend
npm install
npm run build
cd ..\backend
npm install
```
2. Vérifier que le dossier `frontend/dist` existe.
3. Lancer le backend: `node server.js` (il servira le front sous `/stock`).

## Script global

Un script `npm run prod` peut être ajouté à la racine pour:
- Construire le frontend
- Copier ou vérifier la présence du build
- Démarrer le backend

## PM2 (production multi-process / survie crash)

Exemple:
```
pm2 start pm2-ecosystem.config.js --env production
pm2 status
pm2 logs
```

Pour sauvegarder la liste et activer le redémarrage auto:
```
pm2 save
pm2 startup
```
Suivre les instructions affichées après `pm2 startup` pour enregistrer le service.

## Variables d'environnement

Créer `backend/.env` (jamais commité) avec:
```
PORT=3001
JWT_SECRET=change_me
APP_URL=https://votre-domaine
REMOTE_DB_HOST=...
REMOTE_DB_USER=...
REMOTE_DB_PASSWORD=...
REMOTE_DB_NAME=...
```

## Sécurité minimale
- Garder `JWT_SECRET` secret et long (>=32 chars)
- Ajuster CORS si front sur un autre domaine
- Mettre en place un reverse proxy (Nginx / Caddy) pour TLS et compression

## Restauration / Migration
- Sauvegarder SQLite périodiquement (backend/data/app.sqlite)
- Vérifier réplication MySQL avec endpoints `/api/sync/remote-status` et `/api/sync/replication-errors`

## Génération factures
- `InvoiceModal` convertit le logo en base64 pour résilience (print & PDF)
- Option "Sans filigrane" pour version client

## Logs & diagnostic réplication
- Consulter `/api/sync/replication-errors` (erreurs)
- Un endpoint futur pourra exposer tout le log (info + error)

---
(README généré automatiquement – adapter selon vos besoins)