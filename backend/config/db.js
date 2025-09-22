const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test connexion au démarrage (optionnel, mais utile pour logs)
pool.getConnection()
  .then((connection) => {
    console.log('DB Pool connected successfully to', process.env.DB_NAME);
    connection.release();  // Libère la connexion
  })
  .catch((err) => {
    console.error('DB Pool connection error:', err.message);
  });

module.exports = pool;