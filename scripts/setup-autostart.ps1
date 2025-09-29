<#
  Configure un démarrage automatique au logon utilisateur via le Planificateur de tâches.
  - Crée une tâche qui exécute scripts\start-pm2.ps1 à chaque ouverture de session.
  - Fonctionne en mode Administrateur (exécute avec autorisations maximales)
    et sinon en mode utilisateur (non élevé) comme fallback.
#>

param(
  [string]$TaskName = 'StockApp AutoStart'
)

function Test-Admin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Détermine si on est admin; sinon, on passera en fallback non-élevé
$isAdmin = Test-Admin
if (-not $isAdmin) {
  Write-Warning "Mode non-administrateur: la tâche sera créée pour l'utilisateur courant sans privilèges élevés."
}

$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $repo 'scripts\start-pm2.ps1'
if (-not (Test-Path $scriptPath)) {
  Write-Error "Script introuvable: $scriptPath"
  exit 1
}

# Action: lancer PowerShell qui exécute start-pm2.ps1 en caché
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

# Déclencheur: au logon de l'utilisateur courant
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Options tâche: privilégie Highest si admin, sinon Limited
if ($isAdmin) {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
}

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -DontStopIfGoingOnBatteries)

try {
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
  Write-Host "Tâche planifiée créée: $TaskName" -ForegroundColor Green
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

Write-Host 'Auto-start configuré. Redémarre la session Windows pour tester.' -ForegroundColor Cyan
