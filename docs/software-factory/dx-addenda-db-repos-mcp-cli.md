# dx Addenda — Database Helpers, Repo Types, MCP Server, CLI Standards

**Addendum to: The Unified dx Architecture & Component Model**

---

# Part 1: `dx db` — Database Helpers

## 1.1 The Problem

Database work is the most error-prone part of the development lifecycle. Migrations fail halfway. Production data diverges from what tests expect. Debugging a customer issue means staring at raw SQL against a schema you half-remember. Backup restores are an art practiced by one person on the team who's always on vacation when you need them.

`dx db` is the database companion for every phase: local dev, debugging, migration authoring, production ops. It works against the module's declared postgres dependency (from `docker-compose.yaml`), resolving the target via the same connection context system as `dx dev`.

## 1.2 Command Surface

### Development & Debugging

```bash
# Connect to an interactive psql session
dx db connect                             # local dev db (default)
dx db connect --target staging            # staging db (via tunnel)
dx db connect --target production --readonly  # prod db (read-only, audited)
dx db connect --target sandbox-pr-42      # sandbox db

# Quick query without entering psql
dx db query "SELECT count(*) FROM orders WHERE status = 'pending'"
dx db query "SELECT * FROM users WHERE email = 'bug-report@customer.com'" --target production --readonly
dx db query -f ./debug/check-orphans.sql --target staging

# Describe schema
dx db schema                              # show all tables and columns
dx db schema orders                       # show one table detail (columns, indexes, constraints, RLS policies)
dx db schema --diff staging               # diff local schema against staging
dx db schema --diff production            # diff local schema against production

# Table exploration
dx db tables                              # list all tables with row counts and sizes
dx db tables --filter "order*"            # glob filter
dx db indexes                             # list all indexes with usage stats
dx db indexes --unused                    # indexes that haven't been used (candidates for removal)
dx db constraints                         # list FKs, checks, unique constraints
dx db sequences                           # sequences and their current values
dx db extensions                          # installed extensions (postgis, ltree, pgvector, etc.)

# Tenant-aware queries (for Site databases with RLS)
dx db query "SELECT * FROM orders LIMIT 10" --tenant samsung --target staging
# This sets app.current_tenant before executing, so RLS scopes naturally

# Show active connections and running queries
dx db activity                            # pg_stat_activity, formatted
dx db activity --target production        # production activity
dx db locks                               # show lock contention
dx db long-queries                        # queries running > 5s (configurable)
dx db long-queries --kill <pid>           # cancel a runaway query (requires authorization, audited)
```

### Migrations

```bash
# Migration lifecycle
dx db migrate status                      # show which migrations have run, which are pending
dx db migrate status --target staging     # check staging migration state
dx db migrate create <name>               # create new migration file (up + down)
dx db migrate up                          # run pending migrations (local dev)
dx db migrate up --target staging         # run on staging (requires authorization)
dx db migrate up --step 1                 # run only next pending migration
dx db migrate down                        # rollback last migration
dx db migrate down --step 3               # rollback last 3
dx db migrate down --to 20260315_001      # rollback to specific version
dx db migrate validate                    # check migration files for common errors
dx db migrate lint                        # static analysis (missing indexes on FKs, breaking changes, etc.)

# Dry-run / planning
dx db migrate plan                        # show SQL that would run, without executing
dx db migrate plan --target production    # show what production would get

# Migration squashing (for long-lived projects)
dx db migrate squash --before 20260101    # consolidate old migrations into a single baseline
```

Migration files live in the module's source tree:

```
services/api/
├── migrations/
│   ├── 20260315_001_create_orders.up.sql
│   ├── 20260315_001_create_orders.down.sql
│   ├── 20260322_002_add_rate_limiting.up.sql
│   ├── 20260322_002_add_rate_limiting.down.sql
│   └── ...
├── docker-compose.yml
└── ...
```

Migration linting catches:

- Adding a NOT NULL column without a DEFAULT (breaks existing rows)
- Dropping a column without a deprecation period
- Missing indexes on foreign key columns
- Acquiring ACCESS EXCLUSIVE locks on large tables (suggests concurrent alternatives)
- RLS policies missing on new tables (if module is tenant-aware)
- Enum type additions (safe) vs removals (unsafe)

### Seed Data

