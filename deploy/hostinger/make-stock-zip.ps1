param(
  [string]$ProjectRoot = "C:\Users\HP\Desktop\stock"
)

$ErrorActionPreference = 'Stop'

$root    = Resolve-Path $ProjectRoot
$dist    = Join-Path $root 'frontend\dist'
$deploy  = Join-Path $root 'deploy\hostinger'
$pkgRoot = Join-Path $deploy 'package_stock'
$public  = Join-Path $pkgRoot 'public_html'
$publicStock = Join-Path $public 'stock'
$zipPath = Join-Path $deploy 'stock-hostinger-upload.zip'

if (!(Test-Path $dist)) {
  throw "frontend/dist introuvable. Exécutez 'npm run build' dans frontend."
}

if (Test-Path $pkgRoot) { Remove-Item -Recurse -Force $pkgRoot }
New-Item -ItemType Directory -Force -Path $publicStock | Out-Null

# 1) Copier le build dans public_html/stock
robocopy $dist $publicStock /E /NFL /NDL /NJH /NJS /np | Out-Null

# 2) Copier l'API PHP dans public_html/stock/api
$apiSrc = Join-Path $deploy 'php-api'
$apiDst = Join-Path $publicStock 'api'
New-Item -ItemType Directory -Force -Path $apiDst | Out-Null
Copy-Item -Force (Join-Path $apiSrc 'index.php') $apiDst
Copy-Item -Force (Join-Path $apiSrc 'config.php') $apiDst

# 3) Copier les .htaccess
$rootHtaccess  = Join-Path $deploy 'root\.htaccess'
$stockHtaccess = Join-Path $deploy 'stock\.htaccess'
if (!(Test-Path $rootHtaccess))  { throw ".htaccess racine manquant: $rootHtaccess" }
if (!(Test-Path $stockHtaccess)) { throw ".htaccess stock manquant: $stockHtaccess" }
Copy-Item -Force $rootHtaccess  (Join-Path $public '.htaccess')
Copy-Item -Force $stockHtaccess (Join-Path $publicStock '.htaccess')

# 4) Créer le ZIP (robuste)
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

$toZip = Join-Path $pkgRoot 'public_html\*'
$maxRetries = 3
for ($i=1; $i -le $maxRetries; $i++) {
  try {
    Compress-Archive -Path $toZip -DestinationPath $zipPath -Force
    Write-Output "ZIP généré: $zipPath"
    break
  } catch {
    if ($i -eq $maxRetries) {
      Write-Warning "Compress-Archive a échoué après $maxRetries tentatives. Fallback item-par-item."
      # Fallback: ajouter les éléments un par un
      $items = Get-ChildItem -LiteralPath (Join-Path $pkgRoot 'public_html')
      foreach ($it in $items) {
        if (Test-Path $zipPath) {
          Compress-Archive -Path $it.FullName -DestinationPath $zipPath -Update
        } else {
          Compress-Archive -Path $it.FullName -DestinationPath $zipPath
        }
      }
      Write-Output "ZIP généré (fallback): $zipPath"
    } else {
      Start-Sleep -Seconds 1
    }
  }
}
