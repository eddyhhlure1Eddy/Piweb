$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed or not in PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is not installed or not in PATH."
}

if (-not (Test-Path "node_modules/@anthropic-ai/sdk/package.json")) {
  Write-Host "Installing dependencies..."
  if (Test-Path "package-lock.json") {
    npm ci
  } else {
    npm install
  }
}

if (-not (Test-Path "dist/index.js")) {
  Write-Host "Building PIweb..."
  npm run build
}

if (-not $env:PORT) { $env:PORT = "3000" }
Write-Host "Starting PIweb on port $env:PORT..."
node dist/index.js
