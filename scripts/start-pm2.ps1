<#
  Démarre l'application via PM2 au logon utilisateur.
  - Tente pm2 resurrect si une sauvegarde existe (pm2 save)
  - Sinon démarre via pm2-ecosystem.config.js (backend sur port 80)
  - Le frontend est servi statiquement par le backend (frontend/dist), pas de Vite preview
  - Exécute en fenêtre cachée si lancé via le Planificateur de tâches
#>

$ErrorActionPreference = 'SilentlyContinue'
try {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $repo = Split-Path -Parent $here
  Set-Location $repo

  $pm2Cmd = (Get-Command pm2 -ErrorAction SilentlyContinue).Path
  if (-not $pm2Cmd) {
    Write-Host '[autostart] pm2 non trouvé, tentative d\'installation globale...'
    try { npm install -g pm2 | Out-Null } catch {}
    $pm2Cmd = (Get-Command pm2 -ErrorAction SilentlyContinue).Path
  }

  if ($pm2Cmd) {
    Write-Host '[autostart] Utilisation de pm2: ' $pm2Cmd
    # Essaye de restaurer les process sauvegardés
    try { pm2 resurrect | Out-Null } catch {}
    # Vérifie si le backend tourne, sinon démarre via l'ecosystem
    $list = pm2 list | Out-String
    if ($list -notmatch 'stock-backend') {
      pm2 start pm2-ecosystem.config.js --update-env | Out-Null
    } else {
      # Assure que le backend est en ligne
      try { pm2 restart stock-backend --update-env | Out-Null } catch {}
    }
    # Sauvegarde l'état pour les prochains boots
    try { pm2 save | Out-Null } catch {}
  } else {
    # Fallback: lancer directement Node si pm2 indisponible
    Write-Host '[autostart] Fallback sans pm2: lancement direct backend'
    $env:PORT = '80'
    Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @('-NoProfile', '-Command', 'cd "' + (Join-Path $repo 'backend') + '"; node server.js')
  }
} catch {}
