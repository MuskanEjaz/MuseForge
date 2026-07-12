param(
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$Root = Get-Location
$FixedServer = Join-Path $Root "fixed_files\backend\server.js"
$BackendServer = Join-Path $Root "backend\server.js"
$AppPath = Join-Path $Root "src\App.js"

if (!(Test-Path $FixedServer)) {
  Write-Host "Missing fixed backend file: $FixedServer" -ForegroundColor Red
  exit 1
}

if (!(Test-Path $BackendServer)) {
  Write-Host "Missing project backend file: $BackendServer" -ForegroundColor Red
  exit 1
}

if (!(Test-Path $AppPath)) {
  Write-Host "Missing project frontend file: $AppPath" -ForegroundColor Red
  exit 1
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $BackendServer "$BackendServer.before-real-tested-cv-fix.$Stamp.bak" -Force
Copy-Item $AppPath "$AppPath.before-real-tested-cv-fix.$Stamp.bak" -Force

Copy-Item $FixedServer $BackendServer -Force
Write-Host "backend/server.js replaced with real-PDF tested parser." -ForegroundColor Green

# Patch only the current frontend CV mapping. Do NOT replace the whole App.js, so UI fixes stay safe.
$app = Get-Content $AppPath -Raw
if ($app -notmatch "link:\s*it\.link\s*\|\|\s*it\.url\s*\|\|\s*''") {
  $pattern = "items:\s*\(s\.items\s*\|\|\s*\[\]\)\.map\(it\s*=>\s*\(\{\s*id:\s*newId\(\),\s*heading:\s*it\.heading\s*\|\|\s*'',\s*desc:\s*it\.desc\s*\|\|\s*''\s*\}\)\)"
  $replacement = @"
items: (s.items || []).map(it => ({
            id: newId(),
            heading: it.heading || '',
            desc: it.desc || '',
            link: it.link || it.url || ''
          }))
"@
  $updated = [regex]::Replace($app, $pattern, $replacement, 1)
  if ($updated -eq $app) {
    Write-Host "WARNING: App.js CV custom-section mapping pattern not found. Backend is fixed, but frontend may still drop custom item links." -ForegroundColor Yellow
  } else {
    Set-Content -Path $AppPath -Value $updated -Encoding UTF8
    Write-Host "src/App.js patched to preserve CV custom-section links." -ForegroundColor Green
  }
} else {
  Write-Host "src/App.js already preserves CV custom-section links." -ForegroundColor Green
}

if (-not $SkipNpmInstall) {
  Write-Host "Installing pdfjs-dist for embedded PDF links..." -ForegroundColor Cyan
  npm install pdfjs-dist@3.11.174 --prefix .\backend
}

node --check .\backend\server.js
Write-Host "Syntax check passed." -ForegroundColor Green
Write-Host "Now run: npm run build" -ForegroundColor Cyan
