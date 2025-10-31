# Supprime les scripts/tests/artefacts de dev non essentiels pour alléger le dépôt
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$base = Join-Path $root '..\backend\scripts'
$targets = @(
  'gen-token-raw.js',
  'grant-free-days.js',
  'hit-counts.js',
  'hit-search.js',
  'compare-local-remote.js',
  'cleanup-designations-by-annex.js',
  'count-clients-from-source.js',
  'count-clients.js',
  'count-entreprise-remote.js',
  'count-entreprise.js',
  'delete-designations-by-category.js',
  'delete-entreprise-local.js',
  'list-remote-tables.js',
  'list-tables.js',
  'remote-audit-global.js',
  'sync-clients-from-remote.js',
  'sync-entities-from-remote.js',
  'test-count.js',
  'test-create-mouvement.js',
  'test-login.js',
  'test-releve.js',
  'test-request.js',
  'test-sync-user6.js',
  'upsert-entreprise.js',
  'verify-scope.js',
  'pull_stream.txt',
  'push_stream.txt',
  'rs_after.json',
  'rs_before.json',
  'push_rs_after.json',
  'push_rs_before.json'
) | ForEach-Object { Join-Path $base $_ }

$deleted = @()
foreach ($f in $targets) {
  if (Test-Path $f) {
    Remove-Item -LiteralPath $f -Force
    if (-not (Test-Path $f)) { $deleted += $f }
  }
}

Write-Host "Fichiers supprimés:" -ForegroundColor Cyan
$deleted | ForEach-Object { Write-Host " - $_" }
Write-Host "Total: $($deleted.Count)" -ForegroundColor Green
