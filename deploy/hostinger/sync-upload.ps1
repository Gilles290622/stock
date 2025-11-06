param(
  [Parameter(Mandatory=$true)][string]$FtpHost,
  [Parameter(Mandatory=$true)][string]$User,
  [SecureString]$Password,
  [string]$AuthSecretText,
  [ValidateSet('ftps','ftp','sftp')][string]$Protocol = 'ftps',
  [int]$Port,
  # IMPORTANT: If your FTP login already lands you inside public_html, set RemoteRoot to '/'.
  # Use '/public_html' only if your login root is ABOVE the public_html directory.
  [string]$RemoteRoot = '/',
  [switch]$Build,
  [switch]$DryRun,
  [switch]$UploadApi,            # upload php-api/index.php
  [switch]$UploadApiConfig,      # upload php-api/config.php (attention: secrets)
  [switch]$UploadResources,      # upload static resources from package_stock/public_html/stock/ressources
  [switch]$ExplicitTls,          # for explicit FTPS on port 21 with ftp:// + --ssl
  [switch]$Insecure,             # allow skipping TLS certificate validation
  [string]$ApiConfigContent,     # if provided, upload this content as stock/api/config.php
  [string]$ApiHtaccessContent    # if provided, upload this content as stock/api/.htaccess
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
  param([string]$start)
  if (Test-Path (Join-Path $start 'deploy\hostinger')) { return $start }
  $d = Split-Path -Parent $start
  while ($d -and (Test-Path $d)) {
    if (Test-Path (Join-Path $d 'deploy\hostinger')) { return $d }
    $d = Split-Path -Parent $d
  }
  throw 'Impossible de localiser la racine du projet (deploy\hostinger manquant).'
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-RepoRoot $here
$dist = Join-Path $repo 'frontend\dist'
$rootHt = Join-Path $repo 'deploy\hostinger\root\.htaccess'
$stockHt = Join-Path $repo 'deploy\hostinger\stock\.htaccess'
$apiDir = Join-Path $repo 'deploy\hostinger\php-api'
$resDir = Join-Path $repo 'deploy\hostinger\package_stock\public_html\stock\ressources'

if ($Build) {
  Write-Host '[build] npm run build dans frontend...' -ForegroundColor Cyan
  Push-Location (Join-Path $repo 'frontend')
  try { npm run build | Out-Null } finally { Pop-Location }
}

# If doing a full/static site upload, ensure frontend artifacts exist.
# For API-only uploads (-UploadApi / -UploadApiConfig / -ApiConfigContent), skip these checks.
if (-not ($UploadApi -or $UploadApiConfig -or $ApiConfigContent)) {
  if (!(Test-Path $dist)) { throw "Build introuvable: $dist (utilisez -Build)" }
  if (!(Test-Path $rootHt)) { throw "Fichier manquant: $rootHt" }
  if (!(Test-Path $stockHt)) { throw "Fichier manquant: $stockHt" }
}

$curl = 'curl.exe'
if (-not (Get-Command $curl -ErrorAction SilentlyContinue)) { throw 'curl.exe introuvable dans le PATH' }

# Heads-up to avoid creating a nested /public_html when the FTP account is already chrooted into it
if ($RemoteRoot.Trim() -match '^/?public_html/?$') {
  Write-Warning "RemoteRoot est défini sur '/public_html'. Si votre connexion FTP s'ouvre déjà dans 'public_html', cela créera un dossier 'public_html' imbriqué. Dans ce cas, utilisez -RemoteRoot '/' à la place."
}

# determine password to use
if ($Password) {
  $authPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
} elseif ($AuthSecretText) {
  $authPassword = $AuthSecretText
} else {
  $sec = Read-Host -AsSecureString 'Mot de passe'
  $authPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if ([string]::IsNullOrWhiteSpace($authPassword)) { throw 'Mot de passe manquant.' }

function New-RemoteUrl {
  param([string]$remotePath)
  # normalize remote path to start with '/' and use forward slashes
  $remotePath = ($remotePath -replace '\\','/')
  if ([string]::IsNullOrWhiteSpace($remotePath)) { $remotePath = '/' }
  elseif (-not $remotePath.StartsWith('/')) { $remotePath = '/' + $remotePath.TrimStart('/') }
  $scheme = switch ($Protocol) { 'sftp'{'sftp'} 'ftp'{'ftp'} default{'ftps'} }
  $p = if ($Port) { ":$Port" } else { '' }
  if ($ExplicitTls -and $Protocol -ne 'sftp') {
    # curl explicit TLS uses ftp:// + --ssl on port 21
    $scheme = 'ftp'
    if (-not $Port) { $p = ':21' }
  } elseif (-not $Port) {
    if ($scheme -eq 'ftps') { $p = ':990' } elseif ($scheme -eq 'ftp') { $p=':21' } elseif ($scheme -eq 'sftp') { $p=':22' }
  }
  return ("{0}://{1}{2}{3}" -f $scheme, $FtpHost, $p, $remotePath)
}

function Join-RemotePath {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Parts)
  # Build a remote path like /public_html/stock/dir/file using forward slashes
  $segments = @()
  foreach ($part in $Parts) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $normalized = ($part -replace '\\','/').Trim('/')
    if ($normalized.Length -gt 0) { $segments += $normalized }
  }
  if ($segments.Count -eq 0) { return '/' }
  return '/' + ($segments -join '/')
}

