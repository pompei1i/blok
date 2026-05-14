# $blok builder — installs Rust if missing, then builds the installer

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

Write-Host "`n==> Checking Rust..." -ForegroundColor Cyan

$hasRust = $false
try {
    $v = & rustc --version 2>$null
    if ($v) { $hasRust = $true; Write-Host "    Rust found: $v" -ForegroundColor Green }
} catch { }

if (-not $hasRust) {
    Write-Host "    Rust not found. Installing via rustup..." -ForegroundColor Yellow

    $rustupExe = "$env:TEMP\rustup-init.exe"
    Write-Host "    Downloading rustup-init.exe..."
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe -UseBasicParsing

    Write-Host "    Running rustup (this takes a few minutes)..."
    & $rustupExe -y --default-toolchain stable --profile minimal
    if ($LASTEXITCODE -ne 0) { Write-Host "rustup install failed" -ForegroundColor Red; exit 1 }

    # Add cargo to PATH for this session
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

    $v = & rustc --version 2>$null
    Write-Host "    Rust installed: $v" -ForegroundColor Green
}

Write-Host "`n==> Installing npm dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

Write-Host "`n==> Building $blok installer (this takes a few minutes)..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed" -ForegroundColor Red; exit 1 }

$installer = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
    Write-Host "`n==> Done! Installer: $($installer.FullName)" -ForegroundColor Green
} else {
    Write-Host "`n==> Done! Check src-tauri\target\release\bundle\nsis\" -ForegroundColor Green
}
