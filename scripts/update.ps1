$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "=== Cập nhật Multi-Agent Studio ===" -ForegroundColor Cyan

$dirty = git status --porcelain
if ($dirty) {
  Write-Host "Cảnh báo: Thư mục mã nguồn có thay đổi chưa commit:" -ForegroundColor Red
  Write-Host $dirty
  throw "Đã dừng để tránh ghi đè thay đổi local. Hãy commit/stash trước khi cập nhật."
}

Write-Host "[1/3] Kéo mã nguồn mới nhất từ GitHub (origin/main)..." -ForegroundColor Yellow
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull thất bại. Kiểm tra kết nối GitHub hoặc quyền truy cập repo Private." }

Write-Host "[2/3] Đồng bộ dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install thất bại." }

$electronExe = Join-Path $RootDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
  node node_modules/electron/install.js
}

Write-Host "[3/3] Build lại bản mới (npm run build)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build thất bại." }

Write-Host ""
Write-Host "Cập nhật thành công! Dữ liệu phiên AI & cài đặt trong '%APPDATA%\MultiAgentStudio' được giữ nguyên 100%." -ForegroundColor Green
Write-Host "Hãy khởi động lại ứng dụng để sử dụng phiên bản mới." -ForegroundColor Cyan
