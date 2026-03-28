# Factory Backlog

Tracking deferred work and ideas across the factory platform.
See `plans/hazy-mapping-lollipop.md` for the build plane architecture design.

## Legend

- `[x]` — Done
- `[ ]` — Not started
- `[~]` — Partially done / needs follow-up

---

## Phase 1: Core Infrastructure

### 1A: `dx ci run` — Local Workflow Execution
- [x] `dx ci run` command (delegates to `act`)
- [x] Auto-install `act` if missing (macOS/Linux/Windows)
- [x] `--workflow`, `--job`, `--secret`, `--env-file`, `--platform`, `--event` flags
- [x] Environment detection (local / GitHub Actions / sandbox)
- [ ] Secret injection from `dx secret` store (`~/.dx/secrets/`)
- [ ] Interactive prompt for missing required secrets
- [ ] `dx ci run --list` — list available workflows/jobs without running

### 1B: Preview Wiring
- [x] Preview REST controller (`POST/GET/PATCH/DELETE /previews`)
- [x] Preview model (Elysia validation schemas)
- [x] `dx preview deploy/list/show/destroy/open` CLI commands
- [x] Webhook dispatch: PR opened → create preview, synchronize → update SHA, closed → expire
- [ ] `dx preview deploy --wait` polling (endpoint works, CLI polling not wired)
- [ ] Post preview URL as PR comment via git host adapter
- [ ] Link preview to sandbox (create sandbox on preview deploy, destroy on expire)

---

## Phase 2: Pipeline Tracking

- [x] `pipeline_run` table (trigger event/ref, SHA, status lifecycle, sandbox ref)
- [x] `pipeline_step_run` table (job/step tracking, exit codes, log URLs)
- [x] Pipeline run service (CRUD, cancel, list with filters)
- [x] Pipeline run controller (`/build/runs` endpoints)
- [x] Webhook dispatch creates pipeline_run on push and PR events
- [ ] Report pipeline status to GitHub via Checks API (git-host-adapter)
- [x] `dx ci status` — show recent pipeline runs from API (table output with status, event, ref, SHA, duration)
- [ ] Pipeline log storage / streaming
- [ ] Sandbox provisioning: webhook → create sandbox → `dx ci run` inside sandbox
- [ ] Pipeline run → sandbox lifecycle (destroy sandbox on completion)

---

## Phase 3: `dx review` — Agentic Code Review

- [ ] `dx review` CLI command
- [ ] Get PR diff + changed files via GitHub API (git-host-adapter)
- [ ] Load repo conventions from `.dx/conventions.yaml` or `shared/src/conventions.ts`
- [ ] Call Claude API with diff + conventions context
- [ ] Post inline review comments on PR via GitHub Reviews API
- [ ] Configurable review rules per-repo (`.dx/scripts/review.ts` override)
- [ ] Focus areas flag: `--focus security,performance`
- [ ] Ignore patterns: `--ignore '*.test.ts'`

---

## Phase 4: `dx release` — Release Automation

- [ ] `dx release notes` — generate release notes from conventional commits since last tag
- [ ] `dx release create` — tag + notes + GitHub release
- [ ] `dx release create --auto` — auto-detect version bump from commit types
- [ ] Changelog generation (CHANGELOG.md update)
- [ ] Pre-release support (`--pre-release`, `--rc`)

---

## Phase 5: `dx script` + `@dx/ci` Runtime

### `dx script` (basic runner)
- [x] `dx script <file>` command — run .ts/.js via embedded Bun
- [x] Script resolution: cwd, `.dx/scripts/`, bare name lookup
- [x] `--watch` mode
- [x] `--` passthrough for script arguments
- [x] `DX_BIN` env var for scripts to call back into dx

### `@dx/ci` Runtime Context (not yet started)
- [ ] `@dx/ci` package with typed helpers
- [ ] `context` — current run context (event, branch, PR, commit, env) from `GITHUB_*` env vars
- [ ] `github` — GitHub API wrapper (wraps git-host-adapter)
- [ ] `artifact` — artifact upload/download helper
- [ ] `sandbox` — sandbox management API client
- [ ] Built-in scripts: `@dx/review`, `@dx/release-notes` (runnable via `dx script @dx/review`)

