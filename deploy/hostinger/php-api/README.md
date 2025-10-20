Déploiement d'une version en ligne sans Node (hébergement mutualisé Hostinger)

Objectif: Servir le frontend en statique (Vite build) et une API PHP connectée à MySQL pour les fonctions essentielles, sans processus Node.

Structure:
- public_html/
  - index.html, assets/... (contenu de frontend/dist)
  - .htaccess (réécritures pour l’API)
   - api/
    - index.php (routeur + handlers)
    - config.php (paramètres DB + JWT)

Étapes:
1) Builder le frontend en local
   - Dans frontend/: npm run build
   - Uploader le contenu de frontend/dist/ vers public_html/ (écraser les fichiers existants si nécessaire)

2) Configurer l’API PHP
   - Copier le dossier deploy/hostinger/php-api/ dans public_html/api/
   - Éditer public_html/api/config.php et renseigner vos identifiants MySQL Hostinger et le JWT_SECRET (même que côté Node si vous voulez réutiliser les tokens)

3) Réécriture d’URL
   - Placer le .htaccess fourni à la racine public_html/ (ou fusionner avec le vôtre) pour router /api/* vers api/index.php
   - IMPORTANT: Assurer que l’en-tête Authorization est bien transmis à PHP (le .htaccess fourni le gère via HTTP_AUTHORIZATION)

Endpoints principaux:
- Auth
   - POST /api/login
   - GET  /api/me
   - GET  /api/version
   - GET  /api/db-ping
- Référentiels
   - GET  /api/clients/search?q=...
   - GET  /api/clients
   - GET  /api/clients/:id
   - POST /api/clients
   - GET  /api/designations/search?q=...
   - GET  /api/designations
   - GET  /api/designations/:id
   - POST /api/designations
- Flux & opérations
   - GET  /api/stockFlux?date=YYYY-MM-DD
   - POST /api/stockMouvements
   - PATCH /api/stockMouvements/:id
   - DELETE /api/stockMouvements/:id
   - GET  /api/stockPaiements
   - POST /api/stockPaiements
   - PATCH /api/stockPaiements/:id
   - POST /api/upload-logo

Conseils:
- Utilisez le même JWT_SECRET que votre backend Node pour compatibilité des tokens (ou laissez l’API PHP générer ses propres tokens).
- Pensez à créer les tables MySQL côté Hostinger (le schéma doit correspondre à celui attendu par l’app).
- Après déploiement, vérifiez:
   - GET /stock/api/version → 200
   - Authentification (POST /stock/api/login), puis un appel protégé avec Authorization: Bearer <token> (ex: /stock/api/designations/search)
   - Création d’un mouvement (POST /stock/api/stockMouvements) et mise à jour du stock courant sur la désignation
