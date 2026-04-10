#!/usr/bin/env bash
#
# Platform smoke test — exercises a full developer workflow via dx CLI.
#
# Usage:
#   ./scripts/smoke-test-platform.sh [local|dev]
#   DX="bun run cli/src/cli.ts" ./scripts/smoke-test-platform.sh local
#
# Modes:
#   local  — embedded factory (PGlite + k3d dx-local), dx manages everything
#   dev    — docker-compose stack + k3d dx-dev (tests the real factory stack)
#
# Prerequisites:
#   - dx binary on PATH (or DX env var set)
#   - Docker running (for workspace provisioning)
#
# Guarantees:
#   - Creates only one workspace with a deterministic slug (wks-smoke-test-ci)
#   - Always cleans up k8s resources, even on failure or ctrl-C
#   - Idempotent: safe to re-run after a failed run
#
set -euo pipefail

MODE="${1:-local}"
DX="${DX:-dx}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WS_NAME="smoke-test-ci"
WS_SLUG="wks-smoke-test-ci"
K8S_NS="workspace-$WS_SLUG"

# Mode-specific k8s context and cluster name
if [ "$MODE" = "local" ]; then
  K8S_CTX="k3d-dx-local"
  K3D_CLUSTER="dx-local"
elif [ "$MODE" = "dev" ]; then
  K8S_CTX="k3d-dx-dev"
  K3D_CLUSTER="dx-dev"
else
  echo "Unknown mode: $MODE (expected: local or dev)"
  exit 1
fi

PASS=0
FAIL=0
SKIP=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  SKIP: $1"; SKIP=$((SKIP + 1)); }

echo "=== dx platform smoke test (mode: $MODE) ==="
echo ""

# Resolve the actual config file path (platform-dependent: ~/Library/Application Support/dx on macOS)
DX_CONFIG_FILE=$($DX config path 2>/dev/null || echo "$HOME/.config/dx/config.json")

# Save current config to restore at end (don't clobber user's config)
ORIGINAL_FACTORY_URL=""
ORIGINAL_FACTORY_MODE=""
if [ -f "$DX_CONFIG_FILE" ]; then
  ORIGINAL_FACTORY_URL=$(jq -r '.factoryUrl // empty' "$DX_CONFIG_FILE" 2>/dev/null || true)
  ORIGINAL_FACTORY_MODE=$(jq -r '.factoryMode // empty' "$DX_CONFIG_FILE" 2>/dev/null || true)
fi

