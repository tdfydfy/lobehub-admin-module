param(
  [Parameter(Mandatory = $false)]
  [string]$ComposeFile = "docker-compose.yml",

  [Parameter(Mandatory = $false)]
  [string]$SqlFile = "lobehub-admin-module/sql/001_project_admin_core.sql"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SqlFile)) {
  throw "SQL file not found: $SqlFile"
}

Write-Host "==> Applying project admin core schema from $SqlFile ..."
Get-Content -Path $SqlFile -Raw |
  docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub | Out-Host

Write-Host "==> Installed objects in schema lobehub_admin:"
docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub -c "\dt lobehub_admin.*" | Out-Host

Write-Host "Done."
