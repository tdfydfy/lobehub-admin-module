param(
  [Parameter(Mandatory = $false)]
  [string]$ComposeFile = "docker-compose.yml",

  [Parameter(Mandatory = $false)]
  [string]$SqlFile = "lobehub-admin-module/sql/002_disable_global_auto_provision.sql"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SqlFile)) {
  throw "SQL file not found: $SqlFile"
}

Write-Host "==> Disabling legacy global auto provisioning ..."
Get-Content -Path $SqlFile -Raw |
  docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub | Out-Host

Write-Host "==> Current global provisioning config:"
docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub -c "select * from public.get_system_provisioning_template();" | Out-Host

Write-Host "Done."
