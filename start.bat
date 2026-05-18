@echo off
title StockFlow Launcher
color 0A
echo.
echo  ========================================
echo    StockFlow Dashboard - Quick Launcher
echo  ========================================
echo.

:: Kill any leftover processes on port 3001 or 4000 so we get clean starts
echo [0/2] Clearing ports 3001 and 4000 if in use...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Start Backend
echo [1/2] Starting Backend Server on port 4000...
start "StockFlow - Backend (4000)" cmd /k "cd /d "%~dp0server" && echo Backend starting... && npm run dev"

:: Wait for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend
echo [2/2] Starting Frontend on port 3001...
start "StockFlow - Frontend (3001)" cmd /k "cd /d "%~dp0" && echo Frontend starting... && npm run dev"

echo.
echo  Both servers are starting in separate windows.
echo.
echo    Frontend : http://localhost:3001
echo    Backend  : http://localhost:4000
echo    Health   : http://localhost:4000/health
echo.
echo  You can close this window.
echo.
pause
