param(
	[string]$Url = "http://127.0.0.1/stock",
	[string]$Name = "Stock App"
)

$ErrorActionPreference = 'Stop'

# Détermination des chemins
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop ("$Name" + '.lnk')
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
## Icône: privilégier jtservices.ico si présent, sinon favicon.ico, sinon jtservices.jpg
$iconCandidates = @(
	(Join-Path $scriptRoot 'frontend\public\jtservices.ico'),
	(Join-Path $scriptRoot 'frontend\public\favicon.ico'),
	(Join-Path $scriptRoot 'frontend\public\jtservices.jpg')
)
$iconPath = $iconCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iconPath) {
	Write-Warning "Icone introuvable à $iconPath. Le raccourci sera créé sans icône personnalisée."
}

# Cible: lanceur qui démarre le backend si nécessaire puis ouvre l'app
$launcher = Join-Path $scriptRoot 'scripts\launch-app.ps1'
$wscript = 'wscript.exe'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$runner = Join-Path $scriptRoot 'scripts\run-ps-hidden.vbs'
$shortcut.TargetPath = $wscript
$shortcut.Arguments = '"' + $runner + '" "' + $launcher + '" -Url "' + $Url + '"'
$shortcut.Description = "Application de gestion de stock"
if ($iconPath) { $shortcut.IconLocation = $iconPath }
$shortcut.Save()

Write-Host "Raccourci créé sur le bureau : $shortcutPath"
if ($iconPath) { Write-Host "Icône utilisée : $iconPath" }