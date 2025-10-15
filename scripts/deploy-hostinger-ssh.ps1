param(
  [string]$RemoteHost = '45.84.207.203',
  [int]$Port = 65002,
  [string]$User = 'u313667830',
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$RemoteRoot = '/home/u313667830/public_html'
)

$ErrorActionPreference = 'Stop'

# 1) Build frontend with base=/stock/ for Hostinger
Write-Host '==> Build frontend (VITE_BASE=/stock/)' -ForegroundColor Cyan
Push-Location (Join-Path $ProjectRoot 'frontend')
try {
  if (Test-Path 'package-lock.json') { npm ci } else { npm install }
  $env:VITE_BASE = '/stock/'
  # If you want the PHP proxy api under /stock/api, leave VITE_API_BASE unset to use relative '' which resolves to /stock/api via .htaccess.
  # To target an external API, uncomment and set:
  # $env:VITE_API_BASE = 'https://your-api.example.com'
  npm run build
} finally { Pop-Location }

# 2) Préparer le package dossier via le script existant (on utilisera l'upload récursif, pas de ZIP)
Write-Host '==> Staging package (Hostinger stock)' -ForegroundColor Cyan
& (Join-Path $ProjectRoot 'deploy\hostinger\make-stock-zip.ps1') -ProjectRoot $ProjectRoot
$localRootHtaccess = Join-Path $ProjectRoot 'deploy\\hostinger\\package_stock\\public_html\\.htaccess'

 
$localStockDir = Join-Path $ProjectRoot 'deploy\hostinger\package_stock\public_html\stock'
if (!(Test-Path $localStockDir)) { throw "Dossier a uploader introuvable: $localStockDir" }

# 3) Pré-créer le dossier distant temporaire
Write-Host '==> Prepare remote temp dir' -ForegroundColor Cyan
$preSshCmd = @(
  "set -e",
  "cd $RemoteRoot",
  "rm -rf tmp_upload_stock",
  "mkdir -p tmp_upload_stock"
) -join '; '

$prepOk = $false
try {
  $p = Start-Process -FilePath 'ssh' -ArgumentList @('-p', $Port, ("$User@$RemoteHost"), $preSshCmd) -NoNewWindow -PassThru -Wait
  if ($p.ExitCode -eq 0) { $prepOk = $true }
} catch {}
if (-not $prepOk) {
  try {
    $p = Start-Process -FilePath 'plink' -ArgumentList @('-P', $Port, ("$User@$RemoteHost"), $preSshCmd) -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -eq 0) { $prepOk = $true }
  } catch {}
}
if (-not $prepOk) { throw "Impossible de preparer le dossier temporaire a distance." }

# 4) Upload recursif du dossier stock via SCP/PSCP/WinSCP
Write-Host '==> Upload folder via SCP (recursive)' -ForegroundColor Cyan
$uploaded = $false

function Invoke-Upload {
  param([string]$Cmd,[Object]$ArgList)
  try {
    $argPreview = if ($ArgList -is [Array]) { ($ArgList -join ' ') } else { [string]$ArgList }
    Write-Host "Tentative: $Cmd $argPreview" -ForegroundColor DarkGray
    $p = Start-Process -FilePath $Cmd -ArgumentList $ArgList -NoNewWindow -PassThru -Wait -ErrorAction Stop
    if ($p.ExitCode -eq 0) { return $true } else { return $false }
  } catch { return $false }
}

# Option 1: scp (OpenSSH) - upload dir recursively to tmp_upload_stock
if (-not $uploaded) {
  $scpArgs = @('-P', $Port, '-r', $localStockDir, ("${User}@${RemoteHost}:$RemoteRoot/tmp_upload_stock/") )
  $ok = Invoke-Upload -Cmd 'scp' -ArgList $scpArgs
  if ($ok) { $uploaded = $true }
}
# Option 2: pscp (PuTTY)
if (-not $uploaded) {
  $pscpArgs = @('-P', $Port, '-r', $localStockDir, ("${User}@${RemoteHost}:$RemoteRoot/tmp_upload_stock/") )
  $ok = Invoke-Upload -Cmd 'pscp' -ArgList $pscpArgs
  if ($ok) { $uploaded = $true }
}
# Option 3: WinSCP.com (si installé)
if (-not $uploaded) {
  $winscp = (Get-Command WinSCP.com -ErrorAction SilentlyContinue).Path
  if ($winscp) {
    $script = @"
put "$localRootHtaccess" "$RemoteRoot/.htaccess"
open sftp://${User}@${RemoteHost}:${Port} -hostkey="*"
put -r "$localStockDir" "$RemoteRoot/tmp_upload_stock/"
exit
"@
    $tmp = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tmp -Value $script -Encoding ASCII
    $ok = Invoke-Upload -Cmd $winscp -ArgList @('/script', $tmp)
    Remove-Item $tmp -Force
    if ($ok) { $uploaded = $true }
  }
}

if (-not $uploaded) { throw 'Aucun client SCP/PSCP/WinSCP trouvé pour uploader le dossier.' }

# 5) Déployer côté serveur via SSH: remplacer le dossier stock par l'upload
Write-Host '==> Déploiement distant (replace folder)' -ForegroundColor Cyan
$sshCmd = @(
  "set -e",
  "cd $RemoteRoot",
  # Remplacer atomiquement public_html/stock par le dossier uploadé
  "rm -rf stock",
  "mv tmp_upload_stock/stock ./stock",
  "rm -rf tmp_upload_stock"
) -join '; '

# Option OpenSSH ssh
$sshOk = $false
try {
  Write-Host ("SSH (OpenSSH) vers {0}@{1}:{2}" -f $User, $RemoteHost, $Port) -ForegroundColor DarkGray
  $p = Start-Process -FilePath 'ssh' -ArgumentList @('-p', $Port, ("$User@$RemoteHost"), $sshCmd) -NoNewWindow -PassThru -Wait
  if ($p.ExitCode -eq 0) { $sshOk = $true }
} catch { }

if (-not $sshOk) {
  # Option PuTTY plink
  try {
    Write-Host ("SSH (plink) vers {0}@{1}:{2}" -f $User, $RemoteHost, $Port) -ForegroundColor DarkGray
    $p = Start-Process -FilePath 'plink' -ArgumentList @('-P', $Port, ("$User@$RemoteHost"), $sshCmd) -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -eq 0) { $sshOk = $true }
  } catch { }
}

if (-not $sshOk) { throw "Impossible d'executer les commandes SSH a distance (ssh/plink manquant ?)" }

Write-Host '==> Deploiement termine. Verifiez https://votre-domaine/ (redirige vers /stock/ si .htaccess applique).' -ForegroundColor Green
