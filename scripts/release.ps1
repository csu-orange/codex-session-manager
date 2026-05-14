param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoToml = Join-Path $repoRoot "src-tauri\Cargo.toml"
$tauriConf = Join-Path $repoRoot "src-tauri\tauri.conf.json"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semantic version format like 0.1.2"
}

$tag = "v$Version"

$cargoText = Get-Content -LiteralPath $cargoToml -Raw
$cargoText = [regex]::Replace($cargoText, '(?m)^version = ".*"$', "version = `"$Version`"")
Write-Utf8NoBom -Path $cargoToml -Content $cargoText

$tauriText = Get-Content -LiteralPath $tauriConf -Raw
$tauriText = [regex]::Replace($tauriText, '"version":\s*".*?"', "`"version`": `"$Version`"")
Write-Utf8NoBom -Path $tauriConf -Content $tauriText

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
