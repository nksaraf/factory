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

## Build Plane — Quality Gates (`dx check`)

Design spec: `plans/immutable-prancing-crown.md`

### Completed (2026-03-29)
- [x] Conventions schema `quality` section (shared/src/conventions-schema.ts) with floor enforcement
- [x] Quality library: strategy pattern for Node (oxlint/tsc/vitest/prettier), Python (ruff/mypy/pytest), Java (checkstyle/mvn/spotless)
- [x] `dx check` command with lint/typecheck/test/format subcommands, --component/--staged/--ci/--fix/--report flags
- [x] Reporter: summary table, JSON output, CI exit code logic
- [x] All 8 templates updated with quality tooling baked in (node-api, node-lib, web-app, ui-lib, python-api, python-lib, java-api, java-lib)
- [x] Shared quality-configs.ts module (no duplication across templates)
- [x] Project template: root scripts, simple-git-hooks, lint-staged, oxlint, editorconfig, vscode config, conventions.yaml
- [x] Factory monorepo self-adoption: oxlint.config.json, .editorconfig, .vscode/, ci-quality.yml, .dx/conventions.yaml, root scripts

### Deferred
- [ ] SonarQube integration — hooks designed (`dx check --report sonar`), needs SonarQube instance + token config
- [ ] Coverage enforcement — schema supports `min-line`/`min-branch` but not wired to actual coverage collection yet
- [ ] `dx check --ci` in CI workflow — currently CI uses raw `pnpm lint`/`pnpm typecheck`; switch to `dx check --ci` once dx binary is available in CI
- [ ] Editor layer: `.vscode/tasks.json` auto-generation for `dx check` commands
- [ ] `dx check` watch mode — re-run checks on file save for rapid feedback loop

---

## Drift Items (identified 2026-03-28)

### Slack Conversational Agent (Chat SDK Layer)
Spec: `docs/superpowers/specs/2026-03-28-chat-sdk-agent-layer-design.md`
- [ ] Scaffold `agent-chat/` Next.js app in monorepo (Chat SDK + Vercel Workflow + AI SDK)
- [ ] Chat SDK Slack adapter setup + webhook route
- [ ] Custom state adapter: Chat SDK state → `factory_org.message_thread` + Redis locks
- [ ] Factory API client (typed HTTP client for bot → Factory API communication)
- [ ] Durable conversation workflow (Vercel Workflow: start on @mention, resume on messages/actions)
- [ ] Agent tools: bash (dx CLI), read/write/edit files, grep, glob, ask_user, web_fetch
- [ ] `ask_user` tool: post question to Slack thread, render options as buttons, pause workflow for response
- [ ] Context builder: assemble system prompt from org/team memories + channel context + user identity
- [ ] Execution mode: lightweight (dx CLI in-process) vs sandbox (spin up sandbox for code changes)
- [ ] Sandbox integration: create sandbox → run coding agent → create PR → preview → merge flow
- [ ] Agent skill definition (system prompt + tool configs — separate deliverable)
- [ ] AI Gateway for model routing
- [ ] Web UI transport (same backend, useChat() React client instead of Slack)

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

## Phase 8: `dx docker` — Remote Docker Proxy & Machine Management

### Implemented (2026-03-29)
- [x] `dx docker <args> --on <slug>` — proxy any docker command to a remote machine via SSH-based DOCKER_HOST
- [x] `dx docker compose <args> --on <slug>` — remote compose with auto-sync detection (build contexts, volume mounts)
- [x] `dx docker connect <slug>` — spawn subshell with DOCKER_HOST pre-set
- [x] `dx docker env <slug>` — print `export DOCKER_HOST=...` for `eval $()`
- [x] `dx docker setup <slug>` — bootstrap Docker + Compose on fresh machine via SSH
- [x] Machine resolution from Factory infra tables (Host/VM/Sandbox) via `infra.access.resolve()`
- [x] `lib/docker.ts` extended with `dockerHost` option for all compose helpers