```bash
# Seed local dev database with test data
dx db seed                                # run default seed (from ./seeds/default.sql or ./seeds/default.py)
dx db seed --fixture large                # run a named fixture (./seeds/large.sql)
dx db seed --from staging --sanitize      # clone staging data with PII removal
dx db seed --from production --sanitize --sample 1000   # sample 1000 rows per table from prod, sanitized

# Reset local database to clean state
dx db reset                               # drop, recreate, migrate, seed
dx db reset --no-seed                     # drop, recreate, migrate only
```

Seed files support both SQL and Python (for programmatic data generation):

```
seeds/
├── default.sql                           # basic dev data
├── large.py                              # generate large dataset for perf testing
├── demo.sql                              # demo data for sales/marketing
└── sanitize.py                           # PII sanitization rules for --sanitize
```

The sanitization script defines rules per table:

```python
# seeds/sanitize.py
rules = {
    "users": {
        "email": "faker.email()",
        "name": "faker.name()",
        "phone": "faker.phone_number()",
        "password_hash": "REDACTED",
    },
    "orders": {
        "billing_address": "faker.address()",
    },
    # Tables to exclude entirely
    "_exclude": ["audit_events", "sessions"],
}
```

### Snapshots & Backups

```bash
# Snapshots (for local dev — fast, based on pg_dump or template DBs)
dx db snapshot create before-migration    # snapshot current local db
dx db snapshot list                       # list snapshots
dx db snapshot restore before-migration   # restore to snapshot
dx db snapshot delete before-migration

# Copy between targets
dx db copy --from staging --to local --sanitize     # pull staging data locally
dx db copy --from production --to staging --sanitize --sample 5000   # refresh staging from prod

# Production backups (ops — delegates to Data Plane backup system)
dx db backup list --target production     # list available backups
dx db backup create --target production --reason "Before major migration"
dx db backup restore --target production --backup 20260322_0300 --to staging
# Production restore always goes to a different target first (never in-place without --force)
```

### Analysis & Health

```bash
# Table statistics
dx db stats                               # overall db size, connection count, cache hit ratio
dx db stats orders                        # table-specific: row count, size, dead tuples, last vacuum/analyze
dx db bloat                               # table and index bloat estimates
dx db bloat --fix                         # run VACUUM FULL on bloated tables (requires maintenance window)

# Slow query analysis
dx db slow-log                            # show slow queries from pg_stat_statements
dx db slow-log --top 20                   # top 20 by total time
dx db slow-log --target production        # production slow queries

# Explain a query
dx db explain "SELECT * FROM orders WHERE tenant_id = $1 AND status = $2"
dx db explain -f ./queries/complex-report.sql --target staging
dx db explain --analyze ...               # actually execute (careful with production)

# Connection pool health
dx db pool status --target production     # connection pool utilization
```

### RLS & Tenant Debugging (Site Databases)

```bash
# Verify RLS is enabled on all tables
dx db rls check                           # list tables with/without RLS
dx db rls check --target staging          # check staging

# Test RLS policies
dx db rls test --tenant samsung --table orders    # query as tenant, verify isolation
dx db rls test --cross-tenant orders              # run cross-tenant leak detection

# Show what a specific tenant sees
dx db query "SELECT count(*) FROM orders" --tenant samsung --target staging
dx db query "SELECT count(*) FROM orders" --tenant acme --target staging
# Should show different counts if RLS is working
```

## 1.3 How `dx db` Resolves Its Target

`dx db` uses the same connection context system as `dx dev`:

1. No flag → connects to local dev database (from `docker-compose.yaml` dependencies block)
2. `--target staging` → resolves staging database via connection context (tunnel or direct)
3. `--target production --readonly` → production with read-only enforcement
4. `--target sandbox-pr-42` → sandbox database

The authorization model from the connection contexts doc applies: staging requires team membership, production requires explicit grant + audit.

---

# Part 2: Repo Types & Project Classification

## 2.1 The Problem

Not everything in the Factory is a product module. The company has:

- **Product modules** (geoanalytics, traffic-engine) — the things customers buy
- **Platform modules** (auth, control-plane, site-infra) — the shared infrastructure all products run on
- **Libraries** (service-plane-sdk, ui-component-library) — shared code, not independently deployed
- **Vendor integrations** (connector-salesforce, connector-sap) — third-party code or adapters contributed by partners
- **Client projects** (samsung-custom-dashboard, abudhabi-data-pipeline) — customer-specific work that isn't a product but ships as software
- **Infrastructure code** (terraform configs, ansible playbooks, helm charts) — ops tooling
- **Documentation** (docs site, API reference) — published content

