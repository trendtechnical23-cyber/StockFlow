# StockFlow Dashboard - Quick Launcher
# Usage: Right-click -> "Run with PowerShell"   OR   .\start.ps1

$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    StockFlow Dashboard - Quick Launcher  " -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Kill any existing processes on port 3001 and 4000
Write-Host "[0/2] Clearing ports 3001 and 4000..." -ForegroundColor Yellow
$ports = @(3001, 4000)
foreach ($port in $ports) {
    $pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    foreach ($pid in $pids) {
        try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
    }
}
Start-Sleep -Seconds 1

# Start Backend
Write-Host "[1/2] Starting Backend on port 4000..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "& { `$host.UI.RawUI.WindowTitle = 'StockFlow - Backend (4000)'; Set-Location '$root\server'; Write-Host 'Backend starting...' -ForegroundColor Cyan; npm run dev }"
)

Start-Sleep -Seconds 3

# Start Frontend
Write-Host "[2/2] Starting Frontend on port 3001..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "& { `$host.UI.RawUI.WindowTitle = 'StockFlow - Frontend (3001)'; Set-Location '$root'; Write-Host 'Frontend starting...' -ForegroundColor Cyan; npm run dev }"
)

Write-Host ""
Write-Host "  Both servers are starting!" -ForegroundColor Green
Write-Host ""
Write-Host "    Frontend : http://localhost:3001" -ForegroundColor White
Write-Host "    Backend  : http://localhost:4000" -ForegroundColor White
Write-Host "    Health   : http://localhost:4000/health" -ForegroundColor White
Write-Host ""
Write-Host "  Press Enter to close this window..." -ForegroundColor DarkGray
Read-Host
