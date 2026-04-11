# Sandbox CLI Commands: ssh, logs, open + Health Checks

## Context

Sandbox pods run two containers (`workspace` + `dind`) in namespace `sandbox-{slug}`, exposed via a NodePort Service on ports 22 (SSH) and 8080 (web-terminal). The API already tracks `sshPort`, `webTerminalUrl`, and `podName` on the sandbox record. The `dx sandbox exec` command exists for kubectl-based shell access.

This spec adds three convenience commands and a health-check system to close the gaps.

---

## 1. `dx sandbox ssh`

**Purpose**: SSH into a sandbox without needing to know the NodePort or hostname.

### Interface

```
dx sandbox ssh <id|slug> [flags]
  --user, -u      SSH user (default: "root", or from devcontainer.json remoteUser)
  --key, -i       Path to SSH private key
  --port, -p      Override port (auto-detected from API)
  --forward, -L   Local port forward (e.g. "8080:localhost:3000")
  --context        kubectl context (used to resolve node IP)
```

### Flow

1. `GET /sandboxes/{id}` — resolve sandbox, get `sshPort` and `sshHost`
2. If `sshPort` is null → sandbox not ready, show error with suggestion to use `dx sandbox exec`
3. Resolve target host:
   - If `sshHost` is set in DB → use it
   - If running against local k3d → resolve to `localhost` (NodePort on host)
   - Otherwise → get node external IP from cluster info
4. Exec `ssh -p {sshPort} {user}@{host}` with stdio inherited (interactive)

### Prerequisite

SSH requires an SSH server inside the container. The devcontainer needs the `sshd` feature:

```json
{ "features": { "ghcr.io/devcontainers/features/sshd:1": {} } }
```

If the sandbox has no SSH server and the user tries `dx sandbox ssh`, detect connection refused and suggest:

```
SSH connection failed. The sandbox may not have an SSH server installed.
Add "ghcr.io/devcontainers/features/sshd:1" to your devcontainer.json,
or use: dx sandbox exec <id>
```

### SSH Key Management (future)

Not in scope for v1, but the shape:

- `dx sandbox ssh-key add <id> --pubkey ~/.ssh/id_ed25519.pub` → injects key into sandbox
- On sandbox create, auto-inject the user's default pubkey if available
- Store authorized keys in a ConfigMap mounted into the pod

---

## 2. `dx sandbox logs`

**Purpose**: Stream sandbox build/runtime logs without needing kubectl.

### Interface

```
dx sandbox logs <id|slug> [flags]
  --container, -c   Container name: "workspace" (default), "dind", "clone-repos"
  --follow, -f      Stream logs in real-time (default: true)
  --tail, -n        Number of lines to show from the end (default: 100)
  --build           Show only the envbuilder build phase (filter until "Running init command")
  --context         kubectl context override
  --timestamps      Show timestamps on each line
  --previous        Show logs from previous container instance (useful after restart/restore)
```

### Flow

1. `GET /sandboxes/{id}` — resolve sandbox, get `slug` and `podName`
2. If sandbox status is `provisioning` → show "Sandbox is still provisioning, logs will appear shortly..." then start polling
3. Build kubectl args:
   ```
   kubectl logs {podName} -n sandbox-{slug} -c {container}
     [--follow] [--tail={n}] [--timestamps] [--previous]
     [--context={ctx}]
   ```
4. Exec kubectl with stdio inherited (streams to terminal)
5. If `--build` flag: pipe through a filter that stops output after detecting `"Running init command"` line

### Build Progress UX

When `--build` is used, parse envbuilder output for progress indicators:

```
Cloning https://github.com/... → [clone]
Extracting layer 5/16 (27.6%) → [build] Extracting layers... 5/16
RUN apt-get install ...        → [build] Running: apt-get install ...
Built image! [37.8s]           → [done] Image built in 37.8s
```

This is purely cosmetic formatting on the CLI side — no API changes needed.

---

## 3. `dx sandbox open`

**Purpose**: Open the sandbox web terminal or a forwarded port in the browser.

### Interface

```
dx sandbox open <id|slug> [flags]
  --port, -p    Open a specific forwarded port (e.g. 3000 for a dev server)
  --url         Print the URL instead of opening the browser
```

### Flow

1. `GET /sandboxes/{id}` — resolve sandbox, get `webTerminalUrl` and `slug`
2. Determine URL:
   - Default: `webTerminalUrl` (e.g. `https://gdal-e2e.sandbox.dx.dev`)
   - If `--port`: construct `https://{slug}-{port}.sandbox.dx.dev` (requires gateway wildcard routing — future) or fall back to `http://localhost:{nodeport}` for local k3d
3. If `--url`: print the URL and exit
4. Otherwise: `open {url}` (macOS) / `xdg-open {url}` (Linux) / `start {url}` (Windows)

### Local k3d Mode

For local development where the gateway isn't fully wired:

- `dx sandbox open` → opens `http://localhost:{sshPort+1}` or the web-terminal NodePort
- Detect local mode by checking if `factoryUrl` contains `localhost`

### Port Forwarding (future enhancement)

For accessing arbitrary ports inside the sandbox (e.g. a dev server on :3000):

```
dx sandbox open <id> --port 3000
```

This would:

