# Connection Contexts — Hybrid Local/Remote Development

**Addendum to: The Component Model & Deployment Reality**

---

## 1. The Real Problem

A developer working on the geoanalytics api doesn't just need their code running. They need it connected to things — a database with realistic data, a redis cache, the auth module's API, maybe the workflow engine. In production these are managed services in a Site. In local dev they're Docker containers with seed data. The gap between those two worlds is where most debugging time goes.

The scenarios developers actually need:

1. **Run api locally, connect to staging postgres.** The seed data in the local container isn't enough — you need real schema, real volume, real edge cases. This is the most common hybrid scenario.

2. **Run api locally, connect to production database read-only.** A customer reports a data bug. You need to see what they see. You can't reproduce it with seed data.

3. **Run frontend locally, point at staging api.** The frontend developer doesn't want to run the entire backend locally. They just need a working API to code against.

4. **Run api locally, connect to a teammate's sandbox.** They're working on the auth module and you need to test against their in-progress changes.

5. **Run api and worker locally, connect to staging for everything else.** You're changing both the api and worker but need real infrastructure for postgres, redis, the auth module, and the analytics module.

6. **Run nothing locally, connect your IDE to a remote sandbox.** The module is too heavy to run locally (GPU workloads, large datasets). You develop remotely but want the same dx workflow.

All of these share a pattern: **the developer's code runs somewhere (local or remote), and its dependencies resolve to a mix of local and remote targets.**

---

## 2. The Model: Connection Context

A **connection context** is a resolved mapping from dependency names to connection details. Every time `dx dev` starts, it builds a connection context that tells each component where to find everything it needs.

### 2.1 The env resolution stack

Environment variables are how components discover their dependencies. The code reads `DATABASE_URL`, `AUTH_API_URL`, `REDIS_URL`, etc. dx resolves these through a layered stack:

```
Layer 1: Component defaults (from docker-compose.yaml dependencies block)
         DATABASE_URL=postgresql://dev:dev@localhost:5432/geoanalytics
         REDIS_URL=redis://localhost:6379

Layer 2: Tier overrides (from .dx/tiers/{tier}.yaml)
         DATABASE_URL=vault://geoanalytics/staging/db-url
         REDIS_URL=redis://staging-redis.data.svc:6379

Layer 3: Connection context overrides (from --connect-to flags or profile)
         DATABASE_URL= (resolved from staging port-forward → localhost:15432)
         AUTH_API_URL= (resolved from staging service → tunneled)

Layer 4: Explicit env flags (from --env on the command line)
         DATABASE_URL=postgresql://custom:custom@somehost:5432/test
```

Higher layers override lower ones. The developer doesn't need to know the final resolved values — dx computes them. But they can always inspect:

```bash
dx env resolve --connect-to staging
# Shows the full resolved env var set, with source annotations:

DATABASE_URL=postgresql://dev:dev@localhost:15432/geoanalytics   # ← tunnel to staging postgres
REDIS_URL=redis://localhost:16379                                 # ← tunnel to staging redis
AUTH_API_URL=http://localhost:18080                               # ← tunnel to staging auth api
ANALYTICS_API_URL=http://localhost:18081                          # ← tunnel to staging analytics
LOG_LEVEL=debug                                                   # ← from .dx/tiers/staging.yaml
```

### 2.2 How connections are declared

