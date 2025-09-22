-- Example local setup (do not use in production)
-- Replace placeholders with your actual local credentials before running

-- CREATE DATABASE
CREATE DATABASE IF NOT EXISTS `jts_services_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- CREATE USER (replace password)
-- CREATE USER IF NOT EXISTS 'your_db_user'@'localhost' IDENTIFIED BY 'your_db_password';

-- GRANT PRIVILEGES
-- GRANT ALL PRIVILEGES ON `jts_services_db`.* TO 'your_db_user'@'localhost';
FLUSH PRIVILEGES;
