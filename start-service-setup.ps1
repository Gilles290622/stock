<#
	Script de préparation Windows pour accéder à l'application via http://stock/
	- Ajoute l'entrée hosts 127.0.0.1 stock
	- Réserve l'URL sur le port 80 (URLACL) pour Node
	- Ajoute une règle firewall pour le port 80

	Utilisation (PowerShell en Administrateur):
		./start-service-setup.ps1

	Ensuite, démarrez le backend en production sur le port 80:
		# Option A: via PM2 (recommandé)
		pm2 start pm2-ecosystem.config.js --only stock-backend

		# Option B: direct (fenêtre PowerShell)
		cd ./backend
		$env:PORT=80; node server.js

	Accès: http://stock/
#>

function Test-Admin {
	$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
	return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
	Write-Warning 'Veuillez exécuter ce script en tant qu\'Administrateur (clic droit > Exécuter en tant qu\'administrateur).'
	Write-Host 'Arrêt.' -ForegroundColor Yellow
	exit 1
}

Write-Host '=== Configuration accès http://stock/ ===' -ForegroundColor Cyan

# 1) Ajouter l\'entrée hosts (127.0.0.1 stock)
$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"
$hostsContent = Get-Content -Path $hostsPath -ErrorAction SilentlyContinue
if ($hostsContent -notmatch "\b127\.0\.0\.1\s+stock\b") {
	try {
		Add-Content -Path $hostsPath -Value "127.0.0.1`tstock"
		Write-Host 'Entrée hosts ajoutée: 127.0.0.1 stock' -ForegroundColor Green
	} catch { Write-Warning "Impossible d\'écrire dans hosts: $($_.Exception.Message)" }
} else {
	Write-Host 'Entrée hosts déjà présente.' -ForegroundColor DarkGray
}

# 2) Réserver l'URL sur le port 80 pour Node (URLACL)
try {
	# Vérifie si une réservation existe déjà
	$exists = (netsh http show urlacl | Select-String -Pattern 'http://\+:80/')
	if (-not $exists) {
		& netsh http add urlacl url=http://+:80/ user=Everyone | Out-Null
		Write-Host 'Réservation URLACL faite pour http://+:80/' -ForegroundColor Green
	} else {
		Write-Host 'Réservation URLACL déjà présente.' -ForegroundColor DarkGray
	}
} catch { Write-Warning "URLACL erreur: $($_.Exception.Message)" }

# 3) Ouvrir le port 80 dans le pare-feu Windows (si pas déjà présent)
try {
	$rule = Get-NetFirewallRule -DisplayName 'Stock API 80' -ErrorAction SilentlyContinue
	if (-not $rule) {
		New-NetFirewallRule -DisplayName 'Stock API 80' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 | Out-Null
		Write-Host 'Règle firewall créée pour le port 80' -ForegroundColor Green
	} else {
		Write-Host 'Règle firewall déjà présente.' -ForegroundColor DarkGray
	}
} catch { Write-Warning "Firewall erreur: $($_.Exception.Message)" }

Write-Host 'Configuration terminée. Vous pouvez maintenant démarrer le backend sur le port 80.' -ForegroundColor Cyan
Write-Host 'Exemples:' -ForegroundColor Yellow
Write-Host '  pm2 start pm2-ecosystem.config.js --only stock-backend' -ForegroundColor Yellow
Write-Host '  cd ./backend; $env:PORT=80; node server.js' -ForegroundColor Yellow
Write-Host 'Puis ouvrez: http://stock/' -ForegroundColor Green
