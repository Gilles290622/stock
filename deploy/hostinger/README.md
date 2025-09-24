# Déploiement mutualisé (Hostinger ou similaire)

Ce guide permet d'héberger le frontend statique sur un mutualisé et d'utiliser un backend API séparé (VPS, PaaS, etc.). Sur un mutualisé classique, un process Node ne peut pas tourner en continu.

## 1) Préparer le frontend

- Si l'API est sur un autre domaine: créez `frontend/.env.production` avec:

```
VITE_API_BASE=https://api.jts-services.shop
```

- Si l'API est sous le même domaine en reverse proxy (ex: /api), laissez vide: axios utilisera des chemins relatifs.

- Build:

```bash
cd frontend
npm ci
npm run build
```

Le build apparaît dans `frontend/dist`.

## 2) Upload vers l'hébergement

- Copiez le contenu de `frontend/dist` dans `public_html/stock` (via FTP/manager de fichiers).
- Placez le `.htaccess` fourni (`deploy/hostinger/.htaccess`) dans `public_html/.htaccess`.

## 3) .htaccess

Ce fichier gère:
- Redirection de `/` vers `/stock/`
- Fallback SPA pour les routes React (toutes les routes front renvoient `index.html`)

```
RewriteEngine On

RewriteCond %{REQUEST_URI} ^/$
RewriteRule ^$ /stock/ [R=302,L]

RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule . - [L]

RewriteCond %{REQUEST_URI} ^/stock
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^stock/.* /stock/index.html [L]
```

## 4) Backend API

- Hébergez votre backend Node ailleurs (VPS, Render, Railway, etc.).
- Assurez le CORS si domaines différents (le repo active déjà `cors`).
- Configurez `VITE_API_BASE` côté frontend si l'API n'est pas sous le même domaine.

## 5) Vérifications

- Ouvrez `https://votre-domaine/` → redirige vers `/stock/`.
- Le site doit charger et appeler l'API via `VITE_API_BASE` si défini, sinon via `/api` relatif.

## 6) Astuces

- Activez SSL sur l'hébergement mutualisé.
- Cache des assets: Hostinger envoie déjà des headers par défaut; vous pouvez ajouter `Cache-Control` via `.htaccess` si nécessaire.
- Pour déployer de nouvelles versions: rebuild localement puis uploadez `dist`.