function Send-RemoteFile {
  param([string]$localFile,[string]$remotePath)
  $remoteUrl = New-RemoteUrl $remotePath
  $rel = ($localFile.Replace($repo,'') -replace '^[\\/]+','')
  if ($DryRun) { Write-Host ("[DRY] upload: $rel -> $remotePath") -ForegroundColor Yellow; return }
  $curlArgs = @('--silent','--show-error','--ftp-create-dirs','--fail','--ipv4','-u',"$User`:$authPassword")
  if ($ExplicitTls -and $Protocol -ne 'sftp') { $curlArgs += '--ssl' }
  if ($Insecure) { $curlArgs += '--insecure' }
  $curlArgs += @('--upload-file', $localFile, $remoteUrl)
  Write-Host ("[upload] $rel -> $remotePath")
  $p = Start-Process -FilePath $curl -ArgumentList $curlArgs -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Echec upload ($($p.ExitCode)): $rel" }
}

function Send-RemoteText {
  param([string]$text,[string]$remotePath)
  if ($DryRun) { Write-Host ("[DRY] put-text -> $remotePath (${text.Length} chars)") -ForegroundColor Yellow; return }
  $tmp = New-TemporaryFile
  try { Set-Content -LiteralPath $tmp -Value $text -NoNewline -Encoding UTF8; Send-RemoteFile -localFile $tmp -remotePath $remotePath }
  finally { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
}

# 1) .htaccess racine (skip for API-only uploads)
if (-not ($UploadApi -or $UploadApiConfig -or $ApiConfigContent)) {
  Send-RemoteFile -localFile $rootHt -remotePath (Join-RemotePath $RemoteRoot '.htaccess')
}

# 2) Dist -> public_html/stock (skip for API-only uploads)
if (-not ($UploadApi -or $UploadApiConfig -or $ApiConfigContent)) {
  Get-ChildItem -LiteralPath $dist -Recurse -File | ForEach-Object {
    $rel = ($_.FullName.Substring($dist.Length) -replace '^[\\/]+','')
    $remote = (Join-RemotePath $RemoteRoot 'stock' $rel)
    Send-RemoteFile -localFile $_.FullName -remotePath $remote
  }
}

# 3) .htaccess dans stock (skip for API-only uploads)
if (-not ($UploadApi -or $UploadApiConfig -or $ApiConfigContent)) {
  Send-RemoteFile -localFile $stockHt -remotePath (Join-RemotePath $RemoteRoot 'stock' '.htaccess')
}

# 4) API PHP
if ($UploadApi) {
  # Upload all API support files except config.php (secrets). Always include index.php and .htaccess if present.
  $apiFiles = @()
  if (Test-Path $apiDir) {
    $apiFiles = Get-ChildItem -LiteralPath $apiDir -File -Recurse | Where-Object { $_.Name -ne 'config.php' }
  }
  foreach ($f in $apiFiles) {
    $rel = ($f.FullName.Substring($apiDir.Length) -replace '^[\\/]+','')
    $remote = (Join-RemotePath $RemoteRoot 'stock/api' $rel)
    Send-RemoteFile -localFile $f.FullName -remotePath $remote
  }
}
if ($UploadApiConfig) {
  $apiCfg = Join-Path $apiDir 'config.php'
  if (Test-Path $apiCfg) {
    Write-Warning 'Attention: vous allez téléverser config.php (contient des secrets). Assurez-vous de le modifier côté serveur et de ne pas commiter ces valeurs dans Git.'
    Send-RemoteFile -localFile $apiCfg -remotePath (Join-RemotePath $RemoteRoot 'stock/api' 'config.php')
  }
}

# 5) Upload direct du contenu de config.php si fourni (prioritaire)
if ($ApiConfigContent) {
  Write-Warning 'Chargement direct du contenu de config.php vers le serveur (contient des secrets).'
  $remoteCfg = (Join-RemotePath $RemoteRoot 'stock/api' 'config.php')
  Send-RemoteText -text $ApiConfigContent -remotePath $remoteCfg
}

# 5b) Upload direct du contenu de .htaccess si fourni (pour variables d'env SetEnv)
if ($ApiHtaccessContent) {
  Write-Warning 'Chargement direct du contenu de stock/api/.htaccess vers le serveur (peut contenir des secrets).'
  $remoteHt = (Join-RemotePath $RemoteRoot 'stock/api' '.htaccess')
  Send-RemoteText -text $ApiHtaccessContent -remotePath $remoteHt
}

# 6) Ressources statiques (stock/ressources)
if ($UploadResources) {
  if (Test-Path $resDir) {
    Get-ChildItem -LiteralPath $resDir -Recurse -File | ForEach-Object {
      $rel = ($_.FullName.Substring($resDir.Length) -replace '^[\\/]+','')
      $remote = (Join-RemotePath $RemoteRoot 'stock/ressources' $rel)
      Send-RemoteFile -localFile $_.FullName -remotePath $remote
    }
  } else {
    Write-Warning "Dossier ressources introuvable: $resDir"
  }
}

Write-Host 'Terminé.' -ForegroundColor Green
