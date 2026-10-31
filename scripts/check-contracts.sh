#!/usr/bin/env bash
# Diffs this repo's contracts/ and domain/ against the frontend repo's copies.
# Uses `diff -r` so new files are caught automatically.
# Excludes: fixtures.ts (demo-only), *.spec.ts / *.spec.mts (test files).
# Fails (exit 1) if any file differs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_CONTRACTS="$SCRIPT_DIR/../src/contracts"
FRONTEND_CONTRACTS="$SCRIPT_DIR/../../mockup-karsa-frontend/contracts"
BACKEND_DOMAIN="$SCRIPT_DIR/../src/domain"
FRONTEND_DOMAIN="$SCRIPT_DIR/../../mockup-karsa-frontend/domain"

if [ ! -d "$FRONTEND_CONTRACTS" ]; then
  echo "ERROR: Frontend contracts not found at $FRONTEND_CONTRACTS"
  exit 1
fi

FAILED=0

echo "=== Checking contracts/ ==="
if ! diff -r \
    "$BACKEND_CONTRACTS/" "$FRONTEND_CONTRACTS/" \
    > /dev/null 2>&1; then
  diff -r \
    "$BACKEND_CONTRACTS/" "$FRONTEND_CONTRACTS/" \
    || true
  FAILED=1
fi

echo "=== Checking domain/ ==="
if ! diff -r \
    --exclude="fixtures.ts" \
    --exclude="*.spec.ts" \
    --exclude="*.spec.mts" \
    "$BACKEND_DOMAIN/" "$FRONTEND_DOMAIN/" \
    > /dev/null 2>&1; then
  diff -r \
    --exclude="fixtures.ts" \
    --exclude="*.spec.ts" \
    --exclude="*.spec.mts" \
    "$BACKEND_DOMAIN/" "$FRONTEND_DOMAIN/" \
    || true
  FAILED=1
fi

if [ $FAILED -eq 0 ]; then
  echo "OK: contracts/ and domain/ are identical in both repos"
else
  echo "FAIL: files diverged — sync manually"
  exit 1
fi
