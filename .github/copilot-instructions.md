# Instructions pour les Agents de Codage IA

Ce document fournit des lignes directrices essentielles pour les agents de codage IA travaillant sur ce projet. Il vise à faciliter une compréhension rapide de l'architecture, des flux de travail et des conventions spécifiques à cette base de code.

## 1. Architecture Générale

Le projet est une application de gestion de stock composée de trois composants principaux :

*   **Frontend (React + Vite)**: Une Single Page Application (SPA) développée avec React et Vite.
    *   **Déploiement**: Servie sous le chemin `/stock` en production (Hostinger).
    *   **Communication**: Utilise `axios` pour les appels API REST et `EventSource` pour les flux SSE (Server-Sent Events) de synchronisation.
    *   **Fichiers clés**: `frontend/src/`, `frontend/vite.config.js`.

*   **Backend (Node.js + Express)**: Le serveur principal gérant la logique métier et la persistance des données.
    *   **Base de données locale**: SQLite (`backend/data/app.sqlite`).
    *   **Base de données distante (optionnel)**: MySQL, utilisée pour la réplication.
    *   **Authentification**: JWT (JSON Web Tokens).
    *   **Synchronisation**: Implémente des endpoints SSE pour la réplication des données (push local -> distant, pull distant -> local).
    *   **Serveur web**: Sert l'API et les assets statiques du frontend. Fonctionne sur le port 80 (via PM2 en prod) ou 3001 (en dev).
    *   **Fichiers clés**: `backend/server.js`, `backend/routes/`, `backend/config/db.js`, `backend/config/remoteDb.js`, `pm2-ecosystem.config.js`.

*   **API PHP (Hostinger)**: Une API PHP minimale déployée sur Hostinger sous `/stock/api`.
    *   **Fonctionnalité**: Gère les opérations CRUD pour `stockFlux`, `stockMouvements`, les comptes, la recherche, l'authentification (`/login`, `/register`, `/me`) et les informations d'entreprise.
    *   **Réplication**: **Ne contient PAS de logique de réplication des données**. La synchronisation est gérée par le backend Node.js.
    *   **Fichiers clés**: `deploy/hostinger/php-api/index.php`.

### Flux de Données et Synchronisation

*   **Local (Node/SQLite) <-> Distant (PHP/MySQL)**: La synchronisation est unidirectionnelle ou bidirectionnelle selon l'opération.
*   **Pull (Distant -> Local)**: L'importation des données depuis la base distante vers la base locale est **non destructive** (utilise des opérations d'upsert). Les données sont scopées par `user_id` et `global_id` (pour l'entreprise).
*   **Push (Local -> Distant)**: La publication des données locales vers la base distante utilise également des upserts.
*   **`global_id`**: Un identifiant d'entreprise utilisé pour scoper les données (clients, désignations, mouvements) à une entité commerciale spécifique. Il est crucial pour les requêtes de comptage et de listing.

## 2. Flux de Travail et Commandes Clés

*   **Démarrage du développement local**:
    *   Backend (Node.js): `cd backend; npm start` (ou via PM2 pour le port 80).
    *   Frontend (React/Vite): `cd frontend; npm run dev`.
*   **Construction du Frontend**: `cd frontend; npm run build`.
*   **Scripts de Synchronisation (Backend)**:
    *   `backend/scripts/run-pull-verify.js`: Vérifie l'importation (distant -> local).
    *   `backend/scripts/run-push-verify.js`: Vérifie la publication (local -> distant).
    *   `backend/scripts/run-pull-all-users.js`: Importe les données pour tous les utilisateurs distants.
    *   `backend/scripts/backfill-global-id.js`: Renseigne le `global_id` pour les données locales existantes d'un utilisateur.
    *   `backend/scripts/gen-token.js`: Génère un JWT pour un utilisateur donné.

## 3. Conventions et Patterns Spécifiques

*   **Endpoints API**: Toutes les routes API commencent par `/api/`.
*   **Authentification**: Utilisation de JWT. Le token est passé via le header `Authorization: Bearer <token>` ou via le paramètre de requête `?token=<token>`.
*   **SSE**: Les opérations de synchronisation de longue durée utilisent Server-Sent Events pour fournir une progression en temps réel. Les événements `start`, `progress`, `error` et `done` sont envoyés.
*   **Format de Date**: Le backend utilise `YYYY-MM-DD`. Le frontend peut afficher `JJ/MM/AAAA` mais doit convertir pour les requêtes API.
*   **Gestion des Erreurs**: Les réponses API en cas d'erreur sont au format JSON avec les champs `error` et/ou `message`.
*   **Scoping des Données**: Les données (clients, désignations, mouvements) sont scopées par `user_id` et `global_id` (entreprise). Assurez-vous que ces champs sont correctement gérés lors des opérations CRUD et de synchronisation.

## 4. Points d'Intégration et Dépendances Externes

*   **Base de données**: Le backend Node.js se connecte à SQLite localement et peut se connecter à MySQL à distance. L'API PHP se connecte uniquement à MySQL.
*   **PM2**: Utilisé pour gérer les processus Node.js en production (notamment pour servir sur le port 80).
*   **Hostinger**: Environnement de déploiement de l'API PHP et des assets frontend.

## 5. Fichiers et Répertoires Clés

*   `backend/`: Contient le code du serveur Node.js.
    *   `backend/routes/sync.js`: Logique principale de synchronisation SSE.
    *   `backend/config/db.js`: Configuration de la base de données locale.
    *   `backend/config/remoteDb.js`: Configuration de la base de données distante.
    *   `backend/scripts/`: Scripts utilitaires pour la gestion et la vérification.
*   `frontend/`: Contient le code de l'application React.
    *   `frontend/src/api/sync.js`: Client SSE pour le frontend.
    *   `frontend/src/components/StockMouvements.jsx`: Composant principal de l'interface utilisateur, incluant les boutons de synchronisation.
*   `deploy/hostinger/php-api/index.php`: Fichier principal de l'API PHP.
*   `pm2-ecosystem.config.js`: Configuration PM2 pour le déploiement Node.js.

---
Veuillez me faire part de vos commentaires si des sections sont peu claires ou incomplètes, afin que je puisse les améliorer.
