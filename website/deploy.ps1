[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$env:WRANGLER_SEND_METRICS = 'false'
Set-Location -LiteralPath $PSScriptRoot

node.exe build.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd --yes wrangler@4.151.1 deploy --dry-run
if ($LASTEXITCODE -ne 0 -or $CheckOnly) { exit $LASTEXITCODE }

npx.cmd --yes wrangler@4.151.1 deploy
exit $LASTEXITCODE
