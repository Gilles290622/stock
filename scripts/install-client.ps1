<#!
Installe l'application sur un poste client.
- Copie le projet vers C:\JTS-Stock (par défaut) ou D:\JTS-Stock
- Installe les dépendances backend (en production)
- Crée deux raccourcis sur le Bureau:
  • JTS Stock (Local) -> http://localhost/stock (démarre le backend au besoin)
  • JTS Stock (En ligne) -> https://jts-services.shop/stock
#>
[CmdletBinding()]
param(
  [ValidateSet('C','D')]
  [string]$Drive = 'C',
  [string]$FolderName = 'JTS-Stock',
  [switch]$SkipNpm,
  [string]$Password,
  [string]$PayloadZip,
  [string]$ZipPassword
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg){ Write-Host "[install] $msg" -ForegroundColor Cyan }

# 0) Protection par mot de passe (simple)
if (-not $Password) { $Password = Read-Host -Prompt 'Entrer le mot de passe d''installation' }
if ($Password -ne 'Gilles296183@') { Write-Error 'Mot de passe invalide.'; exit 1 }

# 1) Résolution chemins
# Déterminer la racine du projet automatiquement même si l'EXE est dans scripts/dist
$exeDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$candidates = @(
  $exeDir,
  (Split-Path -Parent $exeDir),
  (Split-Path -Parent (Split-Path -Parent $exeDir))
)
$repo = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path (Join-Path $c 'backend\package.json'))) { $repo = $c; break }
}
if (-not $PayloadZip) {
  # Chercher un zip par défaut à côté de l'exe
  $defaultZip = Join-Path $exeDir 'stock_payload.zip'
  if (Test-Path $defaultZip) { $PayloadZip = $defaultZip }
}

# Déterminer le mode: zip (si présent) sinon copie locale sinon clonage
$mode = if ($PayloadZip -and (Test-Path $PayloadZip)) { 'zip' } elseif ($repo) { 'copy' } else { 'clone' }

$target = Join-Path ("$Drive`:") $FolderName
switch ($mode) {
  'zip'   { Write-Step "Source: archive protégée -> $PayloadZip" }
  'copy'  { Write-Step "Source: $repo" }
  'clone' { Write-Step "Source: GitHub (clone)" }
}
Write-Step "Cible:  $target"

# 2) Créer cible
New-Item -ItemType Directory -Force -Path $target | Out-Null