These have different lifecycles, different CI pipelines, different ownership models, and different release paths. The Factory needs to handle all of them without requiring a separate workflow for each.

## 2.2 Repo Classification in `docker-compose.yaml`

Every repo gets a `docker-compose.yaml` with a `kind` field that tells the Factory what type of codebase this is:

```yaml
# Kind determines: CI pipeline, release path, versioning, who owns it, what conventions apply

kind: product-module       # Deployed to customer Sites via Fleet, entitled via Commerce
kind: platform-module      # Deployed to every Site as shared infrastructure
kind: library              # Published to package registry, consumed as dependency
kind: vendor-module        # Third-party contributed, deployed like product-module but with extra review
kind: client-project       # Customer-specific, deployed to their dedicated Site only
kind: infra                # Infrastructure-as-code, applied by Infrastructure Plane
kind: docs                 # Documentation, published to docs site
kind: tool                 # Internal CLI/tool, distributed to engineers
```

### Product Module (kind: product-module)

The standard case. A capability within a product (Trafficure, NetworkAccess, SmartMarket) that customers are entitled to.

```yaml
kind: product-module
module: geoanalytics
product: trafficure
team: analytics-eng

components:
  api: ...
  worker: ...
```

Release path: Build → module_version → release → rollout to Sites via Fleet.
Entitlements: Commerce Plane controls which customers get this module.
Conventions: Full pipeline — tests, lint, review, staging-before-production.

### Platform Module (kind: platform-module)

Shared infrastructure that runs in every Site. Auth, control plane, site infrastructure, the SDK runtime. Not entitled per customer — every Site gets it.

```yaml
kind: platform-module
module: control-plane
team: platform-eng

components:
  api: ...
  auth: ...
  audit: ...
```

Release path: Same as product module, but Fleet deploys to ALL Sites, not per-entitlement.
Conventions: Strictest pipeline — breaking changes require migration plan, backward compatibility required.
Special rules: Platform modules cannot depend on product modules. The dependency arrow is one-way.

### Library (kind: library)

Shared code that isn't deployed independently. Published to a package registry (npm, PyPI, Go modules, Maven). Consumed by other modules as a build-time dependency.

```yaml
kind: library
library: service-plane-sdk
team: platform-eng
publish:
  registry: npm
  package: "@lepton/service-plane-sdk"
```

No components block (nothing to deploy). No Fleet involvement. Build Plane publishes the package on merge. Module versions are package versions. Other modules declare it as a dependency in their `package.json` / `go.mod` / `pyproject.toml`.

The Service Plane SDK is the most critical library — it's the contract between Factory and Site. It gets its own CI matrix testing against all product modules.

### Vendor Module (kind: vendor-module)

Code contributed by a software vendor or partner. Structurally identical to a product module but with additional governance.

```yaml
kind: vendor-module
module: connector-sap
vendor: sap-consulting-india
team: integrations-eng # internal team responsible for review
product: trafficure

components:
  adapter: ...
  worker: ...
```

Release path: Same as product module, but with additional gates:

- Security scan is mandatory (not just convention — enforced)
- Internal team must approve every PR
- SBOM is required, vulnerability thresholds are stricter
- Vendor cannot merge directly — PRs from vendor forks go through internal review
- License compliance check runs on every build

The `vendor` field in docker-compose.yaml triggers these additional gates automatically. The vendor's engineers get contributor access (can push branches, open PRs) but not merge access.

### Client Project (kind: client-project)

Custom software for a specific customer. Not a product module — it's bespoke work that happens to be built in the Factory.

```yaml
kind: client-project
project: samsung-custom-dashboard
customer: samsung
team: solutions-eng
site: site-samsung-dedicated # deploys to this Site only

components:
  dashboard: ...
  etl-pipeline: ...
```

Key differences from product modules:

