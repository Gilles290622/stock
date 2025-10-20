<?php
// Config Hostinger (adapter aux valeurs de votre hébergement)
return [
  'db' => [
    'host' => getenv('REMOTE_DB_HOST') ?: 'localhost',
    'user' => getenv('REMOTE_DB_USER') ?: 'u313667830_caisse',
    'pass' => getenv('REMOTE_DB_PASSWORD') ?: 'changeme',
    'name' => getenv('REMOTE_DB_NAME') ?: 'u313667830_caisses',
    'port' => getenv('REMOTE_DB_PORT') ?: 3306,
    'ssl'  => (getenv('REMOTE_DB_SSL') ?: 'true') === 'true',
  ],
  'jwt_secret' => getenv('JWT_SECRET') ?: 'change-me',
  'app_version' => 'php-api-1.0.0'
];
