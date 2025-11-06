<#!
Script bootstrap d'installation depuis la version ONLINE.
Télécharge l'alias stock_payload_latest.zip depuis Hostinger, extrait (mot de passe ZIP),
puis lance scripts\install-client.ps1 avec les mots de passe fournis.

Usage (PowerShell administrateur recommandé):
  powershell -ExecutionPolicy Bypass -File scripts\install-from-online.ps1 \
     -ZipPassword "<MDP_ZIP>" -InstallPassword "<MDP_INSTALL>" [-Drive C] [-FolderName JTS-Stock]

Si les mots de passe ne sont pas fournis, ils seront demandés.
Le script installe 7-Zip si nécessaire pour l'extraction.
#>
[CmdletBinding()]
param(
  [string]$ZipPassword,
  [string]$InstallPassword,
  [ValidateSet('C','D')][string]$Drive = 'C',
  [string]$FolderName = 'JTS-Stock'
)

$ErrorActionPreference = 'Stop'
function Step($m){ Write-Host "[online-install] $m" -ForegroundColor Cyan }

$aliasUrl = $env:STOCK_INSTALLER_URL
if(-not $aliasUrl){ $aliasUrl = 'https://jts-services.shop/stock/ressources/stock_payload_latest.zip' }
Step "Alias ZIP: $aliasUrl"

if(-not $ZipPassword){ $ZipPassword = Read-Host -Prompt 'Mot de passe du ZIP' }
if(-not $InstallPassword){ $InstallPassword = Read-Host -Prompt 'Mot de passe d\'installation' }
if(-not $ZipPassword){ throw 'Mot de passe ZIP requis.' }
if(-not $InstallPassword){ throw 'Mot de passe installation requis.' }

function Get-7zPath {
  $paths = @(
    (Get-Command 7z -ErrorAction SilentlyContinue).Path,
    (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  return ($paths | Select-Object -First 1)
}
function Ensure-7z {
  $p = Get-7zPath
  if($p){ return $p }
  $wg = (Get-Command winget -ErrorAction SilentlyContinue).Path
  if($wg){
    Step 'Installation 7-Zip via winget…'
    try { Start-Process -Wait -NoNewWindow -FilePath $wg -ArgumentList @('install','-e','--id','7zip.7zip','--silent','--accept-source-agreements','--accept-package-agreements') } catch {}
    $p = Get-7zPath
    if($p){ return $p }
  }
  $msiUrl = 'https://www.7-zip.org/a/7z2408-x64.msi'
  $msi = Join-Path $env:TEMP '7zip-x64.msi'
  try {
    Step "Téléchargement 7-Zip MSI: $msiUrl"
    Invoke-WebRequest -Uri $msiUrl -OutFile $msi -UseBasicParsing -TimeoutSec 180
    Step 'Installation silencieuse 7-Zip (msi)…'
    Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/qn', '/norestart') -Wait -NoNewWindow
  } catch { Write-Warning "Installation 7-Zip a échoué: $($_.Exception.Message)" }
  return (Get-7zPath)
}

function Ensure-Tls12 {
  try {
    $sp = [Net.ServicePointManager]::SecurityProtocol
    if(($sp -band [Net.SecurityProtocolType]::Tls12) -eq 0){
      [Net.ServicePointManager]::SecurityProtocol = $sp -bor [Net.SecurityProtocolType]::Tls12
    }
  } catch {}
}

Ensure-Tls12
$zipPath = Join-Path $env:TEMP 'stock_payload_latest_download.zip'
Step "Téléchargement de l'archive…"
Invoke-WebRequest -Uri $aliasUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 600
if(-not (Test-Path $zipPath)){ throw 'Téléchargement échoué (fichier introuvable).' }

$seven = Ensure-7z
if(-not $seven){ throw '7-Zip introuvable (installation requise).' }

$extractDir = Join-Path $env:TEMP ('stock_extract_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Step "Extraction protégée vers $extractDir…"
$args = @('x', $zipPath, '-y', ('-p' + $ZipPassword), ('-o' + $extractDir))
$proc = Start-Process -FilePath $seven -ArgumentList $args -Wait -NoNewWindow -PassThru
if($proc.ExitCode -ne 0){ throw 'Extraction échouée (mot de passe incorrect ou archive corrompue).' }

# Lancer install-client.ps1
$installer = Join-Path $extractDir 'scripts\install-client.ps1'
if(-not (Test-Path $installer)){ throw "install-client.ps1 introuvable dans $extractDir" }
Step 'Lancement de install-client.ps1…'
powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Drive $Drive -FolderName $FolderName -Password $InstallPassword -ZipPassword $ZipPassword
Step 'Terminé.'
