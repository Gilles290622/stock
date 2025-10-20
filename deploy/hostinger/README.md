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

Astuce sur la racine distante (RemoteRoot):

- Certains comptes FTP ouvrent directement dans `public_html` (chroot). Dans ce cas, considérez que la racine distante est `/` et non `/public_html`.
- Si votre compte FTP ouvre au-dessus de `public_html` (vous voyez le dossier `public_html` à côté d'autres dossiers), utilisez `/public_html`.
- Ne mélangez pas: si vous êtes déjà « dans » `public_html` et que vous envoyez dans `/public_html/stock`, vous obtiendrez un second dossier `public_html/public_html/...`.

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

## 7) Déploiement via script PowerShell

Le script `deploy/hostinger/sync-upload.ps1` accepte un paramètre `-RemoteRoot`:

- Utilisez `-RemoteRoot '/'` si votre connexion FTP atterrit déjà dans `public_html`.
- Utilisez `-RemoteRoot '/public_html'` si votre connexion atterrit au-dessus du dossier `public_html`.

Exemple (FTPS explicite, port 21):

```
powershell -File deploy/hostinger/sync-upload.ps1 -FtpHost "ftp.votre-domaine" -User "u123456" -AuthSecretText "<motdepasse>" -Protocol ftps -ExplicitTls -Port 21 -RemoteRoot "/" -UploadApi
```

## 6) Astuces

- Activez SSL sur l'hébergement mutualisé.
- Cache des assets: Hostinger envoie déjà des headers par défaut; vous pouvez ajouter `Cache-Control` via `.htaccess` si nécessaire.
- Pour déployer de nouvelles versions: rebuild localement puis uploadez `dist`.
