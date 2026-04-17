$env:PORT = "3001"
Write-Host "Starting PIweb on port $env:PORT..." -ForegroundColor Cyan
node dist/index.js