- Not registered as a `module` in Product Plane (not part of any product's module catalog)
- Not included in releases (deploys directly to the customer's Site)
- Not entitled via Commerce (it's part of the customer's contract, managed outside the module/entitlement system)
- The `site` field locks deployment to a specific Site — you can't accidentally deploy Samsung's custom code to another customer
- Ownership is the solutions team, not a product team
- The customer may have read access to the repo (configurable)

Deployment path: Build artifacts → deploy directly to `site-samsung-dedicated`, bypassing the release ceremony. Essentially the "direct deploy" path from the component model, but to a production-class Site.

```bash
dx deploy samsung-custom-dashboard --site site-samsung-dedicated
# This works because docker-compose.yaml declares site: site-samsung-dedicated
# dx refuses to deploy to any other site
```

### Infrastructure (kind: infra)

Terraform modules, Ansible playbooks, Helm value files, network configs. Not containers — applied by Infrastructure Plane.

```yaml
kind: infra
project: proxmox-cluster-configs
team: infra-eng
```

No components. No module_version. CI runs `terraform plan` on PR, `terraform apply` on merge (to staging), manual promotion to production. Version tracking through git tags, not the module_version system.

### Docs (kind: docs)

Documentation sites, API references, runbooks.

```yaml
kind: docs
project: developer-docs
team: platform-eng
publish:
  target: docs.lepton.io
```

CI builds the static site. Merges to main auto-deploy to docs.lepton.io. No Fleet, no releases, no components.

### Tool (kind: tool)

Internal CLIs, scripts, developer utilities. Published as binaries or packages for internal use.

```yaml
kind: tool
project: schema-validator
team: platform-eng
publish:
  registry: homebrew
  tap: lepton/internal
```

## 2.3 Repo Entity in Build Plane

```
repo
────
repo_id                 PK
name                    text
kind                    product-module | platform-module | library | vendor-module |
                        client-project | infra | docs | tool
module_id               FK → module (nullable — only for module kinds)
product_id              FK → product (nullable)
customer_id             FK → customer_account (nullable — only for client-project)
vendor_id               FK → partner (nullable — only for vendor-module)
team_id                 FK → team
site_constraint         FK → site (nullable — locks client-project to a specific Site)
git_url                 text
default_branch          text
visibility              internal | vendor-visible | customer-visible
ci_pipeline_id          FK → ci_pipeline
conventions_profile     text (which convention set applies)
created_at              timestamp
```

The `kind` field drives everything downstream — which CI pipeline runs, which conventions apply, which deployment path is used, what authorization is needed to merge.

## 2.4 How Conventions Adapt by Kind

```yaml
# .dx/conventions.yaml can be different per kind, or inherited with overrides

# Base conventions (all repos)
base:
  branches:
    pattern: "{type}/{ticket}-{slug}"
  commits:
    format: conventional

# Product module additions
product-module:
  deploy:
    production:
      require-passing-tests: true
      require-review: true
      require-staging-first: true

# Vendor module additions (stricter)
vendor-module:
  inherits: product-module
  security:
    require-sbom: true
    require-vulnerability-scan: true
    max-critical-vulns: 0
    max-high-vulns: 0
  review:
    require-internal-reviewer: true
    vendor-cannot-merge: true

# Client project (lighter)
client-project:
  deploy:
    require-passing-tests: true
    require-review: true
    # No staging-first requirement — client projects deploy directly
```

---

# Part 3: MCP Server — External Agent Interface

## 3.1 The Problem

Customers, partners, and their AI agents need to interact with the Factory programmatically. A customer's chatbot should be able to ask "what's the status of my Trafficure deployment?" A partner's automation should be able to check entitlement status. An external LLM agent should be able to trigger a deployment through natural language.

The dx API already exists for this. But MCP (Model Context Protocol) provides a standardized way for AI agents to discover and use tools. Shipping an MCP server means any MCP-compatible agent (Claude, GPT, custom agents, customer-built chatbots) can interact with the Factory without writing custom integration code.

## 3.2 Architecture

The MCP server is a thin layer over the dx API. It doesn't have its own business logic — it translates MCP tool calls into dx API calls, respecting the same authorization model.

```
External Agent (customer's Claude, partner's chatbot, etc.)
        │
        │ MCP protocol (SSE transport)
        ▼
┌───────────────────────────┐
│  dx MCP Server            │
│  factory-mcp-gateway      │
│                           │
│  Exposes dx API as        │
│  MCP tools with           │
│  schemas + descriptions   │
│                           │
│  Auth: API key or OAuth   │
│  Scoping: per-principal   │
└──────────┬────────────────┘
           │ HTTPS
           ▼
┌───────────────────────────┐
│  dx API Server            │
│  (same API as CLI uses)   │
└───────────────────────────┘
```

## 3.3 Tool Surface

The MCP server exposes a curated subset of the dx API as tools. Not everything — just what's useful and safe for external agents. Grouped by persona.

### Customer-facing tools (for customer agents/chatbots)

```
dx_site_status          → GET /fleet/sites/{name}
dx_site_health          → GET /fleet/sites/{name}/health
dx_module_status        → GET /fleet/sites/{name}/modules
dx_usage_summary        → GET /commerce/usage?customer={id}
dx_entitlement_check    → GET /commerce/entitlements?customer={id}&module={name}
dx_support_ticket       → POST /product/work-items (creates support ticket)
dx_audit_log            → GET /fleet/sites/{name}/audit (customer-scoped)
```

A customer's chatbot says "Is our Trafficure deployment healthy?" → the agent calls `dx_site_status` → gets the Site health → responds in natural language.

### Partner-facing tools (for partner/MSP agents)

Everything customer-facing, plus:

```
dx_customer_list        → GET /commerce/customers?partner={id}
dx_customer_usage       → GET /commerce/usage?partner={id}
dx_entitlement_request  → POST /commerce/entitlements/requests (request entitlement change)
dx_tenant_provision     → POST /fleet/sites/{name}/tenants (provision customer tenant)
```

### Internal tools (for company agents accessing remotely)

Full dx API surface, scoped by principal's permissions. This is what `dx ask` uses internally, now exposed as MCP for external consumption by company-built agents.

## 3.4 Authentication & Scoping

MCP connections authenticate via:

1. **API key** — stored in Commerce Plane, scoped to a customer/partner account. The key determines what the agent can see and do.

2. **OAuth flow** — for interactive agents (chatbots with user login). The agent gets a token scoped to the authenticated user's permissions.

Every MCP tool call passes through the same SpiceDB authorization that the dx API uses. A customer's agent can only see their own Sites, their own usage, their own entitlements. A partner's agent can see their customers but not other partners'. The MCP server adds no new authorization paths — it's a transport layer.

## 3.5 MCP Server Configuration

```yaml
# Factory config: which MCP tools are exposed to which audiences
mcp:
  server:
    url: https://mcp.lepton.io/sse
    transport: sse

  audiences:
    customer:
      tools:
        [
          dx_site_status,
          dx_site_health,
          dx_module_status,
          dx_usage_summary,
          dx_entitlement_check,
          dx_support_ticket,
          dx_audit_log,
        ]
      rate-limit: 100/hour
      auth: api-key

    partner:
      tools:
        [
          customer tools + dx_customer_list,
          dx_customer_usage,
          dx_entitlement_request,
          dx_tenant_provision,
        ]
      rate-limit: 500/hour
      auth: api-key

    internal:
      tools: [full dx API surface]
      rate-limit: 1000/hour
      auth: oauth
```

## 3.6 Schema Definition

Each MCP tool has a JSON Schema for input/output and a natural language description optimized for LLM tool selection:

```json
{
  "name": "dx_site_status",
  "description": "Get the current status of a customer's deployment (Site). Returns health, current release version, active modules, tenant count, and recent incidents. Use this when asked about deployment status, health, or availability.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site_name": {
        "type": "string",
        "description": "The Site name (e.g., 'trafficure-prod-india')"
      }
    },
    "required": ["site_name"]
  }
}
```

## 3.7 Agent Plane Integration

External agents calling the MCP server are tracked in Agent Plane just like internal agents:

```
agent_type: external-mcp
principal: customer-samsung-chatbot (from API key)
execution: logged per tool call
cost: not tracked (no LLM cost to us), but rate-limited
```

Every MCP tool call produces an `agent_execution_step` in Agent Plane. The customer's chatbot asking "Is my site healthy?" shows up in the audit trail as an API call from `customer-samsung-chatbot`.

---

# Part 4: CLI Standards

## 4.1 The Problem

CLI quality compounds. A developer uses `dx` 50+ times a day. Every unclear error message, every missing suggestion, every unnecessary prompt costs seconds that compound into hours. The CLI should feel like a knowledgeable colleague — it explains what went wrong, suggests what to do next, and never leaves you staring at a stack trace.

## 4.2 Exit Codes

Consistent, machine-parseable exit codes so agents and scripts can react:

```
0    Success
1    General failure (command failed for a known reason)
2    Usage error (bad flags, missing arguments, invalid command)
3    Authorization failure (no permission for this action)
4    Connection failure (can't reach API, cluster, or database)
5    Timeout (--wait exceeded --timeout)
6    Convention violation (blocked by convention, use --force to override)
7    Conflict (concurrent operation, resource already exists, etc.)
8    Not found (target, module, site, etc. doesn't exist)
10   Partial failure (some operations succeeded, some failed — details in output)
```

Agents check exit codes. Humans read the output. Both get what they need.

## 4.3 Output Modes

Every command supports three output modes, selected globally:

```bash
dx deploy api                    # human-readable (default in TTY)
dx deploy api --json             # structured JSON (default in non-TTY / CI)
dx deploy api --yaml             # YAML output
```

Human mode uses colors, spinners, progress bars, and prose. JSON mode is a structured object with consistent fields. The mode is auto-detected: if stdout is a TTY, human mode. If piped or in CI, JSON mode. `--json` overrides.

### JSON output structure (every command)

```json
{
  "success": true,
  "data": { ... },
  "warnings": ["Migration 003 is pending on staging"],
  "timing": {
    "started_at": "2026-03-24T10:30:00Z",
    "duration_ms": 3420
  }
}
```

On error:

```json
{
  "success": false,
  "error": {
    "code": "CONVENTION_VIOLATION",
    "message": "Tests must pass before deploying to production",
    "details": {
      "convention": "deploy.production.require-passing-tests",
      "last_test_run": "run_abc123",
      "failed_count": 3
    },
    "suggestions": [
      {
        "action": "dx test --all",
        "description": "Run tests and fix failures"
      },
      {
        "action": "dx deploy --force --reason \"...\"",
        "description": "Override convention (audited)"
      }
    ]
  },
  "exit_code": 6
}
```

## 4.4 Error Anatomy

Every error message follows a four-part structure. No exceptions.

### 1. What happened (the error)

One sentence. Clear, specific, no jargon.

```
✗ Cannot deploy to production: 3 tests are failing.
```

Not "Error: deployment failed" or "exit status 1" or a Go stack trace.

### 2. Why it happened (the cause)

Context that helps the developer understand. Shows relevant state.

```
  Convention: deploy.production.require-passing-tests
  Last test run: run_abc123 (12 minutes ago)
  Failed tests:
    • test_rate_limiting_under_load (api)
    • test_worker_retry_on_timeout (worker)
    • test_scheduler_idempotency (scheduler)
```

### 3. What to do about it (the fix)

Concrete, copy-pasteable commands. Multiple options when appropriate.

```
  Fix:
    dx test --all                              Run tests and fix failures
    dx logs --test-run run_abc123              See test failure details

  Override:
    dx deploy --force --reason "..."           Skip convention (will be audited)
```

### 4. Where to learn more (the context)

When the error involves a concept the developer might not know:

```
  Learn more:
    dx explain conventions                     How conventions work
    dx explain deploy                          How deployment works
```

### Complete example

```
$ dx deploy api --tier production

  ✗ Cannot deploy to production: 3 tests are failing.

  Convention: deploy.production.require-passing-tests
  Last test run: run_abc123 (12 minutes ago)
  Failed:
    test_rate_limiting_under_load          api/tests/test_rate_limit.py:42
    test_worker_retry_on_timeout           worker/tests/test_retry.py:18
    test_scheduler_idempotency             scheduler/tests/test_schedule.py:7

  Fix:
    dx test --all                          Run all tests
    dx test api                            Run just API tests
    dx logs --test-run run_abc123          Full test output

  Override:
    dx deploy --force --reason "..."       Skip this check (audited)

  Learn more:
    dx explain conventions
```

## 4.5 Specific Error Patterns

### Connection failures

```
$ dx deploy api

  ✗ Cannot reach dx platform at https://dx.platform.lepton.io

  Checked:
    DNS resolution           ✓
    TCP connection (443)     ✗ connection refused

  Possible causes:
    • The platform may be down or restarting
    • Your VPN may not be connected
    • The platform URL may have changed

  Try:
    dx status --local                    Check local-only status
    dx context show                      Verify platform URL
    ping dx.platform.lepton.io           Check network connectivity

  Note: Local development (dx dev) works without platform connectivity.
```

### Not found

```
$ dx deploy api --site trafficure-prod-brazil

  ✗ Site 'trafficure-prod-brazil' not found.

  Did you mean:
    trafficure-prod-india              (production, healthy)
    trafficure-prod-us-east            (production, healthy)
    trafficure-staging                 (staging, healthy)

  Available sites:
    dx site list                       Show all sites
    dx site list --product trafficure  Show Trafficure sites
```

### Authorization

```
$ dx db connect --target production

  ✗ Not authorized to connect to production database.

  Your role: deployer (team: analytics-eng)
  Required:  connect-production grant

  This is a production resource. Read-only access requires an explicit
  grant from a platform admin.

  Request access:
    dx access request connect-production \
      --target trafficure-prod-india \
      --reason "Investigating SUPPORT-892" \
      --duration 2h

  Or ask your admin:
    dx admin access grant <your-email> connect-production \
      --target trafficure-prod-india \
      --duration 2h
```

### Convention violations (helpful, not hostile)

```
$ dx branch create ratelimit-fix

  ✗ Branch name 'ratelimit-fix' doesn't match convention.

  Expected pattern: {type}/{ticket}-{slug}
  Valid types: feature, hotfix, release, chore, experiment

  Examples:
    dx branch create feature/BILL-245-ratelimit-fix
    dx branch create hotfix/BILL-245-ratelimit-fix

  Override:
    dx branch create ratelimit-fix --force --reason "..."

  Learn more:
    dx explain conventions
```

### Partial failures

```
$ dx release promote v2.4.1 --to production

  ⚠ Partial success: 3 of 5 sites updated, 2 failed.

  Succeeded:
    trafficure-prod-india       v2.4.1  ✓  healthy
    trafficure-prod-us-east     v2.4.1  ✓  healthy
    trafficure-prod-eu          v2.4.1  ✓  healthy

  Failed:
    trafficure-prod-singapore   ✗  timeout waiting for healthy (api: 0/2 ready)
    trafficure-prod-japan       ✗  image pull failed: registry timeout

  Next steps:
    dx release status v2.4.1                     Full rollout status
    dx logs geoanalytics api --site trafficure-prod-singapore   Check failing pods
    dx release retry v2.4.1 --site trafficure-prod-singapore    Retry failed sites
    dx release rollback v2.4.1 --site trafficure-prod-singapore Rollback this site

  The 3 successful sites are running v2.4.1.
  Failed sites are still on their previous release.
```

## 4.6 Progress & Long-Running Operations

### Spinners for short operations (< 5s expected)

```
$ dx build api
  ⠋ Building api...
  ✓ Built in 34s (registry/geoanalytics-api:abc123, 142MB)
```

### Phase progress for multi-step operations

```
$ dx deploy api --tier staging --wait

  Building
  ✓ Built in 34s (registry/geoanalytics-api:abc123)

  Deploying to trafficure-staging
  ✓ Migration 004_add_rate_limiting ran (0.8s)
  ↻ Rolling out api... (1/2 pods ready)
  ↻ Rolling out api... (2/2 pods ready)
  ✓ API healthy (avg response: 23ms)

  ↻ Rolling out worker... (1/2 pods ready)
  ✓ Worker healthy

  ✓ Deployed to trafficure-staging
    URL: https://staging--api.geoanalytics.lepton.io
    Rollout: rollout_def456
    Duration: 2m14s
```

### Progress for batch operations

```
$ dx release promote v2.4.1 --to production

  Promoting v2.4.1 to 5 production sites

  trafficure-prod-india      ████████████████████ 100%  ✓ healthy
  trafficure-prod-us-east    ████████████████░░░░  80%  ↻ 4/5 pods
  trafficure-prod-eu         ████████████░░░░░░░░  60%  ↻ 3/5 pods
  trafficure-prod-singapore  ████░░░░░░░░░░░░░░░░  20%  ↻ migrating
  trafficure-prod-japan      ░░░░░░░░░░░░░░░░░░░░   0%  ⏳ queued

  Elapsed: 3m42s  |  ETA: ~4m
```

## 4.7 Confirmation & Dangerous Operations

Operations are classified by risk level:

**No confirmation needed:** Read-only operations, local dev operations, sandbox operations.

**Soft confirmation (y/N):** Deploying to staging, destroying a sandbox, running migrations on staging.

```
$ dx sandbox destroy feature-login

  This will destroy sandbox 'feature-login' and all its data.
  The sandbox has been active for 18h.

  Continue? [y/N]
```

**Hard confirmation (type target name):** Production deployments, production DB operations, site decommission.

```
$ dx db migrate up --target production

  ⚠ This will run 2 pending migrations on PRODUCTION database.

  Target: trafficure-prod-india (1.2TB, 340 tenants)
  Migrations:
    004_add_rate_limiting.up.sql     (adds column, backfills — estimated 45s)
    005_create_audit_indexes.up.sql  (CREATE INDEX CONCURRENTLY — estimated 2m)

  Type the site name to confirm: trafficure-prod-india
  >
```

**Require --force with --reason:** Convention overrides, production overrides.

```bash
# This never prompts — it requires the flag or it refuses
dx deploy --tier production --force --reason "Hotfix for rate limiter crash"
```

## 4.8 Interruption & Early Exit

Ctrl+C is always clean. dx registers signal handlers and performs graceful shutdown:

```
$ dx deploy api --tier staging --wait
  ✓ Built in 34s
  ↻ Rolling out api... (1/2 pods ready)
  ^C

  Interrupted. Deployment is still in progress on the server.

  The rollout will continue. Check status:
    dx status geoanalytics api --site trafficure-staging
    dx release status latest

  To cancel the rollout:
    dx rollback geoanalytics --site trafficure-staging
```

The key: Ctrl+C stops the CLI process but doesn't cancel server-side operations (which would be dangerous). The CLI tells the developer what's still happening and how to manage it.

For operations that CAN be safely cancelled (local builds, tunnel setup):

```
$ dx dev api --connect-to staging
  ✓ Tunnel: postgres → localhost:15432
  ↻ Tunnel: redis → establishing...
  ^C

  Stopped. All tunnels closed. Local containers stopped.
```

## 4.9 Auto-Suggestions & Typo Correction

```
$ dx dpeloy api
  Unknown command 'dpeloy'. Did you mean 'deploy'?

  dx deploy api

$ dx deploy --enviroment staging
  Unknown flag '--enviroment'. Did you mean '--environment'?

$ dx status
  No target specified. Showing current module status.

  geoanalytics (from docker-compose.yaml)
  ...

  Tip: dx status <target> for specific targets (module, site, vm, ip)
```

## 4.10 The `--verbose` and `--debug` Spectrum

```
Normal:     What happened (results, errors, suggestions)
--verbose:  What happened + why (decisions, resolution steps, config sources)
--debug:    Everything above + HTTP requests, SQL queries, K8s API calls, tunnel setup
```

```bash
$ dx deploy api --verbose

  Context: module=geoanalytics, team=analytics-eng, branch=feature/BILL-245
  Target: staging (resolved from --tier staging → deployment_target: trafficure-staging)
  Convention check: 4 rules checked, all passed
  Build: using Dockerfile at ./services/api/Dockerfile
  ...

$ dx deploy api --debug

  [10:30:00.001] context: detected docker-compose.yaml at /home/nikhil/geoanalytics/docker-compose.yaml
  [10:30:00.003] context: module=geoanalytics kind=product-module
  [10:30:00.005] auth: loading token from ~/.config/dx/config.yaml
  [10:30:00.008] api: POST https://dx.platform.lepton.io/build/builds
  [10:30:00.142] api: 201 Created {"build_id": "build_abc123"}
  ...
```

## 4.11 Offline & Degraded Mode Messaging

When the platform or dependencies are unavailable, dx is honest and helpful:

```
$ dx deploy api

  ⚠ Cannot reach dx platform. Working in offline mode.

  Available offline:
    dx dev         ✓  Local development (no platform needed)
    dx test        ✓  Run tests locally
    dx build       ✓  Build images locally (cannot push)
    dx status      ⚠  Local status only (remote status unavailable)
    dx work list   ⚠  Showing cached work items (may be stale)

  Unavailable offline:
    dx deploy      ✗  Requires platform connection
    dx release     ✗  Requires platform connection
    dx site        ✗  Requires platform connection

  Check connectivity:
    dx context show
    ping dx.platform.lepton.io
```

## 4.12 Implementation Notes

### Built-in error registry

Every error has a code (like `CONVENTION_VIOLATION`, `AUTH_REQUIRED`, `TARGET_NOT_FOUND`). The error registry maps codes to suggestion templates. When the CLI catches an error, it looks up the code and generates contextual suggestions based on the current state.

```go
// Simplified
type CLIError struct {
    Code        ErrorCode
    Message     string
    Details     map[string]any
    Suggestions []Suggestion
    ExitCode    int
}

type Suggestion struct {
    Command     string   // copy-pasteable command
    Description string   // what it does
}
```

### Levenshtein distance for typo correction

Commands, flags, target names, and module names all use fuzzy matching with a distance threshold of 2. If one match is found, suggest it. If multiple, show all.

### Width-aware formatting

Output wraps to terminal width. Tables truncate long fields with `...` and show full content with `--wide` or `--json`. Progress bars scale to available width.

### No color in non-TTY

Colors, spinners, and progress bars are automatically disabled when output is piped or redirected. `--no-color` forces it off in TTY. `--color` forces it on (for `less -R` piping).