# 3) Déployer les fichiers selon le mode
if ($mode -eq 'copy') {
  $robolog = Join-Path $env:TEMP ('install_robocopy_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')
  $excludeDirs = @('node_modules','frontend\node_modules','backend\node_modules','.vscode','.idea')
  $excludeFiles = @('*.ps1xml','*.map')
  $xd = $excludeDirs | ForEach-Object { '/XD', (Join-Path $repo $_) }
  $xf = $excludeFiles | ForEach-Object { '/XF', $_ }
  $roboArgs = @($repo, $target, '/E','/NFL','/NDL','/NJH','/NJS','/NP') + $xd + $xf
  Write-Step "Copie des fichiers (robocopy)…"
  Start-Process -FilePath robocopy.exe -ArgumentList $roboArgs -Wait -NoNewWindow -RedirectStandardOutput $robolog
  Write-Step "Robocopy log: $robolog"

  # 3.b) Normaliser l'origine Git (si le dépôt a été copié avec .git)
  try {
    if (Test-Path (Join-Path $target '.git')) {
      $origin = 'https://github.com/Gilles290622/stock.git'
      Write-Step "Configuration de l'origine Git -> $origin"
      git -C $target remote set-url origin $origin 2>$null | Out-Null
    }
  } catch { Write-Warning "Configuration Git ignorée: $($_.Exception.Message)" }
} elseif ($mode -eq 'zip') {
  # Extraction depuis zip protégé par mot de passe
  if (-not $ZipPassword) { $ZipPassword = $Password }
  if (-not $ZipPassword) { Write-Error "Mot de passe du ZIP requis (paramètre -ZipPassword)."; exit 1 }

  function Get-7zPath {
    $paths = @(
      (Get-Command 7z -ErrorAction SilentlyContinue).Path,
      (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
      (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
    ) | Where-Object { $_ -and (Test-Path $_) }
    return ($paths | Select-Object -First 1)
  }
  function Ensure-7z {
    $seven = Get-7zPath
    if ($seven) { return $seven }
    $wg = (Get-Command winget -ErrorAction SilentlyContinue).Path
    if ($wg) {
      Write-Step 'Installation 7-Zip via winget…'
      try { Start-Process -Wait -NoNewWindow -FilePath $wg -ArgumentList @('install','-e','--id','7zip.7zip','--silent','--accept-source-agreements','--accept-package-agreements') } catch {}
      $seven = Get-7zPath
      if ($seven) { return $seven }
    }
    # Fallback MSI (version indicative)
    $msiUrl = 'https://www.7-zip.org/a/7z2408-x64.msi'
    $msi = Join-Path $env:TEMP '7zip-x64.msi'
    try {
      Write-Step "Téléchargement 7-Zip MSI: $msiUrl"
      Invoke-WebRequest -Uri $msiUrl -OutFile $msi -UseBasicParsing -TimeoutSec 180
      Write-Step 'Installation silencieuse 7-Zip (msi)…'
      Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/qn', '/norestart') -Wait -NoNewWindow
    } catch { Write-Warning "Installation 7-Zip a échoué: $($_.Exception.Message)" }
    return (Get-7zPath)
  }

  $sevenZip = Ensure-7z
  if (-not $sevenZip) { Write-Error '7-Zip est requis pour extraire un ZIP protégé. Merci de l\'installer et de relancer.'; exit 1 }

  Write-Step 'Extraction de l\'archive protégée…'
  # -y yes to all, -p password, -o output dir
  $args = @('x', '"' + $PayloadZip + '"', '-y', ('-p' + $ZipPassword), ('-o' + $target))
  Start-Process -FilePath $sevenZip -ArgumentList $args -Wait -NoNewWindow
  $repo = $target
}

# 3.b) Normaliser l'origine Git (si le dépôt a été copié avec .git)
try {
  if (Test-Path (Join-Path $target '.git')) {
    $origin = 'https://github.com/Gilles290622/stock.git'
    Write-Step "Configuration de l'origine Git -> $origin"
    git -C $target remote set-url origin $origin 2>$null | Out-Null
  }
} catch { Write-Warning "Configuration Git ignorée: $($_.Exception.Message)" }

# 4) Installer Node LTS et pm2 si absents
function Test-Node { try { & node -v | Out-Null; return $true } catch { return $false } }
function Test-Git { try { & git --version | Out-Null; return $true } catch { return $false } }
function Install-Node-LTS {
  # 1) Winget si dispo
  $wg = (Get-Command winget -ErrorAction SilentlyContinue).Path
  if ($wg) {
    Write-Step 'Installation Node LTS via winget…'
    try { Start-Process -Wait -NoNewWindow -FilePath $wg -ArgumentList @('install','-e','--id','OpenJS.NodeJS.LTS','--silent','--accept-source-agreements','--accept-package-agreements') } catch {}
    if (Test-Node) { return }
  }
  # 2) Fallback MSI (URL candidat LTS v20)
  $msiUrl = 'https://nodejs.org/dist/latest-v20.x/node-v20.18.0-x64.msi'
  $msi = Join-Path $env:TEMP 'node-lts-x64.msi'
  try {
    Write-Step "Téléchargement Node LTS: $msiUrl"
    Invoke-WebRequest -Uri $msiUrl -OutFile $msi -UseBasicParsing -TimeoutSec 120
    Write-Step 'Installation silencieuse Node LTS (msi)…'
    Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/qn', '/norestart') -Wait -NoNewWindow
  } catch { Write-Warning 'Téléchargement/installation Node a échoué.' }
}

if (-not (Test-Node)) { Install-Node-LTS }

# Installer Git si absent (via winget, sinon fallback Git for Windows)
function Install-Git {
  $wg = (Get-Command winget -ErrorAction SilentlyContinue).Path
  if ($wg) {
    Write-Step 'Installation Git via winget…'
    try { Start-Process -Wait -NoNewWindow -FilePath $wg -ArgumentList @('install','-e','--id','Git.Git','--silent','--accept-source-agreements','--accept-package-agreements') } catch {}
    if (Test-Git) { return }
  }
  $gitUrl = 'https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe'
  $gitExe = Join-Path $env:TEMP 'Git-64-bit.exe'
  try {
    Write-Step "Téléchargement Git for Windows: $gitUrl"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitExe -UseBasicParsing -TimeoutSec 180
    Write-Step 'Installation silencieuse de Git…'
    Start-Process -FilePath $gitExe -ArgumentList @('/VERYSILENT','/NORESTART') -Wait -NoNewWindow
  } catch { Write-Warning "Installation Git a échoué: $($_.Exception.Message)" }
}

if (-not (Test-Git)) { Install-Git }

# 4.c) Réserver l'URL HTTP pour le port 80 (permet l'écoute sans élévation persistante)
function Ensure-Port80 {
  try {
    Write-Step 'Configuration URLACL pour HTTP 80…'
    $user = "$env:UserDomain\\$env:UserName"
    Start-Process -FilePath 'netsh' -ArgumentList @('http','add','urlacl','url=http://+:80/','user=' + $user) -Wait -NoNewWindow
  } catch { Write-Step "URLACL: info: $($_.Exception.Message)" }
  try {
    Write-Step 'Ouverture du pare-feu (TCP 80) si nécessaire…'
    Start-Process -FilePath 'netsh' -ArgumentList @('advfirewall','firewall','add','rule','name=JTS-Stock-HTTP-80','dir=in','action=allow','protocol=TCP','localport=80') -Wait -NoNewWindow
  } catch { Write-Step "Pare-feu: info: $($_.Exception.Message)" }
}

Ensure-Port80

# 4.b) Si mode clonage, cloner depuis GitHub maintenant
if ($mode -eq 'clone') {
  $repoUrl = 'https://github.com/Gilles290622/stock.git'
  Write-Step 'Clonage du dépôt…'
  try {
    git clone --depth 1 $repoUrl $target 2>$null | Out-Null
  } catch { Write-Error "Echec du clonage: $($_.Exception.Message)"; exit 1 }
}

# S'assurer que npm/pm2 sont disponibles
$npm = (Get-Command npm -ErrorAction SilentlyContinue).Path
if (-not $npm) {
  $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
  if (-not (Test-Path $npm)) { $npm = Join-Path $env:LOCALAPPDATA 'Programs\node\npm.cmd' }
}
if ($npm) {
  Write-Step 'Installation de pm2 (global)…'
  try { & $npm install -g pm2 | Out-Null } catch { Write-Warning "npm install -g pm2 a échoué: $($_.Exception.Message)" }
}

# 5) Installer dépendances backend (production only)
if (-not $SkipNpm) {
  $backend = Join-Path $target 'backend'
  if (-not (Test-Path (Join-Path $backend 'package.json'))) {
    throw "backend/package.json introuvable à $backend"
  }
  Write-Step 'Installation des dépendances backend (production)…'
  if (-not $npm) { Write-Warning 'npm introuvable. Merci d\'installer Node.js (LTS) et relancer install-client.ps1'; }
  else {
    Push-Location $backend
    try {
      # npm >=9 : --omit=dev ; npm v8 : --only=prod
      npm install --omit=dev 2>$null 1>$null; if ($LASTEXITCODE -ne 0) { npm install --only=prod }
    } finally { Pop-Location }
  }
}

# 6) Créer raccourcis
Write-Step 'Création des raccourcis sur le Bureau…'
$cs = Join-Path $target 'create-shortcut.ps1'
if (-not (Test-Path $cs)) { throw "create-shortcut.ps1 introuvable à $cs" }

# Local
powershell -NoProfile -ExecutionPolicy Bypass -File $cs -Url 'http://127.0.0.1/stock' -Name 'JTS Stock (Local)' | Out-Null
# En ligne
powershell -NoProfile -ExecutionPolicy Bypass -File $cs -Url 'https://jts-services.shop/stock' -Name 'JTS Stock (En ligne)' | Out-Null

# Raccourci de mise à jour (git pull)
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $updateShortcut = Join-Path $desktop 'JTS Stock (Mise à jour).lnk'
  $runner = Join-Path $target 'scripts\run-ps-hidden.vbs'
  $updateScript = Join-Path $target 'scripts\update-app.ps1'
  $iconCandidates = @(
    (Join-Path $target 'frontend\public\jtservices.ico'),
    (Join-Path $target 'frontend\public\favicon.ico'),
    (Join-Path $target 'frontend\public\jtservices.jpg')
  )
  $iconPath = $iconCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($updateShortcut)
  $sc.TargetPath = 'wscript.exe'
  $sc.Arguments = '"' + $runner + '" "' + $updateScript + '"'
  $sc.Description = 'Mettre à jour l\'application (git pull)'
  if ($iconPath) { $sc.IconLocation = $iconPath }
  $sc.Save()
} catch { Write-Warning "Création du raccourci de mise à jour échouée: $($_.Exception.Message)" }

Write-Step 'Installation terminée.'
Write-Host "Dossier: $target" -ForegroundColor Green
Write-Host 'Trois raccourcis ont été créés sur le Bureau: "JTS Stock (Local)", "JTS Stock (En ligne)" et "JTS Stock (Mise à jour)".' -ForegroundColor Green
