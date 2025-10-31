<#!
Crée une archive protégée par mot de passe contenant l'application.
Usage:
  powershell -ExecutionPolicy Bypass -File scripts\make-payload-zip.ps1 -Password "MonMotDePasse" [-Out "stock_payload.zip"]
Notes:
  - Nécessite 7-Zip (7z.exe) dans le PATH ou installé dans C:\Program Files\7-Zip.
  - Exclut node_modules et dossiers IDE.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Password,
  [string]$Out = 'stock_payload.zip'
)

$ErrorActionPreference = 'Stop'
function Write-Step($m){ Write-Host "[zip] $m" -ForegroundColor Cyan }

# Racine du projet = dossier contenant backend\package.json
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$candidates = @(
  $here,
  (Split-Path -Parent $here),
  (Split-Path -Parent (Split-Path -Parent $here))
)
$repo = $null
foreach ($c in $candidates) { if ($c -and (Test-Path (Join-Path $c 'backend\package.json'))) { $repo = $c; break } }
if (-not $repo) { throw "Impossible de localiser la racine du projet (backend\\package.json)." }

function Get-7zPath {
  $paths = @(
    (Get-Command 7z -ErrorAction SilentlyContinue).Path,
    (Join-Path $env:ProgramFiles '7-Zip\\7z.exe'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip\\7z.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  return ($paths | Select-Object -First 1)
}
$seven = Get-7zPath
if (-not $seven) { throw '7-Zip (7z.exe) est requis pour créer un zip protégé.' }

# Fichier de sortie à côté de l'EXE (scripts/)
$outPath = Join-Path $here $Out

# Exclusions
$excludes = @(
  'node_modules',
  'frontend\\node_modules',
  'backend\\node_modules',
  '.git',
  '.vscode',
  '.idea',
  'scripts\\dist'
)

Write-Step "Création de l'archive protégée: $outPath"
Push-Location $repo
try {
  # Construire les arguments proprement pour éviter les erreurs d'échappement
  $args = @(
    'a', '-tzip', $outPath,
    ("-p$Password"), '-r', '.',
    '-x!node_modules', '-x!frontend/node_modules', '-x!backend/node_modules',
    '-x!.git', '-x!.vscode', '-x!.idea', '-x!scripts/dist',
    '-x!backend/data/*.sqlite', '-x!backend/logs/*', '-x!data/*.sqlite'
  )
  & $seven @args | Out-Null
} finally { Pop-Location }

Write-Host "OK: $outPath" -ForegroundColor Green
