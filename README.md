## Gestion de stock – Guide rapide local

### 1) Prérequis
- Node.js LTS (>=18)
- MySQL (>=8.0) avec un utilisateur et une base créée

### 2) Backend – Configuration
Créez un fichier `.env` dans `backend/` avec:

```
PORT=3001
JWT_SECRET=changez-moi-par-une-chaine-longue
DB_HOST=localhost
DB_USER=mon_user
DB_PASSWORD=mon_password
DB_NAME=ma_base
APP_URL=http://localhost:3001
```

Installez et lancez:

1. `cd backend`
2. `npm install`
3. Importez le schéma SQL: exécutez `backend/sql/001_init.sql` dans votre base MySQL
4. `npm start`

### 3) Frontend – Développement
```
cd frontend
npm install
npm run dev
```

Le projet Vite est configuré avec un proxy vers `http://localhost:3001` pour `/api` et `/uploads`. Accédez à l’appli via:

- Dev: http://localhost:5173/stock

### 4) Déploiement

### 5) Notes importantes

## Synchronisation automatique au démarrage

- À l’ouverture de l’application (utilisateur connecté non-admin), une synchronisation vers la base distante démarre automatiquement.
- Un écran de chargement pleine page affiche la progression, basée sur un flux SSE.
- Endpoint SSE: `GET /api/sync/push/progress` (auth via `?token=...`)
- Étapes poussées: `categories`, `clients`, `designations`, `mouvements`, `paiements`, `depenses`.

### 6) Dépendances clés
