#!/usr/bin/env bash
set -euo pipefail

CACHE_HOST="${CACHE_HOST:-docker-cache.internal}"
FAILED=0

check() {
  local name="$1" url="$2"
  if wget --quiet --tries=1 --spider "$url" 2>/dev/null; then
    echo "[OK]   $name"
  else
    echo "[FAIL] $name ($url)"
    FAILED=1
  fi
}

check "Docker Hub registry" "http://${CACHE_HOST}:5001/v2/"
check "ghcr.io registry"    "http://${CACHE_HOST}:5002/v2/"
check "GCP AR registry"     "http://${CACHE_HOST}:5003/v2/"
check "npm (Verdaccio)"     "http://${CACHE_HOST}:4873/-/ping"
check "Health aggregator"   "http://${CACHE_HOST}:8080/health"

exit "$FAILED"
