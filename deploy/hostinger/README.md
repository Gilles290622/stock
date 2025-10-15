# Déploiement mutualisé (Hostinger ou similaire) — variante sous-dossier `/stock`

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
- Placez le `.htaccess` « racine » fourni (`deploy/hostinger/root/.htaccess`) dans `public_html/.htaccess`.
- Placez le `.htaccess` « stock » fourni (`deploy/hostinger/stock/.htaccess`) dans `public_html/stock/.htaccess`.

## 3) .htaccess

Fichiers fournis:

- `public_html/.htaccess` (copier depuis `deploy/hostinger/root/.htaccess`)
	- Redirige `/` vers `/stock/`
	- Route `/api/*` vers `/stock/api/index.php`

- `public_html/stock/.htaccess` (copier depuis `deploy/hostinger/stock/.htaccess`)
	- Route `/stock/api/*` vers `/stock/api/index.php`
	- Fallback SPA dans le sous-dossier `/stock`

## 4) Backend API (options)

- Option A (sans Node): utilisez l’API PHP fournie dans `deploy/hostinger/php-api/` en la copiant dans `public_html/stock/api/` (ou `public_html/api/` si vous placez le site à la racine). Éditez `config.php` avec vos identifiants MySQL et un `jwt_secret` solide.
- Option B (avec Node externe): hébergez votre backend Node ailleurs (VPS, Render, Railway…). Dans ce cas, définissez `VITE_API_BASE` pour pointer vers ce backend et assurez le CORS.

## 5) Vérifications

- Ouvrez `https://votre-domaine/` → redirige vers `/stock/`.
- Le site doit charger et appeler l'API via `VITE_API_BASE` si défini, sinon via `/api` relatif.

## 6) Astuces

- Activez SSL sur l'hébergement mutualisé.
- Cache des assets: Hostinger envoie déjà des headers par défaut; vous pouvez ajouter `Cache-Control` via `.htaccess` si nécessaire.
- Pour déployer de nouvelles versions: rebuild localement puis uploadez `dist`.
