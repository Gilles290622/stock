import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Base configurable via env (VITE_BASE). Defaults to '/'.
  // For Hostinger subfolder deploy (public_html/stock), set VITE_BASE='/stock/'.
  const base = process.env.VITE_BASE || '/'
  return ({
    base,
    plugins: [react()],
    server: {
      host: true, // écoute sur toutes les interfaces (accès via nom d'hôte 'stock')
      port: 5173,
      strictPort: false,
      open: '/',
      allowedHosts: ['stock', 'fichiers', 'localhost'],
      proxy: {
        '/api': {
          // Use IPv4 to avoid ::1 (IPv6) resolution issues on some Windows setups
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 1000,
    }
  })
})