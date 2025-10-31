param(
  [string]$Url = "http://localhost/stock",
  [int]$WaitSeconds = 20
)
$ErrorActionPreference = 'SilentlyContinue'
function Test-Health($u){ try { $r = Invoke-WebRequest -Uri "$u/api/health" -UseBasicParsing -TimeoutSec 3; return $r.StatusCode -eq 200 } catch { return $false } }

$repo = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $repo

# Assurer la configuration du port 80 (si exécutable avec élévation)
$cfg80 = Join-Path $repo 'scripts\configure-port80.ps1'
if (Test-Path $cfg80) {
  try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$cfg80) -WindowStyle Hidden | Out-Null } catch {}
}

# Découvre navigateurs
$chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
if (-not (Test-Path $chrome)) { $chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' }
$edge = "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe" }

# 1) Vérifie si le backend tourne déjà (80 puis 3001)
$up = $false
foreach ($base in @('http://127.0.0.1','http://127.0.0.1:3001')) { if (Test-Health $base) { $up = $true; break } }

# 2) Si non, lance via start-pm2.ps1 en arrière-plan et ouvre un loader local immédiatement
if (-not $up) {
  $starter = Join-Path $repo 'scripts\start-pm2.ps1'
  if (Test-Path $starter) {
    Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File', $starter) | Out-Null
  } else {
    # Fallback: node backend/server.js (fenêtre cachée)
    $backend = Join-Path $repo 'backend'
    if (Test-Path (Join-Path $backend 'server.js')) {
      $cmd = 'cd "'+$backend+'"; $env:PORT="80"; $env:NODE_ENV="production"; $env:DB_DRIVER="sqlite"; $env:SQLITE_FILE="data/app.sqlite"; $env:DISABLE_REMOTE_REPLICATION="true"; node server.js'
      Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command', $cmd) | Out-Null
    }
  }

  # Ouvre un écran de chargement local (loader.html) qui redirige vers $Url quand l'API est up
  $loader = Join-Path $repo 'frontend\public\loader.html'
  if (Test-Path $loader) {
    $fileUrl = 'file:///' + ($loader -replace '\\','/')
    $qs = '?target=' + [Uri]::EscapeDataString($Url)
    if (Test-Path $chrome) { Start-Process -WindowStyle Hidden -FilePath $chrome -ArgumentList ("--app=" + $fileUrl + $qs) | Out-Null }
    elseif (Test-Path $edge) { Start-Process -WindowStyle Hidden -FilePath $edge -ArgumentList ("--app=" + $fileUrl + $qs) | Out-Null }
    else { Start-Process ($fileUrl + $qs) | Out-Null }
    return
  }

  # Si pas de loader, attendre un peu puis ouvrir directement l'URL
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  do {
    Start-Sleep -Milliseconds 800
    foreach ($base in @('http://127.0.0.1','http://127.0.0.1:3001')) { if (Test-Health $base) { $up = $true; break } }
  } while (-not $up -and (Get-Date) -lt $deadline)
}

# 3) Ouvre l'appli en mode application (Chrome/Edge)
if (Test-Path $chrome) {
  Start-Process -WindowStyle Hidden -FilePath $chrome -ArgumentList ("--app=" + $Url) | Out-Null
} elseif (Test-Path $edge) {
  Start-Process -WindowStyle Hidden -FilePath $edge -ArgumentList ("--app=" + $Url) | Out-Null
} else {
  Start-Process $Url | Out-Null
}
