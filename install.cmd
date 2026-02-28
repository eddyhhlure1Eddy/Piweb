@echo off
chcp 65001 >nul 2>&1
echo ============================================
echo   PIweb - One-Click Install ^& Build
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)

echo.
echo [2/3] Building TypeScript...
call npx tsc
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo.
echo [3/3] Global link (piweb command)...
call npm link 2>nul
if %errorlevel% neq 0 (
    echo [WARN] npm link failed - run as Administrator for global install
    echo        You can still use: npm start / npm run cli
)

echo.
echo ============================================
echo   Done! Start with:
echo     piweb --web     (Web UI on port 3000)
echo     piweb --cli     (Terminal mode)
echo     npm start       (same as piweb --web)
echo ============================================
pause
