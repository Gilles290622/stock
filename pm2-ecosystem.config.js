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
        PORT: 80
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
