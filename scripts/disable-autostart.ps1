param([string]$TaskName='StockApp AutoStart')
$ErrorActionPreference='SilentlyContinue'
try{ if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){ Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false } } catch {}
# Optionnel: supprimer un éventuel raccourci dans le dossier Démarrage
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'StockApp AutoStart.lnk'
if (Test-Path $lnk){ Remove-Item $lnk -Force }
Write-Host "AutoStart désactivé (tâche '$TaskName' supprimée si elle existait)."