**In docker-compose.yaml** — the module declares what it connects to. Not just infrastructure dependencies (postgres, redis) but also module dependencies (other modules' APIs it calls).

```yaml
# docker-compose.yaml
module: geoanalytics
team: analytics-eng

components:
  api:
    path: ./services/api
    port: 8080
    healthcheck: /health
    dev:
      command: uvicorn main:app --reload --port 8080

  worker:
    path: ./services/worker
    worker: true
    dev:
      command: python worker.py

# Infrastructure dependencies — these become containers in local dev
dependencies:
  postgres:
    image: postgis/postgis:16-3.4
    port: 5432
    env:
      POSTGRES_DB: geoanalytics
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    healthcheck: "pg_isready -U dev"

  redis:
    image: redis:7-alpine
    port: 6379

# Module dependencies — these are other modules' APIs this module calls
# In local dev: not started (developer must either mock, connect-to, or run them too)
# In staging/prod: resolved to the co-located module's service endpoint
connections:
  auth:
    module: auth                          # the auth module
    component: api                        # specifically its api component
    env_var: AUTH_API_URL                  # the env var that receives the resolved URL
    local_default: http://localhost:9090   # if running auth locally via dx dev

  analytics:
    module: analytics
    component: api
    env_var: ANALYTICS_API_URL
    local_default: http://localhost:9091
    optional: true                         # geoanalytics works without analytics (degrades gracefully)
```

The `dependencies` block is what gets spun up as containers (postgres, redis). The `connections` block is what gets resolved to URLs (other modules). Together they form the full set of external things this module talks to.

---

## 3. The CLI Surface

### 3.1 Basic hybrid dev

```bash
# Run everything locally (default — all deps as containers, connections warn if not available)
dx dev

# Run api locally, connect all deps + connections to staging
dx dev api --connect-to staging

# Run api and worker locally, connect deps to staging
dx dev api worker --connect-to staging

# Connect deps to a specific sandbox
dx dev api --connect-to sandbox-pr-42

# Connect deps to a specific site
dx dev api --connect-to trafficure-staging-india
```

`--connect-to <target>` resolves the target name to a deployment target, then for each dependency and connection, sets up a tunnel and resolves the env var.

### 3.2 Selective connections

Sometimes you don't want everything from one target. You want staging postgres but local redis. Or staging auth but a teammate's analytics sandbox.

```bash
# Connect postgres to staging, everything else stays local
dx dev api --connect postgres:staging

# Connect postgres to staging, auth to a teammate's sandbox
dx dev api --connect postgres:staging --connect auth:sandbox-alice-auth

# Connect to production database READ-ONLY (requires explicit authorization)
dx dev api --connect postgres:production --readonly

# Connect to staging but override one env var
dx dev api --connect-to staging --env RATE_LIMIT=9999
```

The grammar: `--connect <dependency-or-connection-name>:<target>` for selective, `--connect-to <target>` for everything.

### 3.3 Connection profiles

For common combinations that a team uses repeatedly:

```yaml
# .dx/profiles/staging-deps.yaml
description: "Connect to staging infrastructure, run code locally"
connect:
  postgres: staging
  redis: staging
  auth: staging
  analytics: staging

# .dx/profiles/prod-debug.yaml
description: "Read-only connection to production for debugging"
connect:
  postgres:
    target: production
    readonly: true
  redis: staging              # never connect redis to prod, use staging
  auth: staging
```

```bash
dx dev api --profile staging-deps
dx dev api --profile prod-debug
```

Profiles are checked into git (`.dx/profiles/`). Team-agreed, version-controlled, code-reviewed.

### 3.4 Just give me the env — no local process

Sometimes you don't want dx to run your code. You're running it yourself (in your IDE debugger, or in a test harness, or in a notebook). You just need the resolved environment.

```bash
# Resolve env vars and print them
dx env resolve --connect-to staging
# DATABASE_URL=postgresql://dev:dev@localhost:15432/geoanalytics
# REDIS_URL=redis://localhost:16379
# AUTH_API_URL=http://localhost:18080
# ...

# Export them into current shell
eval $(dx env resolve --connect-to staging --export)

# Write a .env file
dx env resolve --connect-to staging > .env

# Start tunnels without starting your code
dx connect staging
# Tunnels active:
#   postgres: localhost:15432 → staging-postgres.data.svc:5432
#   redis:    localhost:16379 → staging-redis.data.svc:6379
#   auth-api: localhost:18080 → auth-api.service.svc:8080
# Press Ctrl+C to stop.
```

`dx connect <target>` is the bare-metal version — just set up the tunnels, give me the ports, I'll handle the rest. This is what you use when you're running code in a debugger or a Jupyter notebook.

### 3.5 Remote dev — run your code on the cluster

For heavy workloads (ML training, large data processing) or when your laptop can't run the stack:

```bash
# Deploy your branch to a dev target, connected to staging deps
dx dev api --remote --connect-to staging

# This:
# 1. Builds the api component from your current branch
# 2. Creates/updates a dev deployment target (dev-nikhil-geoanalytics)
# 3. Deploys the api workload with staging env vars (no tunnels needed — it's in-cluster)
# 4. Sets up port-forward so you can hit the api from your laptop
# 5. Streams logs to your terminal
# 6. Watches for file changes, rebuilds and redeploys on save (slower than local, but works)

# Or: just open your editor remotely
dx code dev-nikhil-geoanalytics
# Opens VS Code / Cursor SSH remote to the running pod
```

The `--remote` flag switches from "run locally, tunnel to remote deps" to "run remotely in a dev deployment target, tunnel the result back to your laptop." The dev deployment target is the same entity from the component model — kind=dev, your workloads, connected to staging infrastructure.

---

## 4. How Tunnels Work

When `dx dev --connect-to staging` runs, dx needs to make staging's services reachable from the developer's laptop. The mechanism depends on what's being connected:

### 4.1 K8s services → localhost port-forward

For dependencies and connections that resolve to K8s services in a remote cluster:

```
dx dev api --connect-to staging

Under the hood:
  1. dx resolves "staging" to deployment_target: trafficure-staging
  2. For each dependency (postgres, redis):
     - Finds the workload in that target (or the shared infrastructure service)
     - Starts kubectl port-forward to that service
     - Assigns a local port (15432, 16379, etc.)
     - Sets the env var to localhost:<local-port>
  3. For each connection (auth, analytics):
     - Finds the target module's api component workload
     - Starts kubectl port-forward
     - Assigns a local port
     - Sets the env var to http://localhost:<local-port>
  4. Starts the developer's code (via Docker Compose or process) with resolved env
  5. Monitors tunnel health — reconnects if dropped, warns developer
```

The port assignments are deterministic (based on a hash of target + service name) so they're stable across restarts. dx stores them in `.dx/.tunnels.yaml` so other tools can find them.

### 4.2 External managed services → direct connection

For staging/production dependencies that are external services (RDS, ElastiCache, managed Redis), the env var already contains the connection string. dx just resolves the secret from Vault and passes it through. No tunnel needed — the developer's laptop connects directly (assuming network access, VPN, etc.).

```
.dx/tiers/staging.yaml:
  DATABASE_URL: vault://geoanalytics/staging/db-url

dx resolves vault://geoanalytics/staging/db-url → postgresql://staging-geoanalytics:pass@rds-staging.us-east-1.rds.amazonaws.com:5432/geoanalytics

Developer's code gets the real connection string. Network access is the developer's responsibility (VPN, bastion, etc.), but dx can check and warn.
```

### 4.3 Tunnel lifecycle

Tunnels are managed as a background process group tied to the `dx dev` or `dx connect` session:

```bash
dx dev api --connect-to staging
# ... working ...
# Ctrl+C → dx tears down tunnels, stops local containers, cleans up

# Or in a separate terminal:
dx connect status
# Active tunnels:
#   postgres  localhost:15432 → trafficure-staging/postgres:5432     healthy
#   redis     localhost:16379 → trafficure-staging/redis:6379        healthy
#   auth-api  localhost:18080 → trafficure-staging/auth-api:8080     reconnecting...

dx connect stop
# All tunnels closed.
```

---

## 5. Security Model

Connecting to remote environments is powerful and dangerous. A developer with a staging connection can accidentally corrupt staging data. A production connection can leak customer data. The security model has to handle this without being so annoying that people work around it.

### 5.1 Connection permissions

Connection authorization flows through the same SpiceDB model that governs everything else. The check is: **does this principal have `connect` permission on this deployment target?**

```
Deployment Target Kind    Default Permission          Override
─────────────────────────────────────────────────────────────
sandbox (own)             Always allowed              —
sandbox (other's)         Allowed if shared           Team lead can restrict
dev (own)                 Always allowed              —
dev (other's)             Allowed if shared           Team lead can restrict
staging                   Allowed for team members    Requires team membership
production (read-only)    Requires explicit grant     Per-principal, audited
production (read-write)   Denied by default           Requires incident/on-call role, time-limited
```

### 5.2 Production connections

Connecting to production is special. It requires:

1. **Explicit `--readonly` flag** (unless you have read-write grant). dx will not open a read-write production connection without the flag being explicitly absent and a grant being present.

2. **Authorization check** against SpiceDB. The principal needs `connect_readonly` or `connect_readwrite` on the production deployment target.

3. **Time-limited session.** Production connections automatically expire after a configured duration (default: 2 hours). `dx connect` shows a countdown.

4. **Audit log entry.** Every production connection is recorded: who, when, which target, which dependencies, read-only or read-write, duration.

5. **Warning banner.** dx prints a clear, unmissable warning:

```bash
dx dev api --connect postgres:production --readonly

  ┌──────────────────────────────────────────────────────────────┐
  │  ⚠  PRODUCTION CONNECTION — READ ONLY                       │
  │                                                              │
  │  Target:     trafficure-prod-india / postgres                │
  │  Principal:  nikhil@lepton.io                                │
  │  Expires:    2h from now (17:42 IST)                         │
  │  Audit ID:   conn_8f2a3b                                     │
  │                                                              │
  │  This connects your local code to production data.           │
  │  All queries are logged. Connection is read-only.            │
  │  Type 'yes' to continue:                                     │
  └──────────────────────────────────────────────────────────────┘
```

### 5.3 Read-only enforcement

For database connections, `--readonly` is enforced at the connection level, not just promised:

- **PostgreSQL:** dx connects with a read-only user, or sets `default_transaction_read_only = on` on the session. If the module's staging/prod env has separate read-only and read-write credentials in Vault, dx uses the read-only one.
- **Redis:** dx connects to a replica, not the primary. Or uses a read-only user if ACLs are configured.
- **APIs:** There's no generic "read-only" for HTTP APIs. dx passes a header (`X-Connection-Mode: readonly`) that the SDK can check, but enforcement is the API's responsibility. The audit trail is the real safety net here.

### 5.4 Connection isolation

When a developer connects to staging, their local code shares the staging database with other developers and with staging deployments. This is fine — staging is designed for this. But dx provides isolation options when needed:

```bash
# Connect to staging postgres but use a separate schema
dx dev api --connect postgres:staging --schema dev-nikhil

# Connect to staging postgres but use a snapshot (copy-on-write clone if supported)
dx dev api --connect postgres:staging --snapshot
```

Schema isolation works by setting `search_path` on the connection. Snapshots work if the database supports logical cloning (PostgreSQL's `CREATE DATABASE ... TEMPLATE`, or a snapshot-restore workflow).

---

## 6. How This Fits the Data Model

### 6.1 Connection context is not a new entity

Connection contexts are ephemeral, session-scoped, and local to the developer's machine. They don't get stored in the Factory DB. The Factory DB tracks:

- **Deployment targets** (what exists to connect to)
- **Workloads** (what's running in each target)
- **Connection audit events** (who connected to what, when)

The connection context itself is computed at `dx dev` time from the `docker-compose.yaml` connections/dependencies block + the `--connect-to` / `--connect` flags + the tier overlay files. It's a resolved env var set + a set of tunnel specifications. It lives in `.dx/.connection-context.yaml` on the developer's machine for the duration of the session.

### 6.2 Connection profiles are a Build Plane artifact

Profiles (`.dx/profiles/staging-deps.yaml`) are checked into git, version-controlled, and shared across the team. They're a Build Plane concern — part of the module's development infrastructure, like conventions and workflows.

### 6.3 Connection audit events are a Fleet Plane concern

When someone connects to a staging or production deployment target, Fleet Plane records it:

```
connection_audit_event
──────────────────────
event_id                PK
principal_id            FK → principal
deployment_target_id    FK → deployment_target
connected_resources     jsonb (which deps/connections were tunneled)
readonly                boolean
started_at              timestamp
ended_at                timestamp (nullable — updated on disconnect)
session_duration        interval (computed)
reason                  text (nullable — required for production)
```

This joins with the existing `deployment_target` and `principal` tables. No new entities needed — just an audit trail.

### 6.4 The workload table doesn't change

Connecting to staging postgres doesn't create a new workload. The postgres workload already exists in the staging deployment target. The developer's local code just tunnels to it. The component model is untouched — the developer's local process isn't a workload in the Factory's view. It's an untracked local process that happens to be talking to tracked infrastructure.

If the developer uses `--remote` (running on the cluster instead of locally), then a workload IS created in a dev deployment target. That workload's env vars are resolved from the connection context. But the connection context itself is still ephemeral — it's computed at deploy time and baked into the workload's env.

---

## 7. The Complete `dx dev` Flow

Putting it all together, here's what happens when a developer runs `dx dev api --connect-to staging`:

```
1. PARSE CONTEXT
   - Read docker-compose.yaml (module: geoanalytics, components, dependencies, connections)
   - Read docker-compose service labels for api (dev command, build config)
   - Determine target: "staging" → resolve to deployment_target: trafficure-staging

2. AUTHORIZE
   - Check: does this principal have `connect` on trafficure-staging?
   - If staging: check team membership (usually allowed)
   - If production: check explicit grant, require --readonly, prompt for confirmation

3. RESOLVE DEPENDENCIES
   For each dependency in docker-compose.yaml:
     - Look up the equivalent in the staging target
     - postgres → find postgres workload in trafficure-staging
       (or: find the external managed DB connection string from tier overlay)
     - redis → same

4. RESOLVE CONNECTIONS
   For each connection in docker-compose.yaml:
     - auth → find auth module's api component workload in trafficure-staging
     - analytics → find analytics module's api component workload in trafficure-staging
     - If a connected module isn't running in the target → warn, use local_default or skip if optional

5. START TUNNELS
   For each remote resource:
     - kubectl port-forward (or direct connect for external services)
     - Assign deterministic local port
     - Verify tunnel is healthy

6. COMPUTE ENV VARS
   Layer 1: docker-compose.yaml defaults (local URLs)
   Layer 2: .dx/tiers/staging.yaml overrides
   Layer 3: Connection context overrides (tunneled localhost ports)
   Layer 4: Any explicit --env flags
   → Final resolved env var set

7. GENERATE DOCKER COMPOSE (for local components only)
   - api component: runs locally with dev command, gets resolved env vars
   - Dependencies that are NOT connected remotely: spin up as local containers
   - Dependencies that ARE connected remotely: omitted from compose (tunnels handle it)

8. START
   - Docker Compose up (just the api, plus any remaining local deps)
   - Stream logs
   - Watch for file changes → hot reload
   - Monitor tunnel health

9. ON EXIT (Ctrl+C)
   - Docker Compose down
   - Close all tunnels
   - Record connection audit event (duration, which resources were connected)
   - Clean up .dx/.connection-context.yaml
```

---

## 8. Scenario Walkthrough

### Scenario A: Debug a customer data issue

Customer reports wrong data in their geoanalytics dashboard. Developer needs to see what the customer sees.

```bash
# Connect to production DB read-only
dx dev api --connect postgres:production --readonly --reason "Investigating SUPPORT-892"

# dx:
# 1. Checks authorization (nikhil has connect_readonly on production)
# 2. Resolves production DB connection (from vault)
# 3. Shows warning banner, requires confirmation
# 4. Starts tunnel to production postgres (read-only user)
# 5. Starts local api with production DB + local redis + local everything else
# 6. Developer can hit localhost:8080 and see exactly what the customer sees
# 7. All queries logged in audit trail

# Developer identifies the issue: a migration left stale data in a denormalized table
# They don't fix it in production — they write a migration, test it locally, push a PR
```

### Scenario B: Frontend developer needs a working backend

Frontend developer doesn't want to run the backend. They just need a working API.

```bash
# Run frontend locally, point at staging api
dx dev frontend --connect api:staging

# dx:
# 1. Starts tunnel to staging geoanalytics-api
# 2. Resolves GEOANALYTICS_API_URL=http://localhost:18080
# 3. Starts frontend locally with hot reload
# 4. Frontend talks to staging backend through tunnel
```

### Scenario C: Test against a teammate's in-progress changes

Alice is working on auth changes. Nikhil needs to test geoanalytics against them.

```bash
# Alice's sandbox is running
dx sandbox list
# NAME                    MODULE    STATUS    URL
# sandbox-pr-87-auth      auth      active    https://sandbox-pr-87--auth-api.dev.internal

# Nikhil connects to it
dx dev api --connect auth:sandbox-pr-87-auth --connect-to staging

# dx:
# 1. Connects postgres, redis, analytics to staging
# 2. Connects auth to Alice's sandbox
# 3. Runs geoanalytics api locally
# 4. Geoanalytics talks to Alice's in-progress auth through tunnel
```

### Scenario D: Full staging integration, nothing local

Developer wants to deploy their branch to a remote dev target and test it in the cluster alongside staging infrastructure. No local processes.

```bash
dx dev api --remote --connect-to staging

# dx:
# 1. Builds api from current branch
# 2. Creates/updates dev deployment target: dev-nikhil-geoanalytics
# 3. Deploys api workload with staging env vars (in-cluster, no tunnels needed)
# 4. Other components (worker, scheduler) stay on current staging versions
# 5. Port-forwards the remote api to localhost:8080 for the developer to hit
# 6. Streams logs to terminal
# 7. Watches for file changes → rebuild → redeploy (slower than local hot reload)
```

### Scenario E: Just the tunnels, I'll run my own way

Developer is using a debugger in their IDE and doesn't want dx managing their process.

```bash
# Start tunnels only
dx connect staging

# Tunnels active:
#   postgres  localhost:15432 → trafficure-staging/postgres:5432
#   redis     localhost:16379 → trafficure-staging/redis:6379
#   auth-api  localhost:18080 → staging/auth-api:8080
#
# Env file written to .dx/.env.staging
# Source it: eval $(cat .dx/.env.staging)
# Or use: dx env resolve --connect-to staging --export

# Developer starts their debugger with the env vars from .dx/.env.staging
# Tunnels stay up until they Ctrl+C the dx connect process
```

---

## 9. Convention Configuration

Teams can configure what connections are allowed and what profiles exist:

```yaml
# .dx/conventions.yaml (addition)
connections:
  # Which targets can developers connect to?
  allow:
    - kind: sandbox           # anyone can connect to any sandbox
    - kind: dev               # anyone can connect to any dev target
    - kind: staging           # team members can connect to staging
      require: team-member
    - kind: production        # explicit grant required, readonly only
      require: connect-production-grant
      force-readonly: true

  # Default profile when no flags given
  default-profile: null       # null means fully local. "staging-deps" would default to staging.

  # Maximum production connection duration
  production-session-ttl: 2h

  # Require reason for production connections
  production-require-reason: true
```

---

## 10. Summary

Connection contexts don't introduce new entities into the data model. They're a **resolution layer** over existing entities:

- **Deployment targets** already exist — sandbox, staging, production. Connections point at them.
- **Workloads** already exist — the tunnels connect to specific workloads (or external services) within those targets.
- **Authorization** already exists — SpiceDB checks whether the principal can connect to the target.
- **Audit** already exists — connection events are just another audit entry.

The new things are:

| Concept | What it is | Where it lives |
|---|---|---|
| `connections` block in docker-compose.yaml | Declares which other modules this module talks to | Build Plane (source code) |
| Connection profiles | Named, reusable connection configurations | Build Plane (`.dx/profiles/`, checked into git) |
| `dx connect` command | Bare tunnel manager | CLI tool |
| `dx dev --connect-to` | Hybrid dev with remote deps | CLI tool, uses above |
| `connection_audit_event` | Who connected to what, when | Fleet Plane audit table |
| Tunnel manager | Background process managing port-forwards | CLI infrastructure |

The code doesn't know or care where its dependencies are. It reads `DATABASE_URL` and connects. dx makes `DATABASE_URL` point to the right place — local container, staging tunnel, production read-only connection — depending on the connection context. Same code, same image, different wiring.
