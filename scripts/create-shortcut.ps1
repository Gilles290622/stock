<#!
Crée un raccourci sur le Bureau vers une URL.
Par défaut, crée un fichier .url (Internet Shortcut) avec une icône personnalisable.
Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Url "https://example.com" -Name "Mon Lien" [-Icon "C:\chemin\icone.ico"]
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$Icon
)

$ErrorActionPreference = 'Stop'

function Resolve-Icon([string]$iconPath){
  if (-not $iconPath) { return $null }
  # Si chemin relatif, tenter par rapport au script (typiquement ..\frontend\public)
  if (-not (Test-Path $iconPath)) {
    $candidate = Join-Path $PSScriptRoot $iconPath
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  if (Test-Path $iconPath) { return (Resolve-Path $iconPath).Path }
  return $null
}

try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not (Test-Path $desktop)) { throw "Bureau introuvable ($desktop)" }

  # Créer un Internet Shortcut .url (pas de fenêtre console, supporte IconFile)
  $dst = Join-Path $desktop ("$Name.url")
  $iconAbs = Resolve-Icon $Icon
  $lines = @()
  $lines += '[InternetShortcut]'
  $lines += ('URL=' + $Url)
  if ($iconAbs) {
    $lines += ('IconFile=' + $iconAbs)
    $lines += 'IconIndex=0'
  }
  Set-Content -LiteralPath $dst -Value ($lines -join "`r`n") -Encoding ASCII
  Write-Host "Raccourci créé: $dst" -ForegroundColor Green
} catch {
  Write-Error ("Echec de création du raccourci: " + $_.Exception.Message)
  exit 1
}
