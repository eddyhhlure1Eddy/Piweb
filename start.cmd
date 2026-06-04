@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\@anthropic-ai\sdk\package.json" (
  echo Installing dependencies...
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "dist\index.js" (
  echo Building PIweb...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000
echo Starting PIweb on port %PORT%...
node dist\index.js
pause
