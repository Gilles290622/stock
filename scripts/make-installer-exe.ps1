<#!
Construit un exécutable Windows (EXE) à partir du script install-client.ps1 en utilisant ps2exe.
- Requiert une connexion Internet (installe le module si absent).
- Produit .\dist\JTS-Stock-Installer.exe
#>
[CmdletBinding()]
param(
  [string]$Output = 'dist/JTS-Stock-Installer.exe'
)
$ErrorActionPreference = 'Stop'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$src = Join-Path $here 'install-client.ps1'
$Output = 'dist/JTS-Stock-Installer.exe'
$outFull = Join-Path $here $Output
$outDir = Split-Path -Parent $outFull
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Préparer PowerShellGet/NuGet provider + ps2exe (sans invites, compatible non-admin)
Write-Host '[ps2exe] préparation de PowerShellGet/NuGet…'
try { Set-PSRepository -Name 'PSGallery' -InstallationPolicy Trusted -ErrorAction SilentlyContinue } catch {}
try { Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}

$admin = Test-Admin
if ($admin) { $scope = 'AllUsers' } else { $scope = 'CurrentUser' }
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Write-Host "[ps2exe] installation du module depuis PSGallery (Scope=$scope)…"
  Install-Module ps2exe -Force -Scope $scope -AllowClobber
}
Import-Module ps2exe -Force

# Icône de l'installeur (facultatif) – prioriser jtservices.ico
$iconCandidates = @(
  (Join-Path $here '..\frontend\public\jtservices.ico'),
  (Join-Path $here '..\frontend\public\favicon.ico')
)
$icon = $iconCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host '[ps2exe] compilation…'
Invoke-ps2exe -InputFile $src -OutputFile $outFull -iconFile $icon -noConsole -title 'JTS Stock Installer' -version '1.0.0' -requireAdmin
Write-Host "OK: $outFull"
