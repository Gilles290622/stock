<#
 Script PowerShell pour démarrer automatiquement backend + frontend.
 Utilisation:
   1. Ouvrir PowerShell
   2. Exécuter:  ./start-all.ps1
 Option: ajouter un raccourci dans le dossier Démarrage Windows.
#>

param(
  [switch]$Prod
)

Write-Host "== Lancement projet STOCK ==" -ForegroundColor Cyan

$backendPath = Join-Path $PSScriptRoot 'backend'
$frontendPath = Join-Path $PSScriptRoot 'frontend'

if (-not (Test-Path $backendPath)) { Write-Error "Backend introuvable"; exit 1 }
if (-not (Test-Path $frontendPath)) { Write-Error "Frontend introuvable"; exit 1 }

if ($Prod) {
  Write-Host "Mode production via PM2" -ForegroundColor Yellow
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Error "PM2 non installé. Exécutez: npm install -g pm2"; exit 1
  }
  pm2 start pm2-ecosystem.config.js
  pm2 save
  pm2 status
  Write-Host "Accès front (preview vite): http://localhost:4173" -ForegroundColor Green
} else {
  Write-Host "Mode développement (Vite + Node)" -ForegroundColor Yellow
  Start-Process powershell -ArgumentList "-NoProfile","-Command","cd `"$backendPath`"; node server.js" -WindowStyle Minimized
  Start-Process powershell -ArgumentList "-NoProfile","-Command","cd `"$frontendPath`"; npm run dev" -WindowStyle Minimized
  Write-Host "Backend: http://localhost:3000 (si c'est le port utilisé)" -ForegroundColor Green
  Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
}

Write-Host "Terminé." -ForegroundColor Cyan
