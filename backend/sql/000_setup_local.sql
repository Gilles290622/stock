-- Script d'initialisation locale (création DB + utilisateur + droits)
-- Paramètres basés sur backend/.env
-- DB_NAME: jts_services_db
-- DB_USER: jts_user
-- DB_PASSWORD: Jtservices29@

-- 1) Créer la base si elle n'existe pas
CREATE DATABASE IF NOT EXISTS `jts_services_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2) Créer l'utilisateur local si nécessaire
CREATE USER IF NOT EXISTS 'jts_user'@'localhost' IDENTIFIED BY 'Jtservices29@';

-- 3) Accorder les droits sur la base
GRANT ALL PRIVILEGES ON `jts_services_db`.* TO 'jts_user'@'localhost';

-- 4) Appliquer
FLUSH PRIVILEGES;
