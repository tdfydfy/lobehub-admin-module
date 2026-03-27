param(
  [Parameter(Mandatory = $false)]
  [string]$ComposeFile = "docker-compose.yml",

  [Parameter(Mandatory = $false)]
  [string]$SqlRoot = "sql"
)

. (Join-Path $PSScriptRoot "_admin-common.ps1")

$resolvedComposeFile = Resolve-AdminComposeFile -ComposeFile $ComposeFile -ScriptRoot $PSScriptRoot
$resolvedSqlRoot = Resolve-AdminSqlPath -SqlPath $SqlRoot -ScriptRoot $PSScriptRoot

$sqlFiles = @(
  (Join-Path $resolvedSqlRoot "003_fix_provision_skip_requires_session.sql"),
  (Join-Path $resolvedSqlRoot "004_repair_project_managed_mappings.sql"),
  (Join-Path $resolvedSqlRoot "006_daily_reports.sql"),
  (Join-Path $resolvedSqlRoot "007_daily_report_volcengine_provider.sql"),
  (Join-Path $resolvedSqlRoot "008_customer_analysis_chat.sql"),
  (Join-Path $resolvedSqlRoot "009_customer_analysis_jobs.sql")
)

foreach ($sqlFile in $sqlFiles) {
  Invoke-ComposeSqlFile `
    -ComposeFile $resolvedComposeFile `
    -SqlFile $sqlFile `
    -Message "Applying upgrade SQL from $sqlFile ..."
}

Invoke-ComposeSqlText `
  -ComposeFile $resolvedComposeFile `
  -Message "Current managed mapping integrity:" `
  -SqlText @"
select
  count(*)::int as total_mappings,
  count(*) filter (where managed_agent_id is null)::int as missing_agent_id,
  count(*) filter (where managed_session_id is null)::int as missing_session_id,
  count(*) filter (
    where managed_agent_id is not null
      and not exists (
        select 1
        from public.agents a
        where a.id = pma.managed_agent_id
          and a.user_id = pma.user_id
      )
  )::int as dangling_agent_id,
  count(*) filter (
    where managed_session_id is not null
      and not exists (
        select 1
        from public.sessions s
        where s.id = pma.managed_session_id
          and s.user_id = pma.user_id
          and s.type = 'agent'
      )
  )::int as dangling_session_id
from lobehub_admin.project_managed_agents pma;
"@

Invoke-ComposeSqlText `
  -ComposeFile $resolvedComposeFile `
  -Message "Sample canonical official assistant mappings:" `
  -SqlText @"
select
  project_id,
  user_id,
  managed_agent_id,
  managed_agent_slug,
  managed_session_id,
  managed_session_slug,
  updated_at
from lobehub_admin.project_managed_agents
order by updated_at desc nulls last
limit 10;
"@

Write-Host "Done."
