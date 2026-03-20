param(
  [Parameter(Mandatory = $false)]
  [string]$RepoRoot = ""
)

. (Join-Path $PSScriptRoot "_admin-common.ps1")

$defaultRepoRoot = Get-AdminRepoRoot -ScriptRoot $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $resolvedRepoRoot = $defaultRepoRoot
}
else {
  $resolvedRepoRoot = Resolve-AdminPath -Path $RepoRoot -BaseDirectories @($defaultRepoRoot, (Split-Path $defaultRepoRoot -Parent))
}

$apiScript = Join-Path $resolvedRepoRoot "scripts/start-admin-api.ps1"
$webScript = Join-Path $resolvedRepoRoot "scripts/start-admin-web.ps1"

if (-not (Test-Path $apiScript)) {
  throw "Script not found: $apiScript"
}

if (-not (Test-Path $webScript)) {
  throw "Script not found: $webScript"
}

Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $apiScript
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $webScript

Write-Host "Started admin API and admin web in separate PowerShell windows."
