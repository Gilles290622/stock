param(
  [string]$Target
)

$ErrorActionPreference = 'Stop'
function Write-Step($msg){ Write-Host "[update] $msg" -ForegroundColor Cyan }

# Résoudre la racine du projet (à partir de ce script)
$exeDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$candidates = @(
  $Target,
  $exeDir,
  (Split-Path -Parent $exeDir),
  (Split-Path -Parent (Split-Path -Parent $exeDir))
) | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Unique

$repo = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path (Join-Path $c 'backend\package.json'))) { $repo = $c; break }
}
if (-not $repo) { Write-Error "Impossible de localiser la racine du projet pour la mise à jour."; exit 1 }

function Test-Git { try { & git --version | Out-Null; return $true } catch { return $false } }
if (-not (Test-Git)) { Write-Error 'Git n\'est pas installé. Merci de relancer l\'installateur ou d\'installer Git for Windows.'; exit 1 }

Write-Step "Dépôt: $repo"

try {
  Write-Step 'Récupération des mises à jour (fetch)…'
  git -C $repo fetch --all --prune 2>$null | Out-Null
  Write-Step 'Application des mises à jour (pull --ff-only)…'
  git -C $repo pull --ff-only 2>$null | Out-Null
} catch { Write-Error "Echec git pull: $($_.Exception.Message)"; exit 1 }

# Mise à jour des dépendances backend si nécessaire
$backend = Join-Path $repo 'backend'
if (Test-Path (Join-Path $backend 'package.json')) {
  $npm = (Get-Command npm -ErrorAction SilentlyContinue).Path
  if (-not $npm) {
    $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (-not (Test-Path $npm)) { $npm = Join-Path $env:LOCALAPPDATA 'Programs\node\npm.cmd' }
  }
  if ($npm) {
    Push-Location $backend
    try {
      Write-Step 'Vérification des dépendances backend…'
      npm install --omit=dev 2>$null 1>$null
    } finally { Pop-Location }
  } else {
    Write-Step 'npm introuvable. Ignorer la mise à jour des dépendances.'
  }
}

Write-Host 'Mise à jour terminée.' -ForegroundColor Green