---

## Phase 6: `dx init` Workflow Scaffolding

- [ ] Generate `.github/workflows/ci.yml` (build + test) during `dx init`
- [ ] Generate `.github/workflows/review.yml` (agentic code review on PRs)
- [ ] Generate `.github/workflows/preview.yml` (preview deployments on PRs)
- [ ] Generate `.github/workflows/release.yml` (release automation on main)
- [ ] Templates use `dx` commands as workflow steps with explanatory comments

---

## Drift Items (identified 2026-03-28)

### Slack Conversational Agent
Plan: `slack-conversational-agent-vercel-chat-sdk-ai-gate.md`
- [ ] Vercel Chat SDK integration (current implementation is basic webhook-based)
- [ ] AI Gateway for model routing
- [ ] `agent_persona` table for configurable agent behaviors
- [ ] Rich conversational threading (beyond current `messageThread` persistence)

### Local-First CLI
Plan: `local-first-cli-k3d-clusters-sandboxes-without-fac.md` — **COMPLETE** (all 11 phases)
- [x] PGlite-based local factory daemon (`cli/src/local-daemon/`)
- [x] `factoryUrl: localhost` auto-detection + `ensureLocalDaemon()` in `client.ts`
- [x] `'local'` DB provider type (`api/drizzle/0003_drop_provider_constraints.sql`, `factory-core.ts` seeding)
- [x] k3d cluster management (`cli/src/commands/cluster.ts`, `cli/src/handlers/cluster/`)
- [x] /etc/hosts management (`cli/src/lib/hosts-manager.ts`)
- [x] api-server/ package split
- [x] Workbench install three-option prompt (`cli/src/handlers/install/workbench.ts` lines 161-202)
- [x] Auto-wire hosts entries on sandbox create/delete (`addHostEntry`/`removeHostEntry` in sandbox.ts)
- [x] `dx cluster status [name]` subcommand (node count, health, kubeconfig path)
- [x] Fix `(config as any).installMode` cast — added `installMode` to `WorkbenchConfig` type
- [ ] Multi-registry support: configurable artifact registries beyond GCP (e.g. GitHub Packages, GitLab, custom registries per org)

---

## Ideas / Future

- [ ] Pipeline cache management (`pipeline_cache_entry` table, `dx ci cache` commands)
- [ ] Parallel job execution tracking with DAG visualization
- [ ] Build artifacts → artifact registry integration
- [ ] Preview auto-sleep (hot→warm→cold tier transitions already in preview service cleanup loop)
- [ ] Preview auth modes (public, team-only, password-protected — `authMode` column exists)
- [ ] Webhook retry/replay for failed deliveries
- [ ] `dx ci replay <run-id>` — re-run a pipeline from a specific run
- [ ] Metrics/observability: pipeline duration trends, failure rates, flaky step detection
- [ ] Slack/messaging notifications for pipeline status changes (messaging adapter exists)
- [ ] Branch protection rules enforcement via API

---

## Unimplemented Adapters & Integrations

### Work Tracker Adapters
- [ ] JIRA adapter — all 6 methods stubbed (`work-tracker-adapter-jira.ts`)
- [ ] Linear adapter — all 6 methods stubbed (`work-tracker-adapter-linear.ts`)

### Observability Adapters
- [ ] ClickStack adapter — all 17 methods stubbed (`observability-adapter-clickstack.ts`)
- [ ] SigNoz adapter — all 17 methods stubbed (`observability-adapter-signoz.ts`)

### Tunnel Backends
- [ ] Gateway tunnel backend (`cli/src/lib/backends/gateway-backend.ts`) — requires gateway infrastructure
- [ ] SSH tunnel backend (`cli/src/lib/backends/ssh-backend.ts`)
- [ ] kubectl tunnel backend (`cli/src/lib/backends/kubectl-backend.ts`)

---

## Unimplemented Reconciler Strategies

