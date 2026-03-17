param(
  [Parameter(Mandatory = $false)]
  [string]$WorkDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = Join-Path $PSScriptRoot "..\\web"
}

if (-not (Test-Path $WorkDir)) {
  throw "Directory not found: $WorkDir"
}

$envFile = Join-Path $WorkDir ".env"
$exampleFile = Join-Path $WorkDir ".env.example"

if (-not (Test-Path $envFile) -and (Test-Path $exampleFile)) {
  Copy-Item $exampleFile $envFile
  Write-Host "Created $envFile from .env.example"
}

Push-Location $WorkDir
try {
  npm run dev
}
finally {
  Pop-Location
}
