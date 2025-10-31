<#!
Configure l'écoute HTTP sur le port 80 pour l'utilisateur courant.
- Réservation URLACL: http://+:80/
- Règle pare-feu entrante TCP 80
Doit être exécuté avec élévation.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
function Write-Step($m){ Write-Host "[port80] $m" -ForegroundColor Cyan }

try {
  $user = "$env:UserDomain\\$env:UserName"
  Write-Step "URLACL -> http://+:80/ pour $user"
  Start-Process -FilePath 'netsh' -ArgumentList @('http','add','urlacl','url=http://+:80/','user=' + $user) -Wait -NoNewWindow
} catch { Write-Step "URLACL info: $($_.Exception.Message)" }

try {
  Write-Step 'Pare-feu -> règle TCP 80'
  Start-Process -FilePath 'netsh' -ArgumentList @('advfirewall','firewall','add','rule','name=JTS-Stock-HTTP-80','dir=in','action=allow','protocol=TCP','localport=80') -Wait -NoNewWindow
} catch { Write-Step "Pare-feu info: $($_.Exception.Message)" }

Write-Step 'Configuration port 80 terminée.'
