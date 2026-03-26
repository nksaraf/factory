# Hybrid Development & Connection Profiles

**Addendum to: The Component Model & Deployment Reality**

---

## 1. The Real Development Modes

When we said `dx dev` starts everything locally, that's the simple case. In practice developers work in five modes, and the architecture needs to support all of them without separate code paths:

```
Mode 1: Fully local          Everything on laptop. Docker Compose.
Mode 2: Local + remote deps  Code on laptop, database in staging.
Mode 3: Local + remote APIs  Code on laptop, calling staging auth/analytics APIs.
Mode 4: Remote dev           Code runs in a remote sandbox, developer connects via VS Code.
Mode 5: Selective hybrid     Some components local, some remote, some dependencies local, some remote.
```

The original dx PRD had `dx dev api --connect-to staging` as a one-liner, but that hides enormous complexity. What does "connect to staging" actually mean? Which staging? Which dependencies? What about auth? What about the fact that your laptop can't reach K8s cluster-internal service endpoints?

---

## 2. The Mechanism: Environment Resolution

Every component discovers its dependencies through environment variables. This is already true — `DATABASE_URL`, `REDIS_URL`, `AUTH_API_URL`, etc. The component doesn't know or care whether the database is a Docker container on the laptop or a managed PostgreSQL instance in production. It just reads the URL from the environment.

So "hybrid dev" isn't a special infrastructure feature. It's an **environment resolution** problem. The question is: which set of URLs does this component get?

### The resolution stack

When a component starts (in any mode — local, sandbox, staging, production), its environment variables are resolved by merging layers, top-down:

```
Layer 1: Component defaults           (from dx.yaml, component-level env)
Layer 2: Module defaults               (from dx.yaml, module-level env)
Layer 3: Dependency auto-discovery     (generated from dependency declarations)
Layer 4: Tier overrides                (from .dx/tiers/staging.yaml, etc.)
Layer 5: Target overrides              (specific to this deployment target)
Layer 6: Connection profile overrides  (hybrid dev — the new thing)
Layer 7: Manual overrides              (dx env set, --env flags)
```

Layer 6 is the new concept. A **connection profile** says "for these specific dependencies, use the endpoints from that remote deployment target instead of local ones."

---

## 3. Connection Profiles

A connection profile is a named, reusable description of which dependencies to resolve from where.

### Declared in config

```yaml
# .dx/profiles/staging-deps.yaml
name: staging-deps
description: "Local components, staging databases and caches"

connect:
  postgres:
    from: staging                    # resolve from the staging deployment target
  redis:
    from: staging
  # everything else: local (default)
```

```yaml
# .dx/profiles/staging-full.yaml
name: staging-full
description: "Local components, all staging dependencies and APIs"

connect:
  postgres:
    from: staging
  redis:
    from: staging
  auth-api:
    from: staging                    # resolve the auth module's api component URL
  analytics-api:
    from: staging
```

```yaml
# .dx/profiles/prod-readonly.yaml
name: prod-readonly
description: "Local components, production read-replica for realistic data"

connect:
  postgres:
    from: trafficure-prod-india
    override:
      POSTGRES_URL: "postgresql://readonly:${VAULT_SECRET}@prod-replica.internal:5432/geoanalytics"
    readonly: true                   # enforces read-only connection string if possible
```

### Ad-hoc from the CLI

Most of the time, developers don't need a profile file. They just say what they want:

```bash
# Connect all dependencies to staging
dx dev --connect-to staging

# Connect specific dependencies to staging
dx dev --connect postgres:staging --connect redis:staging

# Connect to a specific sandbox's dependencies
dx dev api --connect postgres:sandbox-pr-42

# Connect to a named profile
dx dev --profile staging-deps

# Connect to production read-replica (requires explicit confirmation)
dx dev --connect postgres:trafficure-prod-india --readonly
```

### What `--connect-to staging` actually does

When a developer runs `dx dev api --connect-to staging`:

