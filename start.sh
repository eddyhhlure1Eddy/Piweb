#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || {
  echo "Node.js is not installed or not in PATH." >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "npm is not installed or not in PATH." >&2
  exit 1
}

if [ ! -f "node_modules/@anthropic-ai/sdk/package.json" ]; then
  echo "Installing dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
fi

if [ ! -f "dist/index.js" ]; then
  echo "Building PIweb..."
  npm run build
fi

: "${PORT:=3000}"
export PORT
echo "Starting PIweb on port $PORT..."
exec node dist/index.js
