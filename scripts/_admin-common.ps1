$ErrorActionPreference = "Stop"

function Get-AdminRepoRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  return [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot ".."))
}

function Resolve-AdminPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $false)]
    [string[]]$BaseDirectories = @()
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Path is required."
  }

  $candidates = [System.Collections.Generic.List[string]]::new()

  if ([System.IO.Path]::IsPathRooted($Path)) {
    $candidates.Add($Path)
  }
  else {
    $candidates.Add($Path)

    foreach ($baseDirectory in $BaseDirectories) {
      if (-not [string]::IsNullOrWhiteSpace($baseDirectory)) {
        $candidates.Add((Join-Path $baseDirectory $Path))
      }
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "Path not found: $Path"
}

function Resolve-AdminComposeFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,

    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  $repoRoot = Get-AdminRepoRoot -ScriptRoot $ScriptRoot
  $repoParent = Split-Path $repoRoot -Parent

  return Resolve-AdminPath -Path $ComposeFile -BaseDirectories @($repoRoot, $repoParent)
}

function Resolve-AdminSqlPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SqlPath,

    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  $repoRoot = Get-AdminRepoRoot -ScriptRoot $ScriptRoot
  $repoParent = Split-Path $repoRoot -Parent

  return Resolve-AdminPath -Path $SqlPath -BaseDirectories @($repoRoot, $repoParent)
}

function Invoke-ComposeSqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,

    [Parameter(Mandatory = $true)]
    [string]$SqlFile,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Host "==> $Message"
  Get-Content -Path $SqlFile -Raw |
    docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub | Out-Host
}

function Invoke-ComposeSqlText {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,

    [Parameter(Mandatory = $true)]
    [string]$SqlText,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Host "==> $Message"
  $SqlText |
    docker compose -f $ComposeFile exec -T postgres psql -U lobehub -d lobehub | Out-Host
}

function Start-AdminNpmDev {
  param(
    [Parameter(Mandatory = $false)]
    [string]$WorkDir = "",

    [Parameter(Mandatory = $true)]
    [string]$DefaultRelativeDir,

    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  $repoRoot = Get-AdminRepoRoot -ScriptRoot $ScriptRoot
  $repoParent = Split-Path $repoRoot -Parent

  if ([string]::IsNullOrWhiteSpace($WorkDir)) {
    $resolvedWorkDir = Join-Path $repoRoot $DefaultRelativeDir
  }
  else {
    $resolvedWorkDir = Resolve-AdminPath -Path $WorkDir -BaseDirectories @($repoRoot, $repoParent)
  }

  if (-not (Test-Path $resolvedWorkDir)) {
    throw "Directory not found: $resolvedWorkDir"
  }

  $envFile = Join-Path $resolvedWorkDir ".env"
  $exampleFile = Join-Path $resolvedWorkDir ".env.example"

  if (-not (Test-Path $envFile) -and (Test-Path $exampleFile)) {
    Copy-Item $exampleFile $envFile
    Write-Host "Created $envFile from .env.example"
  }

  Push-Location $resolvedWorkDir
  try {
    npm run dev
  }
  finally {
    Pop-Location
  }
}
