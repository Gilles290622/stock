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
- La base Vite est `/stock/` (vite.config.js) et le Router utilise `basename="/stock"`. Servez le frontend sous ce chemin ou ajustez `vite.config.js` et `App.jsx`.
- Servez le dossier `backend/uploads` en statique (déjà géré par le serveur Express).

### 5) Notes importantes
- Les appels API utilisent des chemins relatifs `/api/...` et une instance axios qui ajoute automatiquement le header `Authorization: Bearer <token>`.
- Pour la mise à jour du profil et l’upload du logo, l’authentification est requise.
- Les tables MySQL fournies sont un schéma minimal basé sur le code; adaptez les colonnes/contrôles à vos besoins.

### 6) Dépendances clés
- Backend: express@5, mysql2, bcrypt, jsonwebtoken, multer, cors, dotenv
- Frontend: react, vite, tailwindcss, @mui/material, @heroicons/react, axios