1. Start a background `kubectl port-forward` for `sandbox-{slug}:{port}`
2. Open `http://localhost:{localPort}` in the browser
3. Keep the port-forward running until the user presses Ctrl+C

---

## 4. Sandbox Health Checks

**Purpose**: Detect when a sandbox is actually ready (envbuilder finished, workspace container is interactive) vs just "pod is running".

### Problem

Currently, status goes `provisioning → active` as soon as k8s resources are applied. But envbuilder may still be building the image (takes 30s-16min). The sandbox is technically "running" but not usable.

### Solution: Two-Phase Readiness

#### Phase A: Pod Readiness Probe

Add a readiness probe to the workspace container that checks if envbuilder has finished:

```yaml
readinessProbe:
  exec:
    command: ["sh", "-c", "test -f /tmp/.envbuilder-ready"]
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 120 # 10 min max
```

The envbuilder init script creates this sentinel file:

```sh
cp -a /workspace-pvc/. /workspaces/ 2>/dev/null;
touch /tmp/.envbuilder-ready;
(while true; do sleep 30; cp -a /workspaces/. /workspace-pvc/ 2>/dev/null; done) &
sleep infinity
```

This means the k8s readiness probe will report the container as ready only after envbuilder finishes. The pod goes from `0/2 Running` → `1/2 Running` (dind ready) → `2/2 Running` (workspace ready).

#### Phase B: Status Reconciliation Loop

Add a background reconciliation loop that polls k8s pod status and updates the DB:

**New fields on `sandbox` table:**

```sql
ALTER TABLE factory_fleet.sandbox
  ADD COLUMN health_status TEXT DEFAULT 'unknown',  -- unknown | building | ready | unhealthy | terminated
  ADD COLUMN health_checked_at TIMESTAMPTZ;
```

**Reconciler behavior** (new method: `reconcileSandboxHealth`):

1. Get pod status from k8s: `kubectl get pod sandbox-{slug} -n sandbox-{slug} -o json`
2. Map to health status:
   - Pod not found → `terminated`
   - Pod running, workspace container not ready → `building`
   - Pod running, all containers ready → `ready`
   - Pod in CrashLoopBackOff or Error → `unhealthy`
3. Update `health_status` and `health_checked_at` in DB
4. If `unhealthy`: set `statusMessage` with the container's last termination reason

**Trigger options** (pick one):

- **Option A: Polling loop** — reconciler checks all `active` sandboxes every 30s (simple, scales to ~100 sandboxes)
- **Option B: On-demand** — health check runs when `GET /sandboxes/:id` is called and `health_checked_at` is stale (>30s). Lazy but precise.
- **Option C: k8s watch** — watch pod events via k8s API. Most responsive but requires persistent connection per cluster.

**Recommendation**: Start with Option B (on-demand with staleness check). It's zero-overhead for inactive sandboxes and gives fresh data when the user is actually looking.

#### Phase C: CLI Integration

Update `dx sandbox show` to display health:

```
  Health:    ready (checked 5s ago)
  Build:     complete (37.8s)
```

Update `dx sandbox list` to show health column:

```
ID                     Name       Status   Health     Created
sbx_abc123...          gdal-e2e   active   building   2m ago
sbx_def456...          my-dev     active   ready      1h ago
```

Update `dx sandbox create --wait` to wait for `health_status = ready` instead of just `status = active`:

```
Provisioning sandbox... (applying resources)
Building image... (envbuilder: extracting layers 5/16)
Sandbox "gdal-e2e" is ready.
```

### Health Check API Endpoint

New endpoint for explicit health check:

```
GET /sandboxes/:id/health
→ { status: "ready", checkedAt: "...", container: "workspace", buildDuration: 37800 }
```

This calls the reconciler's health check synchronously and returns fresh data.

---

## Implementation Order

1. **`dx sandbox logs`** — Simplest, just wraps kubectl logs. Immediate value for debugging envbuilder builds.
2. **`dx sandbox open`** — Simple URL resolution + `open` command. Useful once web terminal is wired.
3. **Health checks (Phase A)** — Readiness probe + sentinel file in init script. Small change, big UX improvement.
4. **`dx sandbox ssh`** — Requires SSH server in devcontainer. Works today with the sshd feature.
5. **Health checks (Phase B)** — DB column + on-demand reconciliation. Enables smart `--wait` behavior.
6. **Health checks (Phase C)** — CLI display integration. Polish.

---

## Files to Modify

| File                                               | Changes                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `cli/src/commands/sandbox.ts`                      | Add `ssh`, `logs`, `open` commands                                           |
| `api/src/reconciler/sandbox-resource-generator.ts` | Add readiness probe to workspace container, update init script with sentinel |
| `api/src/reconciler/reconciler.ts`                 | Add `reconcileSandboxHealth()` method                                        |
| `api/src/services/sandbox/sandbox.service.ts`      | Add `getSandboxHealth()`, `updateSandboxHealth()`                            |
| `api/src/modules/infra/sandbox.controller.ts`      | Add `GET /:id/health` endpoint                                               |
| `api/src/db/schema/fleet.ts`                       | Add `healthStatus`, `healthCheckedAt` columns to sandbox table               |
| `api/drizzle/0004_sandbox_health.sql`              | Migration for new columns                                                    |