### Implemented (2026-03-30)
- [x] Machine resolution from `~/.ssh/config` entries (cascading: Factory API → SSH config → local machines.json)
- [x] Machine resolution from local `~/.config/dx/machines.json` for ad-hoc additions
- [x] `dx docker add <name> --host <ip>` / `dx docker remove <name>` — local machine registration
- [x] Compose auto-sync: rsync build context directories, volume mounts, configs/secrets file references
- [x] `dx docker setup` — Alpine/apk support alongside Debian/RHEL via `get.docker.com`
- [x] `dx ssh` now uses same cascading machine resolver as `dx docker` (Factory → SSH config → local machines.json)

### Deferred
- [ ] `dx ssh` remote command quoting: ensure `cloud ssh <target> -- <cmd>` and `dx ssh <target> -- <cmd>` properly escape/quote commands with special chars (spaces, quotes, parens, pipes) — current `cloud ssh` mangles multi-word args and SQL commands
- [ ] `dx ssh` arbitrary command execution: support `dx ssh <target> -- docker exec ... psql -c "SELECT 1"` with proper stdin piping (match how `ssh user@host 'cmd'` works natively)
- [ ] Tunnel-based DOCKER_HOST (`tcp://localhost:PORT` via SSH port forward) for environments where direct SSH to Docker socket is blocked
- [ ] Machine provisioning flow: `dx docker compose up --on new-vm` spins up a VM then deploys (persona B)
- [ ] `dx machine` as a unified DB-level view over Host+VM+Sandbox tables (decided against for v1, revisit if needed)
- [ ] `dx deploy` integration — `dx deploy` uses `dx docker` under the hood for compose-runtime deployment targets
- [ ] `dx docker logs --on <slug>` shortcut for streaming container logs from remote machines
- [ ] `dx docker list` — show all resolvable machines across all sources (Factory, SSH config, local machines.json)

---

## Phase 9: `dx run` — Ansible-like Remote Playbooks

Built-in playbook runner for installing tools and configuring machines on demand. `dx docker setup` is the first playbook; generalize to a plugin/playbook system.

- [ ] `dx run <playbook> --on <machine>` — run a named playbook on a remote machine via SSH
- [ ] Built-in playbooks: `docker`, `node`, `postgres`, `nginx`, `caddy`, `tailscale`, etc.
- [ ] Custom playbooks: `.dx/playbooks/<name>.sh` or `.dx/playbooks/<name>.ts` in project
- [ ] Playbook composition: `dx run docker,caddy,postgres --on staging-1` (install multiple tools in one pass)
- [ ] Idempotent execution: playbooks detect if tool is already installed/configured and skip
- [ ] `dx run` with inventory: `--on tag:webservers` to target multiple machines by tag/label
- [ ] Playbook output capture and status reporting (success/failure per machine)
- [ ] Community playbook registry: `dx run @community/ghost-cms --on prod-1` (pull playbook from registry)

---

## Ideas / Future

- [ ] Pipeline cache management (`pipeline_cache_entry` table, `dx ci cache` commands)
- [ ] Parallel job execution tracking with DAG visualization
- [ ] Build artifacts → artifact registry integration
- [ ] Preview auto-sleep (hot→warm→cold tier transitions already in preview service cleanup loop)
- [ ] Preview auth modes (public, team-only, password-protected — `authMode` column exists)
- [ ] Docker Compose runtime for previews — deploy preview containers via `docker compose up` on same network as factory API (no k8s needed, simplest path for single-VM deployments)
- [ ] Migrate full Factory stack into k3s (postgres, spicedb, auth, factory API as k8s Deployments) for multi-node/multi-cluster production
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
- [ ] `dx auth login` should not print session file path (security concern — just say "Signed in as ...")
- [ ] `dx ops restart`, `dx ops scale`
- [ ] `dx context list`, `dx context show`, `dx context select`
- [ ] `dx secret` — centralized secret management (see Phase 10 below)
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
resolveVm() does a full table scan — fine for typical VM counts (<1000), could add provider scope later if needed
createVm() picks templates[0] as fallback when no templateId specified — non-deterministic but acceptable for single-template setups
Service layer passes internal vmId to adapter which re-resolves it — works correctly because resolveVm matches on vmId, but the parameter name externalId is misleading. This is a naming concern, not a bug.

### Sandbox Cloning
- [ ] `dx sandbox clone <source> --name <new>` — create new sandbox from existing sandbox's current state
- [ ] Clone via snapshot: snapshot source → restore into new sandbox (volume-level)
- [ ] Clone via VM fork: Proxmox linked clone for instant VM copies
- [ ] Clone with overrides (different env vars, different branch, different resource limits)
- [ ] Bulk clone for load testing / parallel CI (clone N sandboxes from a template snapshot)

