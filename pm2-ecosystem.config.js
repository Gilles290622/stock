module.exports = {
  apps: [
    {
      name: 'stock-backend',
      cwd: './backend',
      script: 'server.js',
      node_args: '--env-file=.env',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: 80,
        // Force local SQLite for the running API (counts and lists will reflect local DB)
        DB_DRIVER: 'sqlite',
        SQLITE_FILE: './data/app.sqlite'
      }
    },
    {
      name: 'stock-frontend',
      cwd: './frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview',
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
