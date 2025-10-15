<#
  Démarre l'application via PM2 au logon utilisateur.
  - Tente pm2 resurrect si une sauvegarde existe (pm2 save)
  - Sinon démarre via pm2-ecosystem.config.js (backend sur port 80)
  - Le frontend est servi statiquement par le backend (frontend/dist), pas de Vite preview
  - Exécute en fenêtre cachée si lancé via le Planificateur de tâches
#>

$ErrorActionPreference = 'Continue'

# --- Journalisation vers un fichier pour diagnostiquer le démarrage planifié ---
$logDir = Join-Path $env:LOCALAPPDATA 'StockApp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ('autostart_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')
$global:__TranscriptStarted = $false
try { Start-Transcript -Path $logFile -Force | Out-Null; $global:__TranscriptStarted = $true } catch {}

function Write-Log($msg){
  $stamp = (Get-Date).ToString('s')
  Write-Host "[autostart] $stamp $msg"
}

try {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $repo = Split-Path -Parent $here
  Set-Location $repo
  Write-Log "Repo: $repo | Here: $here | User: $env:USERNAME"

  # Résoudre node/npm/pm2 via chemins explicites si PATH est incomplet dans la tâche planifiée
  $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Path
  if (-not $nodeCmd) {
    $candidates = @(
      (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\node\node.exe')
    )
    foreach ($p in $candidates) { if (Test-Path $p) { $nodeCmd = $p; break } }
  }
  if ($nodeCmd) { Write-Log "node: $nodeCmd" } else { Write-Log 'node non trouvé dans PATH ni emplacements courants' }

  $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Path
  if (-not $npmCmd) {
    $candNpm = @(
      (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
      (Join-Path $env:LOCALAPPDATA 'Programs\node\npm.cmd')
    )
    foreach ($p in $candNpm) { if (Test-Path $p) { $npmCmd = $p; break } }
  }
  if ($npmCmd) { Write-Log "npm: $npmCmd" } else { Write-Log 'npm non trouvé' }

  $pm2Cmd = (Get-Command pm2 -ErrorAction SilentlyContinue).Path
  if (-not $pm2Cmd -and $npmCmd) {
    Write-Log "pm2 non trouvé, tentative d'installation globale via npm..."
    try { & $npmCmd install -g pm2 | Out-Null } catch { Write-Log "npm install pm2 a échoué: $($_.Exception.Message)" }
    $pm2Cmd = (Get-Command pm2 -ErrorAction SilentlyContinue).Path
  }
  if ($pm2Cmd) { Write-Log "pm2: $pm2Cmd" }

  if ($pm2Cmd) {
    # Restaurer les process sauvegardés (si pm2 save a été fait)
    try { & $pm2Cmd resurrect | Out-Null; Write-Log 'pm2 resurrect exécuté' } catch { Write-Log "pm2 resurrect erreur: $($_.Exception.Message)" }

    # Vérifier si le backend est connu; sinon démarrer via ecosystem
    $list = ''
    try { $list = (& $pm2Cmd list --no-color | Out-String) } catch {}
    Write-Log 'pm2 list:'
    Write-Host $list
    if ($list -notmatch 'stock-backend') {
      Write-Log 'Démarrage via pm2-ecosystem.config.js'
      try { & $pm2Cmd start pm2-ecosystem.config.js --update-env | Out-Null } catch { Write-Log "pm2 start erreur: $($_.Exception.Message)" }
    } else {
      Write-Log 'Backend déjà présent dans pm2, tentative de restart'
      try { & $pm2Cmd restart stock-backend --update-env | Out-Null } catch { Write-Log "pm2 restart erreur: $($_.Exception.Message)" }
    }

    # Sauvegarder l'état pour les prochains boots
    try { & $pm2Cmd save | Out-Null; Write-Log 'pm2 save OK' } catch { Write-Log "pm2 save erreur: $($_.Exception.Message)" }
  } else {
    # Fallback: lancer directement Node si pm2 indisponible
    Write-Log 'Fallback sans pm2: lancement direct backend'
    $backendDir = Join-Path $repo 'backend'
    $serverJs = Join-Path $backendDir 'server.js'
    if (-not (Test-Path $serverJs)) { Write-Log "server.js introuvable: $serverJs"; throw 'server.js introuvable' }
    $env:PORT = '80'
    if ($nodeCmd) {
      Write-Log "Start-Process node direct: $nodeCmd | cwd=$backendDir"
      try {
        Start-Process -WindowStyle Hidden -FilePath $nodeCmd -WorkingDirectory $backendDir -ArgumentList 'server.js'
      } catch { Write-Log "Start-Process node erreur: $($_.Exception.Message)" }
    } else {
      # Dernier recours: via PowerShell + PATH courant
      Write-Log 'Start-Process via PowerShell (node dans PATH espéré)'
      try { Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @('-NoProfile', '-Command', 'cd "' + $backendDir + '"; node server.js') } catch { Write-Log "Start-Process PowerShell erreur: $($_.Exception.Message)" }
    }
  }
} catch {
  Write-Log ("Exception non gérée: " + ($_.Exception.Message))
} finally {
  if ($global:__TranscriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
}
