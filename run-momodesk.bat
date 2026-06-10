@echo off
setlocal

cd /d "%~dp0"

set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
  echo [MomoDesk] Visual Studio C++ environment was not found:
  echo %VCVARS%
  echo.
  echo Please install Visual Studio Community 2026 with "Desktop development with C++".
  pause
  exit /b 1
)

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

echo [MomoDesk] Starting desktop pet...
call "%VCVARS%"
call npm run tauri dev

if errorlevel 1 (
  echo.
  echo [MomoDesk] Failed to start.
  pause
  exit /b 1
)

endlocal
