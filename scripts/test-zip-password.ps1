<#!
Teste un mot de passe sur une archive ZIP protégée avec 7-Zip.
Usage:
  powershell -ExecutionPolicy Bypass -File scripts\test-zip-password.ps1 -ZipPath C:\chemin\stock_payload_latest.zip -Password Gilles29060183
Retourne code 0 si OK, 2 si échec mot de passe, 1 pour autre erreur.
#>
[CmdletBinding()]param([Parameter(Mandatory=$true)][string]$ZipPath,[Parameter(Mandatory=$true)][string]$Password)
function Get-7z { $p=(Get-Command 7z -ErrorAction SilentlyContinue).Path; if($p){return $p}; $cand=@('C:\Program Files\7-Zip\7z.exe','C:\Program Files (x86)\7-Zip\7z.exe'); foreach($c in $cand){if(Test-Path $c){return $c}}; throw '7-Zip introuvable' }
if(-not (Test-Path $ZipPath)){ Write-Error "Archive introuvable: $ZipPath"; exit 1 }
$seven=Get-7z
# Utiliser le test sans extraction: 't'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $seven
$escaped = '"' + $ZipPath + '"'
$psi.Arguments = "t -p$Password $escaped"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
if($proc.ExitCode -eq 0){ Write-Host '[OK] Mot de passe valide.' -ForegroundColor Green; exit 0 }
if($stdout -match 'Wrong password' -or $stderr -match 'Wrong password' -or $stdout -match 'Can not open encrypted archive' ){
  Write-Host '[ERREUR] Mot de passe invalide.' -ForegroundColor Red; exit 2
}
Write-Host "[ERREUR] Code=$($proc.ExitCode). Sortie partielle:" -ForegroundColor Red
Write-Host ($stdout + $stderr)
exit 1