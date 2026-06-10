@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [MomoDesk] npm was not found in PATH.
  echo Please install Node.js, then run this script again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [MomoDesk] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [MomoDesk] npm install failed.
    pause
    exit /b 1
  )
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":1420 .*LISTENING"') do (
  echo [MomoDesk] Stopping existing dev server on port 1420, PID %%a...
  taskkill /PID %%a /F >nul 2>nul
)

echo [MomoDesk] Starting browser preview at http://127.0.0.1:1420/
start "" "http://127.0.0.1:1420/"
call npm run dev

if errorlevel 1 (
  echo.
  echo [MomoDesk] Failed to start browser preview.
  pause
  exit /b 1
)

endlocal