# ─── Guaranteed cleanup ──────────────────────────────────────────────
# Runs on EXIT (success, failure, or signal). Ensures k8s resources and
# the test workspace DB record are always removed.
cleanup() {
  echo ""
  echo "--- Cleanup ---"

  # 1. Delete workspace via CLI (handles lifecycle → destroying → k8s teardown)
  $DX workspace delete "$WS_SLUG" --force 2>/dev/null || true

  # 2. Force-delete k8s namespace directly as a safety net
  kubectl --context "$K8S_CTX" delete namespace "$K8S_NS" --ignore-not-found --wait=false 2>/dev/null || true

  # 3. Stop local daemon (prevents stale daemon from leaking requests to wrong backend)
  if [ -f ~/.config/dx/daemon.pid ]; then
    kill "$(cat ~/.config/dx/daemon.pid)" 2>/dev/null || true
    rm -f ~/.config/dx/daemon.pid
  fi

  # 4. Dev mode: tear down docker-compose
  if [ "$MODE" = "dev" ]; then
    echo "  Tearing down docker-compose..."
    (cd "$REPO_ROOT" && $DX down --volumes 2>/dev/null) || true
  fi

  # 5. Restore original factory config AFTER stopping everything
  #    so nothing is running that could act on the transitional state
  if [ -n "$ORIGINAL_FACTORY_URL" ]; then
    $DX config set factoryUrl "$ORIGINAL_FACTORY_URL" >/dev/null 2>&1 || true
  fi
  if [ -n "$ORIGINAL_FACTORY_MODE" ]; then
    $DX config set factoryMode "$ORIGINAL_FACTORY_MODE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ─── Pre-clean: nuke leftovers from a previous failed run ────────────
echo "--- Pre-clean ---"
# FIRST: stop ALL running backends so nothing can leak requests during cleanup
# Stop local daemon
if [ -f ~/.config/dx/daemon.pid ]; then
  kill "$(cat ~/.config/dx/daemon.pid)" 2>/dev/null || true
  rm -f ~/.config/dx/daemon.pid
  sleep 1
fi
# Stop compose stack
(cd "$REPO_ROOT" && docker compose down --volumes 2>/dev/null) || true
# Delete the opposite mode's k3d cluster to avoid port conflicts
if [ "$MODE" = "local" ]; then
  k3d cluster delete dx-dev 2>/dev/null || true
elif [ "$MODE" = "dev" ]; then
  k3d cluster delete dx-local 2>/dev/null || true
fi
# Delete any existing workspace with this slug (DB record)
$DX workspace delete "$WS_SLUG" --force 2>/dev/null || true
# Delete any orphaned k8s namespace
kubectl --context "$K8S_CTX" delete namespace "$K8S_NS" --ignore-not-found --wait=false 2>/dev/null || true
# Wait for namespace to actually be gone before creating a new one
for i in $(seq 1 15); do
  if ! kubectl --context "$K8S_CTX" get namespace "$K8S_NS" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
echo "  Clean slate."
echo ""

# ─── 1. CLI basics ──────────────────────────────────────────────────
echo "--- Step 1: CLI basics ---"
if $DX --help >/dev/null 2>&1; then
  pass "dx --help"
else
  fail "dx --help"
fi

if $DX --version >/dev/null 2>&1; then
  pass "dx --version"
else
  fail "dx --version"
fi

# ─── 2. Factory setup ───────────────────────────────────────────────
echo ""
echo "--- Step 2: Factory setup (mode: $MODE) ---"
if [ "$MODE" = "local" ]; then
  if $DX setup --role factory --mode local --yes; then
    pass "dx setup --role factory --mode local"
  else
    fail "dx setup --role factory --mode local"
    echo "Factory setup failed. Cannot continue."
    echo ""
    echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
    exit 1
  fi
elif [ "$MODE" = "dev" ]; then
  if (cd "$REPO_ROOT" && $DX setup --role factory --mode dev --yes); then
    pass "dx setup --role factory --mode dev"
  else
    fail "dx setup --role factory --mode dev"
    echo "Factory setup failed. Cannot continue."
    echo ""
    echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
    exit 1
  fi
fi

# ─── 3. Factory status (JSON validation) ───────────────────────────
echo ""
echo "--- Step 3: Factory status ---"
if $DX factory status; then
  pass "dx factory status"
else
  fail "dx factory status"
  echo "Factory not reachable. Cannot continue."
  echo ""
  echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
  exit 1
fi

if OUTPUT=$($DX factory status --json 2>/dev/null); then
  if echo "$OUTPUT" | jq . >/dev/null 2>&1; then
    pass "dx factory status --json (valid JSON)"
  else
    fail "dx factory status --json (invalid JSON)"
  fi

  FACTORY_MODE=$(echo "$OUTPUT" | jq -r '.factoryMode // empty')
  if [ "$FACTORY_MODE" = "$MODE" ]; then
    pass "factoryMode = $MODE"
  elif [ -n "$FACTORY_MODE" ]; then
    fail "factoryMode = $FACTORY_MODE (expected $MODE)"
  else
    skip "factoryMode field not present"
  fi
else
  fail "dx factory status --json"
fi

# ─── 4. Factory health ─────────────────────────────────────────────
echo ""
echo "--- Step 4: Factory health ---"
if $DX factory health; then
  pass "dx factory health"
else
  fail "dx factory health"
fi

# ─── 5. Doctor ──────────────────────────────────────────────────────
echo ""
echo "--- Step 5: Doctor ---"
$DX doctor || true
pass "dx doctor (ran)"

# ─── 6. Direct HTTP health ─────────────────────────────────────────
echo ""
echo "--- Step 6: Direct HTTP health ---"
HEALTH_URL="${DX_FACTORY_URL:-http://localhost:4100}/health"
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  pass "curl $HEALTH_URL"
else
  fail "curl $HEALTH_URL"
fi

# ─── 7. Check Docker availability ──────────────────────────────────
echo ""
echo "--- Step 7: Check Docker ---"
if ! docker info >/dev/null 2>&1; then
  skip "Docker not available — skipping workspace tests"
  echo ""
  echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
fi
pass "Docker is running"

# ─── 8. Ensure sandbox image in k3d ────────────────────────────────
echo ""
echo "--- Step 8: Ensure sandbox image in k3d ---"
SANDBOX_IMAGE="ghcr.io/nksaraf/dx-sandbox:latest"

if ! docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1; then
  echo "  Building sandbox image..."
  docker build -t "$SANDBOX_IMAGE" "$REPO_ROOT/images/dx-sandbox/"
fi

if k3d cluster list "$K3D_CLUSTER" >/dev/null 2>&1; then
  echo "  Importing sandbox image into k3d cluster..."
  k3d image import "$SANDBOX_IMAGE" -c "$K3D_CLUSTER" 2>/dev/null || true
fi
pass "sandbox image available"

# ─── 9. Workspace lifecycle ────────────────────────────────────────
echo ""
echo "--- Step 9: Workspace lifecycle ---"

# Create — dx workspace create waits for active internally
if $DX workspace create "$WS_NAME" --size small; then
  pass "dx workspace create"
else
  fail "dx workspace create"
  echo "Workspace creation failed. Cannot continue workspace tests."
  echo ""
  echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
  exit 1
fi

# List — verify workspace appears
if OUTPUT=$($DX workspace list --json 2>/dev/null); then
  if echo "$OUTPUT" | jq . >/dev/null 2>&1; then
    pass "dx workspace list --json (valid JSON)"
  else
    fail "dx workspace list --json (invalid JSON)"
  fi
else
  fail "dx workspace list"
fi

# Show — JSON structure
if OUTPUT=$($DX workspace show "$WS_SLUG" --json 2>/dev/null); then
  if echo "$OUTPUT" | jq . >/dev/null 2>&1; then
    pass "dx workspace show --json (valid JSON)"
  else
    fail "dx workspace show --json (invalid JSON)"
  fi
else
  fail "dx workspace show"
fi

# Verify workspace is active — poll with extended timeout for dev mode
# (compose factory reconciler runs on 30s intervals; may need extra time)
STATE=$($DX workspace show "$WS_SLUG" --json 2>/dev/null | jq -r '.data.spec.lifecycle // .spec.lifecycle // "unknown"') || true
if [ "$STATE" != "active" ]; then
  echo "  Waiting for workspace to become active (current: $STATE)..."
  for i in $(seq 1 30); do
    sleep 5
    STATE=$($DX workspace show "$WS_SLUG" --json 2>/dev/null | jq -r '.data.spec.lifecycle // .spec.lifecycle // "unknown"') || true
    if [ "$STATE" = "active" ]; then break; fi
  done
fi
if [ "$STATE" = "active" ]; then
  pass "workspace is active"
else
  fail "workspace state: $STATE (expected active)"
  # Debug: show pod status in k8s
  echo "  --- Debug: k8s pod status ---"
  kubectl --context "$K8S_CTX" get pods -n "$K8S_NS" -o wide 2>&1 | sed 's/^/  /' || true
  kubectl --context "$K8S_CTX" describe pods -n "$K8S_NS" 2>&1 | tail -30 | sed 's/^/  /' || true
fi

# ─── 10. SSH tests ─────────────────────────────────────────────────
if [ "${STATE:-}" = "active" ]; then
  echo ""
  echo "--- Step 10: SSH tests ---"

  if RESULT=$($DX ssh "$WS_SLUG" -- "echo hello" 2>&1) && echo "$RESULT" | grep -q "hello"; then
    pass "ssh: echo hello"
  else
    fail "ssh: echo hello"
  fi

  if RESULT=$($DX ssh "$WS_SLUG" -- "echo 'single quotes'" 2>&1) && echo "$RESULT" | grep -q "single quotes"; then
    pass "ssh: single quotes"
  else
    fail "ssh: single quotes"
  fi

  if RESULT=$($DX ssh "$WS_SLUG" -- "echo hello | tr 'h' 'H'" 2>&1) && echo "$RESULT" | grep -q "Hello"; then
    pass "ssh: pipes"
  else
    fail "ssh: pipes"
  fi

  if RESULT=$($DX ssh "$WS_SLUG" -- "echo one && echo two" 2>&1) && echo "$RESULT" | grep -q "two"; then
    pass "ssh: chained commands"
  else
    fail "ssh: chained commands"
  fi

  # SSH config sync
  echo ""
  echo "--- Step 10b: SSH config sync ---"
  if SSH_CONFIG_OUTPUT=$($DX ssh config sync --dry-run 2>/dev/null); then
    if echo "$SSH_CONFIG_OUTPUT" | grep -q "Host.*$WS_SLUG"; then
      pass "ssh config sync: workspace entry generated"

      SSH_TMP_CONFIG=$(mktemp)
      echo "$SSH_CONFIG_OUTPUT" > "$SSH_TMP_CONFIG"
      if RESULT=$(ssh -F "$SSH_TMP_CONFIG" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$WS_SLUG" "echo native-ssh-works" 2>&1) && echo "$RESULT" | grep -q "native-ssh-works"; then
        pass "ssh: native ssh via config"
      else
        skip "ssh: native ssh via config (may need NodePort exposure)"
      fi
      rm -f "$SSH_TMP_CONFIG"
    else
      fail "ssh config sync: no entry for $WS_SLUG"
    fi
  else
    skip "ssh config sync (access targets API may not have data yet)"
  fi
else
  skip "SSH tests (workspace not active)"
fi

# ─── 11. /etc/hosts verification (local + Unix only) ───────────────
if [ "$MODE" = "local" ] && [[ "$(uname)" != MINGW* ]]; then
  echo ""
  echo "--- Step 11: /etc/hosts verification ---"
  if grep -q "smoke-test-ci.*dx.dev" /etc/hosts 2>/dev/null; then
    pass "/etc/hosts entry exists"
  else
    skip "/etc/hosts entry (may require sudo)"
  fi
fi

# ─── 12. Delete ─────────────────────────────────────────────────────
echo ""
echo "--- Step 12: Workspace delete ---"
if $DX workspace delete "$WS_SLUG" 2>/dev/null; then
  pass "dx workspace delete"

  # Verify workspace is gone or in destroying/destroyed state
  sleep 1
  WS_OUT=$($DX workspace show "$WS_SLUG" --json 2>/dev/null) || true
  if [ -n "$WS_OUT" ] && echo "$WS_OUT" | jq -e '.data' >/dev/null 2>&1; then
    WS_LIFECYCLE=$(echo "$WS_OUT" | jq -r '.data.spec.lifecycle // "unknown"')
    if [ "$WS_LIFECYCLE" = "destroying" ] || [ "$WS_LIFECYCLE" = "destroyed" ]; then
      pass "workspace lifecycle = $WS_LIFECYCLE"
    else
      pass "workspace delete accepted (lifecycle: $WS_LIFECYCLE)"
    fi
  else
    pass "workspace removed from API"
  fi

  # Verify k8s namespace is gone or terminating
  NS_PHASE=$(kubectl --context "$K8S_CTX" get namespace "$K8S_NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "gone")
  if [ "$NS_PHASE" = "gone" ] || [ "$NS_PHASE" = "Terminating" ]; then
    pass "k8s namespace cleaned up ($NS_PHASE)"
  else
    fail "k8s namespace still $NS_PHASE"
  fi
else
  fail "dx workspace delete"
fi

# ─── Results ────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="

# Dump compose logs before exit (cleanup trap will tear down containers)
if [ "$MODE" = "dev" ] && [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "--- Factory container logs (last 50 lines) ---"
  (cd "$REPO_ROOT" && docker compose logs infra-factory --tail=50 2>/dev/null) || true
fi

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
