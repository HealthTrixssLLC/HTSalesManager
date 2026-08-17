#!/usr/bin/env bash
# Self-contained runner for the Document Reference External API integration tests.
# Starts the app server if it is not already listening on :5000, waits for readiness,
# runs the Vitest suite with the server config, and tears down any server it started.
set -euo pipefail
cd "$(dirname "$0")/.."

STARTED_PID=""
cleanup() {
  if [ -n "$STARTED_PID" ]; then
    kill "$STARTED_PID" 2>/dev/null || true
    wait "$STARTED_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -sf -o /dev/null http://localhost:5000/api/health 2>/dev/null \
   && ! curl -s -o /dev/null http://localhost:5000/ 2>/dev/null; then
  echo "[test-runner] Server not running on :5000 — starting it..."
  npm run dev >/tmp/docs-test-server.log 2>&1 &
  STARTED_PID=$!
fi

# Wait for the server to accept connections (max 60s)
for i in $(seq 1 60); do
  if curl -s -o /dev/null http://localhost:5000/; then
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[test-runner] Server failed to start; log tail:" >&2
    tail -30 /tmp/docs-test-server.log 2>/dev/null >&2 || true
    exit 1
  fi
  sleep 1
done

npx vitest run tests/external-documents-api.test.ts --config tests/vitest.server.config.ts
