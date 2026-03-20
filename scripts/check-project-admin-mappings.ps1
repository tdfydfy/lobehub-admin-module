param(
  [Parameter(Mandatory = $false)]
  [string]$ComposeFile = "docker-compose.yml",

  [Parameter(Mandatory = $false)]
  [string]$SqlFile = "sql/005_check_project_managed_mapping_health.sql"
)

. (Join-Path $PSScriptRoot "_admin-common.ps1")

$resolvedComposeFile = Resolve-AdminComposeFile -ComposeFile $ComposeFile -ScriptRoot $PSScriptRoot
$resolvedSqlFile = Resolve-AdminSqlPath -SqlPath $SqlFile -ScriptRoot $PSScriptRoot

Invoke-ComposeSqlFile `
  -ComposeFile $resolvedComposeFile `
  -SqlFile $resolvedSqlFile `
  -Message "Checking project managed assistant mapping health ..."

Write-Host "Done."
