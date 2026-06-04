@echo off
echo.
echo   PiWeb Auth Token Reset
echo   ─────────────────────
echo.
node -e "import('./dist/auth.js').then(m => m.resetTokenCLI())"
echo.
pause
