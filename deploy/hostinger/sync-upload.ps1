param(
  [Parameter(Mandatory=$true)][string]$FtpHost,
  [Parameter(Mandatory=$true)][string]$User,
  [SecureString]$Password,
  [string]$AuthSecretText,
  [ValidateSet('ftps','ftp','sftp')][string]$Protocol = 'ftps',
  [int]$Port,
  [string]$RemoteRoot = '/public_html',
  [switch]$Build,
  [switch]$DryRun,
  [switch]$UploadApi,            # upload php-api/index.php
  [switch]$UploadApiConfig,      # upload php-api/config.php (attention: secrets)
  [switch]$ExplicitTls,          # for explicit FTPS on port 21 with ftp:// + --ssl
  [switch]$Insecure,             # allow skipping TLS certificate validation
  [string]$ApiConfigContent      # if provided, upload this content as stock/api/config.php
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

if ($Build) {
  Write-Host '[build] npm run build dans frontend...' -ForegroundColor Cyan
  Push-Location (Join-Path $repo 'frontend')
  try { npm run build | Out-Null } finally { Pop-Location }
}

if (!(Test-Path $dist)) { throw "Build introuvable: $dist (utilisez -Build)" }
if (!(Test-Path $rootHt)) { throw "Fichier manquant: $rootHt" }
if (!(Test-Path $stockHt)) { throw "Fichier manquant: $stockHt" }

$curl = 'curl.exe'
if (-not (Get-Command $curl -ErrorAction SilentlyContinue)) { throw 'curl.exe introuvable dans le PATH' }

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

# 1) .htaccess racine
Send-RemoteFile -localFile $rootHt -remotePath (Join-RemotePath $RemoteRoot '.htaccess')

# 2) Dist -> public_html/stock
Get-ChildItem -LiteralPath $dist -Recurse -File | ForEach-Object {
  $rel = ($_.FullName.Substring($dist.Length) -replace '^[\\/]+','')
  $remote = (Join-RemotePath $RemoteRoot 'stock' $rel)
  Send-RemoteFile -localFile $_.FullName -remotePath $remote
}

# 3) .htaccess dans stock
Send-RemoteFile -localFile $stockHt -remotePath (Join-RemotePath $RemoteRoot 'stock' '.htaccess')

# 4) API PHP
if ($UploadApi) {
  $apiIndex = Join-Path $apiDir 'index.php'
  if (Test-Path $apiIndex) {
    Send-RemoteFile -localFile $apiIndex -remotePath (Join-RemotePath $RemoteRoot 'stock/api' 'index.php')
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

Write-Host 'Terminé.' -ForegroundColor Green
