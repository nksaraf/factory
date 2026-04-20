#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for svc in registry-dockerhub registry-ghcr registry-gcpar; do
  echo "[$(date -Iseconds)] Running garbage collection on $svc"
  docker compose exec -T "$svc" registry garbage-collect /etc/docker/registry/config.yml --delete-untagged
  echo "[$(date -Iseconds)] Finished garbage collection on $svc"
done