### Web IDE & Web Terminal
- [~] Base image with ttyd + openvscode-server (`images/dx-sandbox/Dockerfile` + `entrypoint.sh`) — built, needs CI push
- [~] Pod spec: 3 ports (22, 8080, 8081), dual IngressRoute, entrypoint fallback — code done, needs k8s deploy
- [~] Schema `webIdeUrl` column + reconciler IDE route creation — code done, needs k8s deploy
- [~] CLI: shows Terminal + IDE URLs, `dx sandbox open` defaults to IDE — code done
- [ ] Process supervision in entrypoint: replace `wait` with s6-overlay for ttyd/openvscode auto-restart
- [ ] Image size optimization: `dx-sandbox:slim` variant without Java/Go (~1GB vs ~3-4GB)
- [ ] API key security: move `ANTHROPIC_API_KEY` from plain env var to Kubernetes Secret (`valueFrom.secretKeyRef`)
- [ ] Custom image UX: document how custom `devcontainerImage` users can add ttyd/openvscode to their own images
- [ ] CI workflow to build+push `ghcr.io/nksaraf/dx-sandbox:latest` on changes to `images/dx-sandbox/`
- [ ] WebSocket proxy verification: confirm ttyd and openvscode-server WS upgrades work through Traefik + tunnel relay

### Devcontainer & Envbuilder
- [x] Envbuilder integration: sandbox pods use envbuilder to auto-detect/build devcontainer.json
- [x] PVC mount fix: workspace PVC at `/workspace-pvc` with init script sync (envbuilder wipes `/workspaces` on rebuild)
- [x] `dx sandbox exec` command (kubectl exec via slug or ID, TTY detection, `--context` override)
- [x] Slug-based sandbox lookup in `getSandbox()` (resolves by sandboxId or slug)
- [ ] Prebuild pipeline (Track 2): external CI-driven image builds for instant spawn on cache hit
- [ ] Registry setup for envbuilder cache (k3d built-in registry or cluster-local registry)
- [ ] Multi-repo devcontainer support (primary repo has devcontainer, additional repos mounted alongside)
- [ ] Devcontainer features support validation (verify envbuilder handles features correctly)
- [ ] SSH server feature in devcontainer (sshd) for `ssh -p <nodeport>` access
- [ ] Custom Dockerfile builds via envbuilder (beyond just image references)
- [ ] `dx sandbox create --devcontainer-path` flag to specify non-standard devcontainer location
- [ ] Devcontainer lifecycle hooks (`postCreateCommand`, `postStartCommand`, `postAttachCommand`)
- [ ] Prebaked base images: maintain a set of optimized base images with common toolchains pre-installed
- [ ] Image layer caching metrics: track cache hit rates, build times, image sizes
- [ ] Replace background `cp` sync with inotifywait or bind mount for real-time PVC persistence
- [ ] Envbuilder cache warming: pre-pull common base images on cluster nodes for faster first build

### Sandbox Templates & Presets
- [ ] `sandbox_template` table already has `runtimeType` column — wire up VM template support
- [ ] Template snapshots: create a "golden" snapshot that new sandboxes bootstrap from
- [ ] Template marketplace: share templates across orgs (read-only catalog entries)

---

## Dev Environment / DX Improvements

- [x] Fix k3d TLS cert mismatch: `kubectl` fails with "x509: certificate signed by unknown authority" after cluster recreation — daemon now re-fetches kubeconfig from k3d on startup + `getK3dKubeconfig` verifies certs
- [x] PGlite WAL corruption from unclean daemon shutdowns: added graceful shutdown handler (`SIGTERM`/`SIGINT` → `client.close()` + PID cleanup)
- [x] Local daemon: `gatewayController.onStart` conflicts with explicit `startGateway` — guarded with `__DX_SKIP_GATEWAY_ONSTART` env flag + switched to `app.listen()` to fix PGlite db isolation
- [ ] Fix dx-cli-project-init seed overwriting shared DB on restart (seed should be idempotent / skip if data exists)
- [ ] Drizzle migration idempotency: all `CREATE SCHEMA` → `CREATE SCHEMA IF NOT EXISTS` across migrations
- [ ] `dx sandbox ssh` command (SSH into sandbox via NodePort, auto-detect port from API)
- [ ] `dx sandbox logs` command (stream envbuilder build logs, workspace logs)
- [ ] `dx sandbox open` command (open web terminal URL in browser)
- [ ] Sandbox status reconciliation: poll k8s pod status back into DB (currently fire-and-forget)
- [ ] Sandbox health checks: readiness probe integration for envbuilder completion detection

