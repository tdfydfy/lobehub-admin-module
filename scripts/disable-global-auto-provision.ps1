param(
  [Parameter(Mandatory = $false)]
  [string]$ComposeFile = "docker-compose.yml",

  [Parameter(Mandatory = $false)]
  [string]$SqlFile = "sql/002_disable_global_auto_provision.sql"
)

. (Join-Path $PSScriptRoot "_admin-common.ps1")

$resolvedComposeFile = Resolve-AdminComposeFile -ComposeFile $ComposeFile -ScriptRoot $PSScriptRoot
$resolvedSqlFile = Resolve-AdminSqlPath -SqlPath $SqlFile -ScriptRoot $PSScriptRoot

Invoke-ComposeSqlFile `
  -ComposeFile $resolvedComposeFile `
  -SqlFile $resolvedSqlFile `
  -Message "Disabling legacy global auto provisioning ..."

Write-Host "==> Current global provisioning config:"
docker compose -f $resolvedComposeFile exec -T postgres psql -U lobehub -d lobehub -c "select * from public.get_system_provisioning_template();" | Out-Host

Write-Host "Done."
