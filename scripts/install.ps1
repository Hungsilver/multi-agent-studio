param(
  [switch]$CreateShortcut
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "=== Cài đặt Multi-Agent Studio từ mã nguồn ===" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Không tìm thấy 'git'. Hãy cài Git for Windows trước."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Không tìm thấy 'node'. Hãy cài Node.js (>= 20) trước."
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Cần Node.js >= 20 (hiện tại: $(node -v))."
}

Write-Host "[1/4] Cài đặt dependencies (npm install)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install thất bại." }

# Xử lý trường hợp npm 11 bỏ qua postinstall script của electron/esbuild
$electronExe = Join-Path $RootDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
  Write-Host "[2/4] Đang khôi phục Electron runtime binary..." -ForegroundColor Yellow
  node node_modules/electron/install.js

  if (-not (Test-Path $electronExe)) {
    $cacheZip = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "electron\Cache") -Recurse -Filter "electron-v*-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cacheZip) {
      $distDir = Join-Path $RootDir "node_modules\electron\dist"
      Expand-Archive -Path $cacheZip.FullName -DestinationPath $distDir -Force
      Set-Content -Path (Join-Path $RootDir "node_modules\electron\path.txt") -Value "electron.exe" -NoNewline
    }
  }
}

$esbuildInstall = Join-Path $RootDir "node_modules\esbuild\install.js"
if (Test-Path $esbuildInstall) {
  node $esbuildInstall | Out-Null
}

if (-not (Test-Path $electronExe)) {
  throw "Không tìm thấy electron.exe sau khi cài. Hãy thử chạy lại 'node node_modules/electron/install.js'."
}

Write-Host "[3/4] Build ứng dụng (npm run build)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build thất bại." }

if ($CreateShortcut) {
  Write-Host "[4/4] Tạo Desktop shortcut..." -ForegroundColor Yellow
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnkPath = Join-Path $desktop "Multi-Agent Studio.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnkPath)
  $sc.TargetPath = "cmd.exe"
  $sc.Arguments = "/c cd /d `"$RootDir`" && npx electron ."
  $sc.WorkingDirectory = $RootDir
  $sc.IconLocation = Join-Path $RootDir "resources\icon.ico"
  $sc.WindowStyle = 7
  $sc.Save()
  Write-Host "Đã tạo shortcut: $lnkPath" -ForegroundColor Green
} else {
  Write-Host "[4/4] Hoàn tất!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Khởi chạy app bằng lệnh: npm run dev (hoặc npx electron .)" -ForegroundColor Cyan
Write-Host "Tạo shortcut Desktop bằng: .\scripts\install.ps1 -CreateShortcut" -ForegroundColor DarkGray
