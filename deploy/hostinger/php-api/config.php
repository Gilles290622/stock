<?php
// Config Hostinger (adapter aux valeurs de votre hébergement)
return [
  'db' => [
    // NOTE: Do NOT commit real credentials. These fall back to env vars or placeholders.
    'host' => getenv('REMOTE_DB_HOST') ?: 'localhost',
    'user' => getenv('REMOTE_DB_USER') ?: 'db_user',
    'pass' => getenv('REMOTE_DB_PASSWORD') ?: 'db_pass',
    'name' => getenv('REMOTE_DB_NAME') ?: 'db_name',
    'port' => getenv('REMOTE_DB_PORT') ?: 3306,
    'ssl'  => (getenv('REMOTE_DB_SSL') ?: 'true') === 'true',
  ],
  'jwt_secret' => getenv('JWT_SECRET') ?: 'change-me',
  // Secret optionnel pour l'upload de ressources (si pas de JWT admin). Définir via env UPLOAD_SECRET.
  'upload_secret' => getenv('UPLOAD_SECRET') ?: '',
  'app_version' => 'php-api-1.0.0'
];
