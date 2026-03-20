param(
  [Parameter(Mandatory = $false)]
  [string]$WorkDir = ""
)

. (Join-Path $PSScriptRoot "_admin-common.ps1")

Start-AdminNpmDev -WorkDir $WorkDir -DefaultRelativeDir "web" -ScriptRoot $PSScriptRoot