- [ ] Docker Compose strategy — SSH, compose generation, drift detection (`reconciler/strategies/compose.ts`)
- [ ] systemd strategy — SSH, unit file generation, status checks (`reconciler/strategies/systemd.ts`)
- [ ] Windows Service strategy — WinRM, PowerShell deployment (`reconciler/strategies/windows.ts`)
- [ ] Windows IIS strategy — WinRM, IIS site management (`reconciler/strategies/windows.ts`)

---

## Stub CLI Commands

These commands are registered but return "Not yet implemented":

- [ ] `dx auth config`
- [ ] `dx ops restart`, `dx ops scale`
- [ ] `dx context list`, `dx context show`, `dx context select`
- [ ] `dx secret get`, `dx secret list`
- [ ] `dx agent list`, `dx agent run`, `dx agent show`
- [ ] `dx work create`, `dx work done`, `dx work list`, `dx work start`
- [ ] `dx tenant assign`, `dx tenant list`, `dx tenant show`
- [ ] `dx factory create`, `dx factory remove`
- [ ] `dx dev --remote` (remote dev mode)
- [ ] `dx db` remote target support (currently local dev db only)

---

## Phase 7: Sandbox Infrastructure — Snapshots, VMs, Cloning

### Snapshot Enhancements
- [x] Volume-level snapshots via Kubernetes VolumeSnapshot CRDs (workspace PVC + docker PVC)
- [x] CSI hostpath driver setup for k3d snapshot support
- [x] Snapshot create/restore/delete reconciler flows (fire-and-forget async)
- [x] CLI `dx sandbox snapshot create/list`, `dx sandbox restore` with `--wait` polling
- [ ] Image commit for capturing installed packages (complement to volume snapshots)
- [ ] Snapshot scheduling / auto-snapshot on idle (e.g. snapshot every N minutes or on sandbox sleep)
- [ ] Snapshot size tracking and quota enforcement
- [ ] Snapshot retention policies (max N snapshots per sandbox, auto-prune oldest)
- [ ] Cross-cluster snapshot migration (export VolumeSnapshot → object storage → import on target cluster)
- [ ] Incremental snapshots / snapshot chains for storage efficiency

### VM-Based Sandboxes
- [ ] Proxmox VM provisioning via sandbox reconciler (`runtimeType: 'vm'`)
- [ ] VM sandbox lifecycle: create, start, stop, suspend, resume, destroy
- [ ] VM snapshots via Proxmox snapshot API (full machine state including memory)
- [ ] VM restore from snapshot (instant rollback to prior machine state)
- [ ] VM image templates (pre-built images with common toolchains)
- [ ] Cloud-init integration for VM bootstrap (SSH keys, user data, network config)
- [ ] VM migration between Proxmox nodes (live migration for load balancing)
- [ ] Hybrid routing: gateway proxy support for VM-based sandboxes (not just k8s pods)

### Sandbox Cloning
- [ ] `dx sandbox clone <source> --name <new>` — create new sandbox from existing sandbox's current state
- [ ] Clone via snapshot: snapshot source → restore into new sandbox (volume-level)
- [ ] Clone via VM fork: Proxmox linked clone for instant VM copies
- [ ] Clone with overrides (different env vars, different branch, different resource limits)
- [ ] Bulk clone for load testing / parallel CI (clone N sandboxes from a template snapshot)

### Sandbox Templates & Presets
- [ ] `sandbox_template` table already has `runtimeType` column — wire up VM template support
- [ ] Template snapshots: create a "golden" snapshot that new sandboxes bootstrap from
- [ ] Template marketplace: share templates across orgs (read-only catalog entries)

---

## Proxmox Adapter TODOs

- [ ] VM creation from template — cloud-init integration via `getVmContext`
- [ ] VM migration — actual migrate call in Proxmox client
- [ ] VM snapshots — Proxmox client snapshot API integration

---

## Messaging & Notifications

- [ ] Messaging webhook → agent dispatch for processing based on `entityContext`
- [ ] Auth service image placeholder in templates (`cli/src/templates/resource/auth.ts`, `cli/sub-project/compose/auth.yml`)

---

## UI

- [ ] Scout prompt input — file actions not implemented (`ui/src/modules/smart-market.scouts/.../scout-prompt-input.tsx`)