---

## Phase 10: `dx secret` — Centralized Secret Management

Inspired by Fly.io secrets, Doppler, Railway variables. Store secrets in Factory DB (encrypted at rest), scoped per site/environment. Eliminates plaintext `.env` files on VMs.

- [ ] `secret` DB table (secretId, siteId/envId, key, encrypted value, createdBy, createdAt, updatedAt)
- [ ] Encryption at rest (envelope encryption: per-secret DEK, master KEK from env var or KMS)
- [ ] `dx secret set KEY=value --site <site>` — store a secret scoped to a site/environment
- [ ] `dx secret get KEY --site <site>` — retrieve a single secret value
- [ ] `dx secret list --site <site>` — list keys with masked values and metadata
- [ ] `dx secret delete KEY --site <site>` — remove a secret
- [ ] `dx secret env --site <site>` — generate `.env` file contents to stdout (`KEY=value\n...`)
- [ ] `dx secret env --site <site> | docker compose --env-file /dev/stdin up -d` — pipe into docker compose
- [ ] Secret injection into `dx ci run` (replaces `--secret` flag with automatic lookup)
- [ ] Audit log: track who set/read/deleted each secret and when
- [ ] Secret rotation support: `dx secret rotate KEY --site <site>` (set new value, restart dependent services)

---

## Proxmox Adapter TODOs

- [ ] VM creation from template — cloud-init integration via `getVmContext`
- [ ] VM migration — actual migrate call in Proxmox client
- [ ] VM snapshots — Proxmox client snapshot API integration

---

## Agent Platform

### Agent Taxonomy (v1 — implemented, needs migration)
- [~] Generate Drizzle migration for agent schema changes (role_preset, job, memory tables, agent new columns)
- [ ] Migrate existing `agent_execution` rows → `job` table (script or SQL migration)

### Agent Model — Future Dimensions
- [ ] Migrate agent tables from `factory_agent` to `factory_org` schema (agents as org workers)
- [ ] Trust score auto-computation from job history (success rate, override rate, escalation accuracy)
- [ ] Autonomy auto-promotion: when trust exceeds thresholds, suggest level-up (with human confirmation)
- [ ] Agent lifecycle: onboarding → active → expert stages with automatic context learning

### Memory System — v2 (Search Layer)
- [ ] pgvector extension + `embedding` column type change (text → vector(1536))
- [ ] Semantic retrieval pipeline: embed memories, top-K by cosine similarity before each job
- [ ] Memory injection into agent context (structured sections: org → team → session)
- [ ] Auto-propose: extract learnings from completed jobs → propose as team memories
- [ ] Confidence decay (daily decay, reinforcement on access, archive when stale)
- [ ] Memory conflict resolution (session > team > org priority)
- [ ] Host memory layer (what agent knows about its owner — personal preferences, style)
- [ ] Agent memory layer (what agent learned about itself and its domain)
- [ ] Cross-org memory layer (anonymized patterns across orgs — platform knowledge moat)

### Multi-Agent Collaboration
- [ ] Supervisor agent: decompose tasks, delegate to specialist agents (uses job.parentJobId)
- [ ] Crew mode: multiple agents collaborating on a shared goal
- [ ] Event-triggered workflows: PR opened → auto-review, test failure → auto-diagnose, deploy failure → auto-investigate

---

## Messaging & Notifications

- [ ] Messaging webhook → agent dispatch for processing based on `entityContext`
- [ ] Auth service image placeholder in templates (`cli/src/templates/resource/auth.ts`, `cli/sub-project/compose/auth.yml`)

---

## UI

- [ ] Scout prompt input — file actions not implemented (`ui/src/modules/smart-market.scouts/.../scout-prompt-input.tsx`)
