param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoToml = Join-Path $repoRoot "src-tauri\Cargo.toml"
$tauriConf = Join-Path $repoRoot "src-tauri\tauri.conf.json"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semantic version format like 0.1.2"
}

$tag = "v$Version"

$cargoText = Get-Content -LiteralPath $cargoToml -Raw
$cargoText = [regex]::Replace($cargoText, '(?m)^version = ".*"$', "version = `"$Version`"")
Set-Content -LiteralPath $cargoToml -Value $cargoText -Encoding UTF8

$tauriText = Get-Content -LiteralPath $tauriConf -Raw
$tauriText = [regex]::Replace($tauriText, '"version":\s*".*?"', "`"version`": `"$Version`"")
Set-Content -LiteralPath $tauriConf -Value $tauriText -Encoding UTF8

Push-Location $repoRoot
try {
  git add .
  git commit -m "Bump version to $Version"
  git push origin main
  git tag $tag
  git push origin $tag
} finally {
  Pop-Location
}
