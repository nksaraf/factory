#!/bin/bash
set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspaces}"
mkdir -p "$WORKSPACE_DIR"

# --- Claude Code auto-auth ---
# Claude Code reads ANTHROPIC_API_KEY from the environment automatically.
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "[dx-entrypoint] ANTHROPIC_API_KEY detected — Claude Code auth enabled."
fi

# --- Start SSH server on port 22 ---
mkdir -p /run/sshd
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PermitEmptyPasswords.*/PermitEmptyPasswords yes/' /etc/ssh/sshd_config
passwd -d root 2>/dev/null || true
/usr/sbin/sshd
echo "[dx-entrypoint] sshd started on :22"

# --- Start ttyd (web terminal) on port 8080 ---
ttyd \
  --port 8080 \
  --writable \
  --cwd "$WORKSPACE_DIR" \
  bash &
TTYD_PID=$!
echo "[dx-entrypoint] ttyd started on :8080 (PID $TTYD_PID)"

# --- Start openvscode-server (web IDE) on port 8081 ---
openvscode-server \
  --host 0.0.0.0 \
  --port 8081 \
  --without-connection-token \
  --default-folder "$WORKSPACE_DIR" &
VSCODE_PID=$!
echo "[dx-entrypoint] openvscode-server started on :8081 (PID $VSCODE_PID)"

# --- Keep container alive ---
# Wait for either process; if one dies the other keeps running.
wait -n "$TTYD_PID" "$VSCODE_PID" 2>/dev/null || true
wait