1. dx resolves "staging" to a deployment target (the staging deployment_target for this module's product).

2. For each dependency declared in `dx.yaml`, dx checks if that dependency exists as a workload or resolvable endpoint in the staging target.

3. For matched dependencies, dx resolves the staging endpoint and **substitutes it into the local component's environment variables**.

4. For unmatched dependencies (or ones not specified for remote connection), dx runs them locally as Docker Compose services as usual.

5. dx establishes the network path (see section 4).

6. dx starts the local component with the hybrid env vars.

The generated Docker Compose (or process env) looks like:

```yaml
# .dx/generated/docker-compose.yaml (generated, inspectable, escape-hatch)
services:
  api:
    build: ./services/api
    ports: ["8080:8080"]
    environment:
      # Resolved from staging deployment target
      DATABASE_URL: "postgresql://dev:${STAGING_DB_PASS}@localhost:15432/geoanalytics"
      REDIS_URL: "redis://localhost:16379"
      # Still local
      OBJECT_STORAGE_URL: "http://minio:9000"
    volumes:
      - ./services/api:/app
    depends_on: [minio]   # only local deps listed

  # Local-only dependencies (not connected to staging)
  minio:
    image: minio/minio
    ports: ["9000:9000"]

  # NOTE: postgres and redis are NOT in this compose file.
  # They're accessed via port-forward tunnels to staging.
```

---

## 4. The Network Path: How Local Reaches Remote

A container on the developer's laptop can't directly reach `postgres.staging.svc.cluster.local:5432`. It needs a tunnel.

### Port forwarding

dx establishes `kubectl port-forward` tunnels for each remote dependency. This is the standard K8s pattern — no custom networking, no VPN, no service mesh extension.

```bash
dx dev api --connect-to staging

  Starting tunnels to staging...
    postgres: localhost:15432 → staging/postgres:5432  ✓
    redis:    localhost:16379 → staging/redis:6379     ✓
  
  Starting local services...
    minio:    localhost:9000  ✓
    api:      localhost:8080  ✓ (hot-reload active)
  
  ⚠  Connected to staging. Writes to staging database are real.
  
  Press Ctrl+C to stop.
```

The port-forward processes are managed by dx as child processes. When `dx dev` stops, the tunnels close. Local ports are auto-assigned to avoid conflicts (15432 instead of 5432), and the environment variables point to the local tunnel endpoints.

### For remote APIs (other modules)

When connecting to another module's API (not a database dependency but a service dependency), dx uses the same port-forward mechanism:

```bash
dx dev api --connect auth-api:staging

  Starting tunnels to staging...
    auth-api: localhost:18080 → staging/auth-api:8080  ✓

  Environment:
    AUTH_API_URL=http://localhost:18080
```

### For sandbox-to-sandbox connections

An agent or developer might want sandbox A to connect to sandbox B's database. Same mechanism — dx sets up the tunnel and resolves the env vars.

```bash
# Agent testing: spin up a sandbox that uses another sandbox's data
dx sandbox create integration-test \
  --connect postgres:sandbox-pr-42
```

---

## 5. The Data Model

Connection profiles don't need a heavy data model. They're primarily a CLI/dev-time concern, not a Fleet Plane entity. But the *act* of connecting to remote targets needs to be tracked for audit and security.

### Profile definition (in code, not DB)

```yaml
# Lives in .dx/profiles/*.yaml or is generated ad-hoc from CLI flags
# Not stored in Factory DB — these are developer-local configurations
# Checked into git so the team shares profiles

connection_profile:
  name: string
  description: string
  connect:
    <dependency_or_component_name>:
      from: <deployment_target_name>
      override: map[string]string    # explicit env var overrides
      readonly: boolean              # hint to use read-only endpoints
```

### Active connections (tracked in Factory DB)

When a developer actually connects to a remote target, it's recorded:

```
dev_connection
──────────────
connection_id         PK
principal_id          FK → principal (who connected)
source_kind           "local" | "sandbox" | "dev"
source_target_id      FK → deployment_target (nullable, null if local laptop)
remote_target_id      FK → deployment_target (what they connected to)
dependencies          jsonb (which specific dependencies were tunneled)
readonly              boolean
started_at            timestamp
ended_at              timestamp (nullable — set when tunnel closes)
```

This gives you audit visibility: "Nikhil had a tunnel open to staging postgres from 09:00 to 17:30 on Tuesday." It also enables security policies (see section 7).

---

## 6. The Five Modes, Revisited

Here's how each development mode maps to the data model:

### Mode 1: Fully local (`dx dev`)

```
No deployment_target.
No workloads in Factory DB.
Docker Compose on laptop.
All deps local containers.
No tunnels. No dev_connection record.
Environment resolved from: layers 1-3 only (defaults + dependency auto-discovery).
```

This is the zero-config, works-offline, escape-hatch mode. A new developer on day one can `dx dev` with no platform connection at all.

### Mode 2: Local + remote deps (`dx dev --connect-to staging`)

```
No deployment_target for the local component.
Remote deployment_target for staging exists (managed by Fleet).
Tunnels established to staging deps.
dev_connection record created.
Local component gets hybrid env vars.
Environment resolved from: layers 1-4 + layer 6 (profile overrides staging deps).
```

The component runs on the laptop. The dependencies are in staging. Writes are real. dx shows a warning.

### Mode 3: Local + remote APIs (`dx dev --connect auth-api:staging`)

```
Same as Mode 2, but tunneling to another module's component,
not just infrastructure dependencies.
```

The developer is running their geoanalytics api locally but calling the staging auth api. This means the local code gets real authentication responses, real tokens, real user data. Powerful for integration testing. Dangerous if you accidentally write production code that depends on staging-only quirks.

### Mode 4: Remote dev (`dx dev --remote` or `dx sandbox create --persistent`)

```
deployment_target created (kind: dev or sandbox).
Workloads created for all components.
Dependency workloads created.
Everything runs in K8s.
Developer connects via dx code (VS Code remote) or dx ssh.
No tunnels needed — everything is already in the cluster.
Environment resolved from: layers 1-5 (full stack, target-specific overrides).
```

The developer's laptop is just a thin client. All compute is remote. This is useful when the module is resource-heavy, when the developer is on a weak laptop, or when the module has Linux-specific dependencies that don't work on macOS.

### Mode 5: Selective hybrid (`dx dev api worker --connect postgres:staging --connect redis:local`)

```
api and worker run locally.
scheduler and migrator don't run (not requested).
postgres tunneled from staging.
redis runs locally in Docker Compose.
dev_connection record tracks the staging tunnel.
Environment resolved from: layers 1-3 + selective layer 6 overrides.
```

This is the fine-grained case. The developer picks exactly which components run and which dependencies come from where. In practice, the most common selective hybrid is "run the thing I'm coding on locally, connect the database to staging so I have real data, keep everything else local for speed."

---

## 7. Security: The Guardrails

Connecting local code to remote data is powerful and dangerous. The architecture needs guardrails that are helpful, not hostile.

### Tier-based connection policies

The deployment target's tier policies control who can connect to it:

```yaml
# Tier policy on the staging deployment target
tier_policies:
  allow_dev_connections: true         # developers can tunnel in
  allow_write_connections: true       # tunnels can write
  require_auth: true                  # tunnel requires authenticated dx session
  allowed_teams: [analytics-eng, platform-eng]  # only these teams
```

```yaml
# Tier policy on a production deployment target
tier_policies:
  allow_dev_connections: true         # yes, but...
  allow_write_connections: false      # read-only tunnels only
  require_auth: true
  require_approval: true              # needs a second person to approve
  allowed_teams: [platform-eng]      # only platform team
  max_duration: 2h                   # tunnels auto-close after 2 hours
  audit_level: high                  # extra logging
```

### Connection lifecycle

```
Developer: dx dev api --connect postgres:production --readonly

dx checks:
  1. Is developer authenticated? (Better-Auth session)
  2. Does the production target allow dev connections? (tier_policies)
  3. Is the developer in an allowed team? (SpiceDB role check)
  4. Is --readonly specified? (required for production)
  5. Does this need approval? (tier_policies.require_approval)

If approval required:
  dx: "Connection to production requires approval. Request sent to #platform-eng."
  Approver: "dx approve connection-request-847"
  dx: "Approved by alice@lepton.io. Tunnel expires in 2h."

If no approval needed:
  dx: "⚠ Connecting to production (read-only). Tunnel expires in 2h."

dev_connection record created with all details.
kubectl port-forward established.
Timer starts for max_duration.
At expiry: tunnel closes, dev_connection.ended_at set.
```

### The big red warning

When connecting to staging or production, dx must be unambiguous:

```
$ dx dev api --connect-to staging

  ╔══════════════════════════════════════════════════════════════╗
  ║  ⚠  CONNECTING TO STAGING                                   ║
  ║                                                              ║
  ║  Your local code will read and write to staging databases.   ║
  ║  Changes are real and affect the staging environment.        ║
  ║                                                              ║
  ║  Connected dependencies:                                     ║
  ║    postgres → staging (trafficure-staging)                   ║
  ║    redis    → staging (trafficure-staging)                   ║
  ║                                                              ║
  ║  Local dependencies:                                         ║
  ║    minio    → local Docker container                         ║
  ╚══════════════════════════════════════════════════════════════╝

  Continue? [y/N]
```

For production, the warning is even louder, and `--readonly` is required (unless `--force --reason` is used):

```
$ dx dev api --connect-to trafficure-prod-india

  ✗ Cannot connect to production without --readonly flag.
  
  If you need write access: dx dev api --connect-to trafficure-prod-india \
    --force --reason "Debugging data corruption issue INCIDENT-847"
  
  This will be logged and require approval from a platform-eng member.
```

---

## 8. Beyond Modules: Standalone Apps and Scripts

Not everything is a module. Sometimes a developer is writing:

- A one-off data migration script
- A standalone CLI tool that talks to the platform APIs
- A Jupyter notebook doing analysis against staging data
- A third-party integration test harness
- A load test tool

These aren't modules. They don't have `dx.yaml`. They don't have components. But they still need to connect to remote deployment targets.

### `dx connect` — standalone connection mode

```bash
# Open a tunnel to staging postgres, just give me the env vars
dx connect staging postgres

  Tunnel established:
    POSTGRES_URL=postgresql://dev:***@localhost:15432/geoanalytics
  
  Export:
    export POSTGRES_URL="postgresql://dev:***@localhost:15432/geoanalytics"
  
  Or source it:
    eval $(dx connect staging postgres --export)
  
  Or write an .env file:
    dx connect staging postgres --env-file .env
  
  Tunnel will close when you press Ctrl+C or close this terminal.
```

```bash
# Multiple dependencies
dx connect staging postgres redis auth-api

# Production read-only
dx connect trafficure-prod-india postgres --readonly

# Dump connection info without establishing tunnel (for tools that manage their own connections)
dx connect staging postgres --info-only --json
{
  "host": "postgres.trafficure-staging.svc.cluster.local",
  "port": 5432,
  "user": "dev",
  "database": "geoanalytics",
  "requires_tunnel": true,
  "tunnel_command": "kubectl port-forward -n trafficure-staging svc/postgres 15432:5432"
}
```

`dx connect` is the escape hatch for anything that's not a module. A data scientist can `eval $(dx connect staging postgres --export)` and then run their Python script normally. A load test tool can read the `.env` file. The connection is still tracked, still audited, still subject to tier policies.

### `dx env resolve` — environment resolution as a standalone operation

```bash
# Show what env vars a component would get in a specific context
dx env resolve api --tier staging
  DATABASE_URL=postgresql://...
  REDIS_URL=redis://...
  AUTH_API_URL=https://...
  LOG_LEVEL=debug

# Show what env vars would look like with a connection profile
dx env resolve api --profile staging-deps
  DATABASE_URL=postgresql://dev:***@localhost:15432/geoanalytics  (from staging)
  REDIS_URL=redis://localhost:16379  (from staging)
  OBJECT_STORAGE_URL=http://localhost:9000  (local)
  LOG_LEVEL=debug  (from tier override)

# Dump as .env file
dx env resolve api --profile staging-deps --env-file .env

# Dump as JSON (for programmatic consumption)
dx env resolve api --tier production --json
```

This is useful for debugging ("why is my component connecting to the wrong database?"), for scripts, and for CI pipelines.

---

## 9. How This Fits the Component Model

The connection profile system doesn't add new entities to the component/workload model. It operates at the **environment resolution layer** — the moment when a component's abstract dependency declarations get resolved into concrete URLs.

```
DEFINE (dx.yaml)
  module: geoanalytics
  components: [api, worker]
  dependencies: [postgres, redis]

BUILD (Build Plane)
  (unchanged — connection profiles don't affect builds)

RESOLVE ENVIRONMENT (the new part)
  For each component, resolve its env vars by merging:
    1. Component defaults
    2. Module defaults
    3. Dependency auto-discovery (local or remote, depending on profile)
    4. Tier overrides (.dx/tiers/*.yaml)
    5. Target overrides (per deployment_target)
    6. Connection profile overrides (hybrid dev)
    7. Manual overrides (CLI flags)

  Output: a flat map of ENV_KEY=VALUE for the component

DEPLOY / RUN
  The resolved env map is:
    - Passed to Docker Compose (for dx dev, local)
    - Written to K8s Secret (for sandbox/staging/production)
    - Available via dx env resolve (for standalone tools)
```

The workload entity already has `env_overrides` (jsonb). When a sandbox or dev target is created with connection profile overrides, those overrides land in the workload's `env_overrides` field. The reconciler applies them like any other override. No special handling.

For local `dx dev` (no deployment target, no workload entity), the resolution is in-memory — dx resolves the env, writes the Docker Compose file, starts containers. Nothing persisted to Factory DB except the `dev_connection` audit record for the tunnel.

---

## 10. CLI Summary

```bash
# Hybrid dev — run locally, connect deps to remote
dx dev --connect-to <target>                       All deps from target
dx dev --connect <dep>:<target>                    Specific dep from target
dx dev --connect <dep>:<target> --readonly         Read-only connection
dx dev --profile <n>                            Use a saved connection profile

# Standalone connection — for scripts, notebooks, tools
dx connect <target> <dep> [dep...]                 Open tunnel, print env vars
dx connect <target> <dep> --export                 Print as export statements
dx connect <target> <dep> --env-file .env          Write .env file
dx connect <target> <dep> --info-only --json       Connection info without tunnel

# Environment resolution — inspect what a component would get
dx env resolve <component> --tier <tier>           Resolve for a tier
dx env resolve <component> --profile <profile>     Resolve with connection profile
dx env resolve <component> --target <target>       Resolve for a specific target
dx env resolve --env-file .env                     Dump to .env file

# Connection management
dx connect list                                    Active tunnels
dx connect close <connection-id>                   Close a specific tunnel
dx connect close --all                             Close all tunnels
```

---

## 11. Summary

The hybrid development model is not a separate system. It's a **layer in the environment resolution stack** (layer 6) that lets developers selectively override where dependencies come from.

Mechanically, it's `kubectl port-forward` tunnels managed by dx, with env vars rewritten to point at the tunnel endpoints.

From a security perspective, it's tier policies on deployment targets controlling who can connect and with what permissions, plus audit records for every tunnel.

From a data model perspective, it adds one entity (`dev_connection` for audit) and one configuration concept (`connection_profile` in `.dx/profiles/`). Everything else — components, workloads, deployment targets, the reconciler — is unchanged.

The three principles:

1. **The component doesn't know.** It reads `DATABASE_URL` from the environment. It doesn't know if that points to a Docker container on the laptop, a staging database, or a production read-replica. The component code is identical in all modes.

2. **The developer chooses.** `dx dev` defaults to fully local. `--connect-to` selectively overrides. Profiles save common configurations. The developer is always in control of what connects where.

3. **The platform tracks.** Every tunnel to a non-local target is recorded. Tier policies govern what's allowed. Production requires explicit intent. The audit trail is complete.
