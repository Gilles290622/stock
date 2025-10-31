const path = require('path');

module.exports = {
  apps: [
    {
      name: 'stock-backend',
      // Use absolute cwd so PM2 can resolve node_modules even when started from Task Scheduler
      cwd: path.resolve(__dirname, 'backend'),
      script: 'server.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: 80,
        // Force local SQLite for the running API (counts and lists will reflect local DB)
        DB_DRIVER: 'sqlite',
        SQLITE_FILE: './data/app.sqlite'
      }
    },
    // Frontend is served statically by the backend from frontend/dist.
    // Remove separate Vite preview to avoid exposing localhost:4173.
  ]
};
