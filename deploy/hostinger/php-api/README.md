Déploiement d'une version en ligne sans Node (hébergement mutualisé Hostinger)

Objectif: Servir le frontend en statique (Vite build) et une petite API PHP connectée à MySQL pour les fonctions essentielles, sans processus Node.

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

Limites actuelles (peuvent être étendues):
- Endpoints implémentés:
  - POST /api/login
  - GET  /api/me
  - GET  /api/version
  - GET  /api/clients/count
  - GET  /api/designations/count
  - GET  /api/clients/search?q=...
  - GET  /api/designations/search?q=...
  - GET  /api/stockFlux?date=YYYY-MM-DD
- Endpoints d’écriture (création/suppression) non inclus pour l’instant. Vous pouvez continuer d’utiliser le poste local (Node + SQLite) et la réplication vers MySQL distant.

Conseils:
- Utilisez le même JWT_SECRET que votre backend Node pour compatibilité des tokens (ou laissez l’API PHP générer ses propres tokens).
- Pensez à créer les tables MySQL côté Hostinger (le schéma doit correspondre à celui attendu par l’app).
