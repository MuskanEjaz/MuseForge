
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (!(Test-Path ".\backend\server.js")) { throw "backend\server.js not found. Run this from project root." }
if (!(Test-Path ".\src\App.js")) { throw "src\App.js not found. Run this from project root." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item ".\backend\server.js" ".\backend\server.js.before-cv-100fix-$stamp.bak" -Force
Copy-Item ".\src\App.js" ".\src\App.js.before-cv-100fix-$stamp.bak" -Force

Copy-Item ".\fixed_files\backend\server.js" ".\backend\server.js" -Force
Copy-Item ".\fixed_files\src\App.js" ".\src\App.js" -Force

Write-Host "Installed tested CV parser fix." -ForegroundColor Green
node --check ".\backend\server.js"
