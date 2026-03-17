param(
  [Parameter(Mandatory = $false)]
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Join-Path $PSScriptRoot ".."
}

$apiScript = Join-Path $RepoRoot "scripts/start-admin-api.ps1"
$webScript = Join-Path $RepoRoot "scripts/start-admin-web.ps1"

if (-not (Test-Path $apiScript)) {
  throw "Script not found: $apiScript"
}

if (-not (Test-Path $webScript)) {
  throw "Script not found: $webScript"
}

Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $apiScript
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $webScript

Write-Host "Started admin API and admin web in separate PowerShell windows."
