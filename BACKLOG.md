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

> Full spec in "dx release" under "dx CLI — Design Handoff Core Commands" section. Design handoff §18.

- [ ] `dx release [major|minor|patch]` — auto-increment version, generate changelog, tag, `gh release create`, trigger deploy
- [ ] `dx release notes` — generate release notes from conventional commits since last tag (standalone)
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

- [x] Generate `.github/workflows/dx.yaml` (check on PR, deploy preview/prod on tags) during `dx init`
- [ ] Generate `.github/workflows/review.yml` (agentic code review on PRs)
- [ ] Split dx.yaml into separate workflows: `ci.yml`, `preview.yml`, `release.yml` for better modularity
- [ ] Templates use `dx` commands as workflow steps with explanatory comments

---

## DX CLI v2 — Convention-Over-Configuration Engine

### Completed (2026-04-04)

- [x] Toolchain detector (`cli/src/lib/toolchain-detector.ts`) — auto-detects runtime, package manager, test runner, linter, formatter, type checker, migration tool, codegen, framework, database across 6 runtimes
- [x] DX project config (`cli/src/lib/dx-project-config.ts`) — reads `package.json#dx` key with typed defaults
- [x] Git hooks (`cli/src/lib/hooks.ts`) — POSIX sh scripts in `.dx/hooks/` with `core.hooksPath`, install/verify/health
- [x] `dx git-hook` command — commit-msg, pre-commit, pre-push, post-merge, post-checkout handlers
- [x] New commands: `dx lint`, `dx format`, `dx typecheck`, `dx generate`, `dx sync`, `dx upgrade`, `dx self-update`
- [x] `dx test` variant flags: `--watch`, `--coverage`, `--changed`, `--integration`, `--e2e` via `resolveVariant()`
- [x] `dx check` wired to toolchain detector via `ToolchainStrategy`
- [x] `dx dev` pre-flight: hook health check + codegen
- [x] Script pass-through: `dx <name>` falls back to `package.json#scripts`
- [x] Deprecated git wrappers: `dx commit`, `dx push`, `dx branch`, `dx pr`, `dx ship`, `dx worktree` show migration messages
- [x] `dx init` scaffolds `.dx/hooks/`, `.github/workflows/dx.yaml`, `.gitattributes`, `.cursor/rules`, `package.json#dx`
- [x] Removed `catalog.yaml` from init (catalog derived from docker-compose labels)
- [x] Persistent fixture-based test suites (64 tests across toolchain, dx-config, hooks)
- [x] Updated docs (developer guide, new project workflow, existing project workflow, CLAUDE.md)

### DX Context Architecture (2026-04-07)

> Plan: `.claude/plans/majestic-napping-coral.md` — four-tier context hierarchy (Host → Project → Workspace → Package)

- [x] `DxContext` type definitions + `resolveDxContext({ need })` typed resolver (`cli/src/lib/dx-context.ts`)
- [x] Monorepo discovery in `monorepo-topology.ts` (`MonorepoPackage`, `MonorepoTopology`) + pkg handlers
- [x] `HostContext` resolver (global config, session, layout, factory mode)
- [x] `WorkbenchContextData` resolver (worktree detection, ports, local config, auth profile); `ctx.workbench`, `need: "workbench"`
- [x] `PackageContextData` resolver (single-package + monorepo matching, per-package toolchain)
- [x] Machine-wide worktree discovery (`discoverAllLocalWorkspaces` in `worktree-detect.ts`)
- [x] `dx workbench list` default machine-wide, `--project` flag for scoping
- [x] 18 fixture-based tests for all four context tiers (`cli/src/__tests__/dx-context.test.ts`)
- [x] Migrate `dx up` / `dx dev` / `dx down` to use `resolveDxContext({ need: "project" })` instead of ad-hoc `ProjectContext.fromCwd()`
- [x] Migrate `dx lint` / `dx test` / `dx format` / `dx typecheck` to use `resolveDxContext({ need: "host" })` + `ctx.package` for per-package toolchain
- [x] Migrate `dx check` to use `resolveDxContext({ need: "project" })` + `project.catalog.components` instead of `ProjectContext` directly
- [x] Migrate `dx db` (7 call sites), `dx ship`, `dx git-hook`, `dx env`, `dx sync`, `dx upgrade`, `dx setup` to `resolveDxContext()`
- [x] Migrate handlers: `context-status.ts`, `check/index.ts` to `resolveDxContext()`
- [x] Remove `worktreeInfo`, `toolchain`, `isWorktree`, `mainRepoDir`, `composeProjectName`, `toolchainOnly()` from `ProjectContext` class
- [x] Decouple `db-driver.ts` — `resolveDbTarget()` accepts `(CatalogSystem, systemName)` instead of `ProjectContext`
- [x] Wire `workspace.localConfig` merge — added `effectiveConfig(ctx)` helper that merges `host.config` with `workspace.localConfig`, replacing need for separate `readConfig()` calls when context is available
- [x] `resolveDxContext()` caching — per-process cache keyed by cwd, with `clearDxContextCache()` for tests
- [x] Document `{ need: "host" }` + manual package null-check pattern in `resolveDxContext()` JSDoc — explains why toolchain commands use this instead of `{ need: "package" }`
- [x] Clean up `catalog.ts` — uses `findComposeRoot()` + `ProjectContext.fromDir()` instead of `ProjectContext.fromCwd()` (still uses ProjectContext internally as the compose parser, which is appropriate)

### Deferred — Phase 6+

> Items marked with → have full specs in "dx CLI — Design Handoff Core Commands" section above.

- [ ] `dx doctor` enhancement → see "dx doctor" in Design Handoff Core Commands
- [ ] `dx config` / `dx info` → see "dx config" in Design Handoff Core Commands
- [ ] Detection announcement on first run: "Detected: vitest, eslint, prettier, tsc, drizzle" (handoff §4)
- [ ] `--json` audit across all new commands (handoff §20 — agent-native design)
- [ ] `dx check` parallel execution: run lint + typecheck + format in parallel, test sequentially (handoff §16)
- [ ] `dx dev` orchestration sequence → see "dx dev" in Design Handoff Core Commands
- [ ] `dx db studio` — auto-detect and open drizzle-kit studio or prisma studio (handoff §17)
- [ ] `dx release` → see "dx release" in Design Handoff Core Commands
- [x] `dx setup` (was `dx install`) comprehensive setup → see "dx setup" in Design Handoff Core Commands (37 defaults, 8 providers, backup/restore, --check, role filtering)
- [ ] Port conflict detection in `dx dev` → see "dx dev" in Design Handoff Core Commands
- [ ] Global PortManager — unify project-local `.dx/ports.json` with global `~/.config/dx/` so cross-project port conflicts are detected (currently only forwards are global)
- [ ] `dx remove` — safely remove a component from the project (reverse of `dx add`)
- [ ] Stacks/presets for `dx init` — opinionated starter kits (e.g. "SaaS starter", "API-only", "fullstack monorepo")
- [ ] Community templates for `dx init` — pull template from registry
- [ ] `dx catalog` command enhancements — visualize project catalog from docker-compose labels
- [ ] Rust and Java quality strategies in toolchain detector (currently detects runtime but limited tool detection)
- [ ] `dx upgrade --check` for CI — fail if dx template is outdated (template version drift detection) (handoff §13)
- [ ] `dx sync` codegen freshness check — only run generators if inputs changed (compare mtimes or hashes)
- [ ] `dx open` — auto-run `dx ssh config sync` when SSH config entry for workspace slug is missing (currently requires manual sync)
- [ ] `dx open` — interactive picker: show workspace status/health indicators, group by tier (local vs remote)

---

## dx CLI — Design Handoff Core Commands

Spec: `docs/reference/dx-cli-design-handoff.md` + `docs/reference/dx-cli-design-handoff-addendum.md`

Tracking features from the design docs not yet implemented. Items already tracked in other BACKLOG sections are cross-referenced, not duplicated.

### `dx factory` — Authentication & Host Management (addendum §2)

> Tracked in "Stub CLI Commands" section above.

### `dx setup` — Comprehensive Machine Setup (handoff §11)

#### Completed (2026-04-06)

- [x] Renamed from `dx install` to `dx setup` (command, file, all user-facing strings, docs)
- [x] 8 ConfigProviders: git (9), npm (6), curl (5), psql (7), docker (5), ssh (2), system-limits (2), shell (1) = 37 defaults
- [x] Git defaults: `pull.rebase`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictstyle zdiff3`, commit template
- [x] Docker daemon defaults (log rotation, ulimits, BuildKit, GC) with deep-merge JSON + `sudoWrite`
- [x] npm defaults (`~/.npmrc`: `save-exact=true`, `engine-strict`, etc.)
- [x] SSH ControlMaster config (Linux/macOS) + socket directory setup via managed blocks
- [x] System limits: inotify watches (Linux), file descriptor limits (macOS `launchctl`) with `sudoExec`
- [x] Shell history config (bash/zsh) via managed blocks
- [x] psql + curl defaults
- [x] Platform detection + show-diff-before-apply + backup originals to `~/.dx/backups/` with manifest.json
- [x] `dx setup --check` dry-run (shows N/N configured per category, exit 1 if pending)
- [x] `dx setup --skip-defaults` to skip defaults phase
- [x] `dx setup restore [category]` — manifest-based backup restore
- [x] Idempotent re-runs (detects already-applied, only applies pending)
- [x] Root detection (`process.getuid() === 0`): `sudoWrite`/`sudoExec` skip sudo in Docker/CI
- [x] `adaptCommand()` strips `sudo` from install commands when running as root
- [x] Pre-defaults prerequisite auto-install (git + curl via `ensureTool()`)
- [x] `--yes` mode auto-installs all missing tools non-interactively
- [x] Role-based toolchain filtering (`roles` field on `ToolDef`, filtered by `--type`)
- [x] `dx doctor` defaults category integration (reads saved role from config)
- [x] gcloud Linux install: `/opt/google-cloud-sdk` + symlink to `/usr/local/bin/gcloud` (no shell restart needed)
- [x] Tested: macOS, Ubuntu 24.04 VM, privileged Docker, workspace+dind (k3s pod sim), act (GitHub Actions)
- [x] 28 unit tests (5 defaults, 7 backup, 16 file-utils)

#### Deferred

- [ ] fnm + corepack setup (Node version management via fnm instead of system node)
- [ ] Windows-specific defaults: credential manager, ssh-agent auto-start, PowerShell history
- [ ] Print "Run `dx factory login` to connect to your organization" at end of setup
- [ ] Test on Debian 12 and Rocky 9 (multipass VMs) — currently only tested on Ubuntu 24.04
- [ ] zsh-specific shell defaults (currently only bash history/navigation defaults)
- [ ] Linux shell defaults: check `$SHELL` before adding bash config — skip `.bashrc` if user only uses zsh
- [ ] tmux defaults provider
- [~] `dx setup` CI smoke test in actual GitHub Actions workflow — workflow added, script created, workspace create/list/wait works; SSH + delete still failing
- [ ] Batch Docker daemon.json writes — apply all Docker changes in a single read-modify-write instead of per-key (sequential apply works but is fragile)
- [ ] Backup tests: isolate from real `~/.dx/backups/` by setting `HOME` to tmpdir in test setup
- [ ] `upsertDotfile` should preserve file permissions (relevant for files like SSH config that need 600)
- [ ] Smoke test: save/restore `factoryUrl` config before/after test to avoid clobbering user's setting
- [x] Platform detection module (`defaults/platform.ts`): OS, WSL detection, elevation check — lazy singleton
- [x] `file-utils.ts`: `sudoWrite`/`sudoExec` use `detectPlatform()` — no `process.getuid` crash on Windows
- [x] `toolchain.ts`: `shellExec()` helper uses `powershell -Command` on Windows instead of `sh -c`
- [x] `docker-defaults.ts`: enabled on Windows — writes `~/.docker/daemon.json` (same as macOS path)
- [x] `system-defaults.ts`: skips sysctl in WSL (kernel params controlled by `.wslconfig`)

### `dx dev` — Full Startup Sequence (handoff §15)

- [x] Pre-flight: hook health check + codegen
- [ ] Pre-flight: check Docker running, check ALL ports before starting anything
- [ ] Pre-flight: port conflict → identify process, offer to kill
- [ ] Smart infra/app split: `image:`-only services → Docker, `build:` services → native host
- [ ] Health-gate infra before app (wait for healthchecks before starting app servers)
- [ ] Run migrations if pending (auto-detected tool)
- [ ] Run codegen if stale
- [ ] App dev servers: auto-detect framework or use `"dev"` script override
- [ ] `dx dev stop` — tear down containers + kill native dev server processes
- [ ] `dx dev reset` — `docker compose down -v` + rebuild + restart
- [ ] `dx dev --with <profile>` — Docker Compose profiles for optional service groups
- [ ] Idempotent: if services already running, attach don't restart
- [ ] Worktree-aware: shared infra, isolated app servers with auto-assigned ports (addendum §4)

### `dx doctor` — Comprehensive Diagnostics (handoff §19)

- [ ] System checks: OS, file descriptors, inotify watches, disk space
- [ ] Git checks: version, config values (`pull.rebase`, `push.autoSetupRemote`, `core.hooksPath`), SSH key
- [ ] Docker checks: version, BuildKit, log rotation, disk usage
- [ ] Node checks: version match `.node-version`, pnpm via corepack, `save-exact`
- [ ] Editor checks: VS Code settings, extensions, launch config
- [ ] Registry auth checks: actually test pull/auth for GCP AR, ghcr.io, npm, Factory API
- [ ] Project template version check
- [ ] `--json` output

### `dx status` — Running State View (handoff §19)

- [ ] Show all services with ports, health status
- [ ] Show native dev server processes (pid, watching status)
- [ ] Show environment deployment info (preview URL + version, prod URL + version)
- [ ] `--json` output

### `dx config` — Toolchain Introspection (handoff §19)

- [ ] Show project name, type, team, template version
- [ ] Show all detected tools (runtime, package mgr, test, lint, format, typecheck, db, migrations, codegen)
- [ ] Show overrides from `package.json` scripts
- [ ] Show quality pipeline composition (`dx check` breakdown)
- [ ] `dx config get [key]` — query specific config
- [ ] `--json` output

### `dx release` — Version & Deploy (handoff §18)

- [ ] `dx release [major|minor|patch]` — auto-increment version from conventional commits
- [ ] Generate changelog from conventional commits since last tag
- [ ] `git tag` + `git push --tags` + `gh release create --generate-notes`
- [ ] Trigger production deploy via Factory API
- [ ] Pre-release support (`--pre-release`, `--rc`)
  > Also tracked in Phase 4 below.

### `dx secret` — Vault-Backed Secret Management (handoff Appendix B)

- [ ] `dx secret list` — list secrets for project
- [ ] `dx secret get <KEY> --target <env>` — fetch from vault
- [ ] `dx secret set <KEY> --target <env>` — opens `$EDITOR` (value never in shell history)
- [ ] Pluggable backend (HashiCorp Vault, AWS SSM, Infisical)
  > Also tracked in "Stub CLI Commands" section.

### `.env` Generation (handoff Appendix B)

- [ ] Generate `.env` from `docker-compose.yaml` service environment blocks + `.dx/local/secrets.yaml`
- [ ] Auto-generate random values for dev secrets (JWT_SECRET, etc.) on first run
- [ ] Prompt once for real secrets (STRIPE_KEY, etc.), store in `.dx/local/secrets.yaml`
- [ ] Regenerate on `dx sync` and `dx dev` startup

### `dx check --strict` — Agent Quality Gates (addendum §6)

- [ ] `--strict` flag: full test suite (not just `--changed`), zero warnings, coverage threshold, no TODO/FIXME/HACK in changed files, `dx generate --check`
- [ ] `.dx/local/agent-mode` flag detection — pre-push hook runs `--strict` in agent worktrees
- [ ] Agent context files: ticket context written to `.dx/local/ticket-context.md`

### Cross-Platform Support (handoff §10)

- [ ] `.gitattributes` template with line ending rules (generated by `dx init`)
- [ ] `core.autocrlf` setting per platform in `dx install`
- [ ] Windows: SSH agent auto-start, no ControlMaster, credential manager
- [ ] Windows: Docker Desktop WSL2 backend check, filesystem perf warning
- [ ] POSIX sh hooks (not bash) for Git for Windows compatibility

### Known Hosts Strategy (addendum §10)

- [ ] Scoped trust: dx-managed hosts use `StrictHostKeyChecking accept-new` + separate `UserKnownHostsFile ~/.ssh/known_hosts.d/dx-infra`
- [ ] `dx factory sync hosts` clears `~/.ssh/known_hosts.d/dx-infra` on IP changes
- [ ] Future: SSH CA certificates for managed hosts

---

## dx work — Work Item System

Spec: `docs/reference/dx-cli-design-handoff-addendum.md` §3-6

### Phase 1 — Core Work Items

- [ ] `dx work start <TICKET>` — fetch ticket from Jira, generate branch name (`<ticket-slug>/<description-slug>`), create branch from main HEAD
- [ ] `dx work start --quick "description"` — auto-create Jira ticket (default type: Task) + branch
- [ ] `dx work start --no-worktree` — simple mode, just create branch + checkout
- [ ] `dx work list` — show all active work items with branch, mode, who, commits, ports, age
- [ ] `dx work status` — detailed status of current work item
- [ ] `dx work switch <TICKET>` — cd to worktree or checkout branch
- [ ] `dx work rebase` — rebase current branch onto main
- [ ] `dx work sync` — rebase onto main + run `dx sync`
- [ ] `dx work done` — cleanup after PR merge: delete worktree + branch + drop DB + update Jira
- [ ] `dx work done --all` — cleanup ALL merged work items
- [ ] `dx work abandon <TICKET>` — delete worktree + branch without merge (with confirmation)
- [ ] `dx work pr [--draft]` — `gh pr create --fill`, stack-aware base
- [ ] `dx work check-age` — CI command: warn at 3d, error at 7d (configurable in `package.json#dx.work`)
- [ ] Branch naming validation in `pre-push` hook (enforce `<ticket>/<slug>` pattern)
- [ ] `--json` output for `dx work list` and `dx work status`

### Phase 2 — Worktree Support

- [ ] `dx work start <TICKET>` (default) — create git worktree in `<project>.worktrees/<ticket>/`
- [ ] Worktree setup: `pnpm install`, generate `.env` with worktree-specific `DATABASE_URL`, create per-worktree DB, run migrations
- [ ] Worktree detection (`git rev-parse --git-common-dir` vs `--git-dir`)
- [ ] `dx dev` worktree-aware: shared infra (postgres, redis), isolated app servers with auto-assigned ports (base port + worktree index)
- [ ] Per-worktree database isolation: `<project>-<ticket>` naming, auto-create/drop
- [ ] Port assignment strategy: base ports + worktree index offset, auto-increment on conflict
- [ ] `dx work done` cleanup: remove worktree dir + drop per-worktree DB

### Phase 3 — PR Stacking

- [ ] `dx work stack "description"` — create stacked branch from current (not from main)
- [ ] Stack metadata in `.dx/local/stacks.yaml` (gitignored)
- [ ] `dx work stack status` — show stack state with PR status and sync status
- [ ] `dx work restack` — rebase entire stack in order, `--force-with-lease` push
- [ ] After stacked PR merges: `dx work restack` retargets remaining PRs to main
- [ ] `dx work pr` auto-sets `--base` from stack metadata

### Phase 4 — Agent Workflows

- [ ] `dx work start <TICKET> --agent` — worktree + `.dx/local/agent-mode` flag + ticket context file
- [ ] Agent context injection: Jira ticket description → `.dx/local/ticket-context.md`
- [ ] Pre-push hook detects agent-mode → runs `dx check --strict`
- [ ] Parallel agent isolation: each agent gets own worktree, branch, port allocation, database

### Prerequisites

- Jira API integration (work tracker adapter) — see "Unimplemented Adapters" section
- `package.json#dx.work` config: `tracker`, `project`, `branch_max_age_days`, `branch_warn_age_days`, `agent_strict_checks`, `default_worktree`

---

## V1 → V2 API Migration

V1 controllers deleted from `createLocalApp` (2026-04-07). These CLI commands still call v1-only routes that have no v2 equivalent yet:

- [ ] `dx module` — `build/modules/:name`, `build/modules/:name/versions` → add v2 ontology routes or migrate to `product/systems`
- [ ] `dx artifact` — `build/artifacts`, `build/component-artifacts` → add v2 routes (note: `product/artifacts` exists in v2 but under different prefix)
- [ ] `dx bundle generate` — `commerce/bundles`, `commerce/bundles/verify` → add v2 routes on commerce controller
- [ ] PR listing/checks — `build/git-host-provider/:id/repos/:repoSlug/pulls[/:number/checks]` (used in `factory-status.ts`, `pr.ts`, `ship.ts`) → add v2 routes on repos or git-host-providers
- [ ] Delete v1 schema files once all services are migrated to v2 schemas (currently 50+ files still import v1 schemas)

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

- [ ] `dx check` tool resolution: oxlint/prettier not found when not installed globally — pre-push hook fails on machines without global installs
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
- [x] Chat SDK Slack adapter setup + webhook route
  - Chat SDK integrated into Elysia API server (not separate app), echo bot working
  - Curl-based axios adapter for Bun HTTPS compat (`bun-https-fix.ts`)
  - In-memory state adapter (`@chat-adapter/state-memory`)
- [x] Replace in-memory state with `@chat-adapter/state-pg` for subscription persistence; thread/channel/turn data stored in `org` tables via handlers
- [x] Extract shared curl HTTP utility (`api/src/lib/curl-http.ts`) from `bun-https-fix.ts` and `slack-client.ts`
- [x] Capture Slack rate-limit response headers (`Retry-After`) in curl adapter via `curl -i` header parsing
- [x] ~~Custom state adapter~~ — Superseded: using `@chat-adapter/state-pg` + handler-level DB writes to `org.thread`/`thread_turn`
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
- [x] `ensureLocalCluster()` — auto-create/recover k3d cluster before daemon start (`cli/src/local-daemon/ensure-cluster.ts`)
- [x] Stale k8s resource detection in reconciler — delete namespace if pod has different workspace ID
- [x] `SANDBOX_STORAGE_CLASS=local-path` default for k3d in daemon env
- [x] `KUBECONFIG` passthrough from ensureLocalCluster to daemon process
- [x] `dx doctor --category local` — 9 health checks (k3d, Docker, cluster, API, storage class, NodePort range, daemon, health endpoint, PGlite)
- [ ] Multi-registry support: configurable artifact registries beyond GCP (e.g. GitHub Packages, GitLab, custom registries per org)
- [ ] Cluster health watchdog in daemon (60s interval, auto-restart k3d if API unreachable)
- [ ] Reconciler supervision: detect stalls, restart loop if stuck
- [ ] PGlite migration mismatch detection: wipe and re-migrate on schema hash mismatch

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

- [x] `dx ssh config sync` pagination — pass `?limit=200` to fetch all targets (was silently truncated to 50)
- [ ] `dx ssh config sync` — populate `host.spec.ipAddress` on production hosts (currently only `spec.hostname` is set, containing machine names not IPs, so SSH config entries may not resolve)
- [x] `/access/targets` and `/access/resolve/:slug` API shape convergence — both now delegate to `access.service.ts` (`listTargets`/`resolveTarget`), returning canonical `SshTarget` shape
- [ ] `dx ssh` remote command quoting: ensure `cloud ssh <target> -- <cmd>` and `dx ssh <target> -- <cmd>` properly escape/quote commands with special chars (spaces, quotes, parens, pipes) — current `cloud ssh` mangles multi-word args and SQL commands
- [ ] `dx ssh` arbitrary command execution: support `dx ssh <target> -- docker exec ... psql -c "SELECT 1"` with proper stdin piping (match how `ssh user@host 'cmd'` works natively)
- [ ] Host `defaultSshConfig` JSONB column — per-host SSH defaults (user, port, jump host/user/port, identity file) in DB, flowing through access service → entity-finder → CLI. Includes: schema + migration, API update endpoint (`POST /hosts/:id/update`), `dx infra host add/update` CLI flags (`--ssh-user`, `--ssh-port`, `--jump-host`, etc.), VM inheritance from parent host's config. Plan: `.claude/plans/serene-spinning-fern.md`
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

## Database Lifecycle Management

Full design spec: `docs/superpowers/specs/2026-04-02-database-lifecycle-management-design.md`

Goal: Remove friction from creating dev/preview environments by making database backup, restore, seeding (with anonymized production data), and provisioning a first-class concern in Factory.

### Phase 1: Schema + Adapter + Reconciler

- [ ] Add `database`, `database_operation`, `anonymization_profile` tables to `factory_fleet` schema
- [ ] Drop unused `dependency_workload` table
- [ ] Create `DatabaseAdapter` interface + `PostgresAdapter` (pgBackRest + pg_dump)
- [ ] Create `DatabaseReconciler` class (provision sidecar DBs, run backup/restore/seed Jobs, monitor operations)
- [ ] Wire `DatabaseReconciler` into main `Reconciler.reconcileAll()` loop
- [ ] Database resource generator (K8s StatefulSet, Service, PVC, Job manifests)

### Phase 2: API Endpoints

- [ ] Database CRUD endpoints (`GET/POST/DELETE /databases`)
- [ ] Backup/restore/seed operation endpoints
- [ ] Anonymization profile CRUD
- [ ] Backup policy management endpoints
- [ ] Operations tracking endpoint

### Phase 3: CLI Commands

- [ ] `dx db list` — list databases across all deployment targets
- [ ] `dx db register` — register existing external database
- [ ] `dx db create` — create new sidecar database
- [ ] `dx db backup/restore/seed` — trigger operations
- [ ] `dx db operations --watch` — track operation progress
- [ ] `dx db anonymize-profile create/list` — manage anonymization rules
- [ ] `dx db backup-policy set/remove` — manage backup schedules

### Phase 4: Sandbox/Preview Integration

- [ ] Auto-provision databases on sandbox creation (from docker-compose config)
- [ ] Auto-seed sandbox databases from production backups (anonymized)
- [ ] Auto-provision databases on preview deployment
- [ ] Inject `DATABASE_URL` env vars into preview/sandbox containers
- [ ] Database config in `dx init` project templates

---

## Observability / OpenTelemetry

### Completed (2026-04-02)

- [x] OTel Collector service in docker compose (`--profile otel`, debug exporter + zpages)
- [x] API backend instrumentation (`NodeSDK` + `auto-instrumentations-node`, Bun-compatible)
- [x] CLI instrumentation (`BasicTracerProvider` + manual W3C `traceparent` header propagation)
- [x] UI tracing gated behind `TELEMETRY_ENABLED`
- [x] Single `TELEMETRY_ENABLED` env flag across the stack

### Deferred

- [ ] Connect to production tracing backend (Jaeger, Grafana Tempo, or SigNoz) instead of debug exporter
- [ ] Custom business-logic spans (e.g., sandbox lifecycle, preview deploy, pipeline run durations)
- [x] Bun context propagation: was missing `AsyncLocalStorageContextManager` registration (not a Bun bug) — now using standard OTel APIs
- [ ] Metrics collection: API request latency, error rates, sandbox provision times (OTel metrics pipeline already wired but no custom metrics emitted yet)

---

## Identity Sync & `dx org identity`

Multi-provider identity sync across GitHub, Slack, Jira, Google with cross-provider principal matching and CLI management.

### Completed (2026-04-04)

- [x] `IdentityProviderAdapter` interface + adapters for GitHub, Slack, Jira, Google
- [x] `$secret(key)` / `$var(key)` reference resolution in provider JSONB spec fields (`spec-ref-resolver.ts`)
- [x] `spec` JSONB column on `git_host_provider`, `messaging_provider`, `work_tracker_provider`
- [x] Multi-signal principal matching: email → existing link → cross-provider login
- [x] Two-pass sync: Discovery + Profile Refresh
- [x] Fuzzy name-based merge pass (normalized name, skip ambiguous, prefer email + oldest)
- [x] `mergePrincipals()` in IdentityService (moves links, memberships, promotes email, deletes duplicate)
- [x] Route prefix rename: `/identity/` → `/org/` (v1 + v2 controllers)
- [x] New API actions: `unlink-identity`, `merge` on principals, `POST /org/sync/identities`
- [x] `dx org identity list|show|link|unlink|merge|sync|unmatched` CLI commands
- [x] Slack app (Factory Bot) created with Chat SDK + identity scopes, webhook handler verified
- [x] 43 identity sync tests (spec-ref resolver, provider config, no-email dedup, profile merge, tool credentials)

### Deferred

- [ ] Google OAuth user-facing flow: redirect user to Google consent → exchange code for token → store in `identity_link.tokenEnc` (client creds stored, no user flow yet)
- [ ] GitHub commit-email enrichment: fetch commit emails from repos to improve cross-provider matching for users without public GitHub emails
- [ ] Bulk identity resolution UI/CLI: `dx org identity suggest` — propose likely matches based on name similarity scores (not just exact normalized match)
- [ ] `dx org identity import <csv>` — bulk import/link identities from a CSV file
- [ ] Confidence scoring for fuzzy name matches (e.g. Levenshtein distance threshold, partial first/last name matching)
- [ ] Periodic sync scheduling via `dx org identity sync --schedule <cron>` or Factory API background job
- [ ] Jira email visibility: use Jira admin APIs or SCIM to fetch emails for users where `users/search` returns none
- [ ] Profile photo/avatar sync: pull avatars from identity providers and serve unified avatar via Factory API
- [ ] Move provider credentials from inline spec to `$secret()` references for production deployments
- [ ] Standalone webhook server (`api/src/standalone-webhook-server.ts`) — temporary workaround for Vinxi/Drizzle schema crash; remove when root cause fixed

---

## Ideas / Future

- [ ] Pipeline cache management (`pipeline_cache_entry` table, `dx ci cache` commands)
- [ ] Parallel job execution tracking with DAG visualization
- [ ] Build artifacts → artifact registry integration
- [ ] Preview auto-sleep (hot→warm→cold tier transitions already in preview service cleanup loop)
- [ ] Preview auth modes (public, team-only, password-protected — `authMode` column exists)
- [ ] Site lifecycle hook (`api/src/reconciler/site-lifecycle-hook.ts`) — Phase 4 Step 9: post PR comments and update GitHub deployment status on site phase transitions (provisioning → active → decommissioned). Preview-type sites should create GitHub Deployments via the Checks API and post/update a status comment on the PR. Generic sites should log status transitions. Specs: `SiteObservedStatus.github.deploymentId` and `commentId` fields already exist in the schema.
- [ ] Docker Compose runtime for previews — deploy preview containers via `docker compose up` on same network as factory API (no k8s needed, simplest path for single-VM deployments)
- [ ] Migrate full Factory stack into k3s (postgres, spicedb, auth, factory API as k8s Deployments) for multi-node/multi-cluster production
- [ ] Webhook retry/replay for failed deliveries
- [ ] `dx ci replay <run-id>` — re-run a pipeline from a specific run
- [ ] Metrics/observability: pipeline duration trends, failure rates, flaky step detection
- [ ] Slack/messaging notifications for pipeline status changes (messaging adapter exists)
- [ ] Branch protection rules enforcement via API
- [ ] Work-tracker sync: batch upsert with `INSERT ... ON CONFLICT DO UPDATE` instead of per-row select+insert/update (N+1 queries)
- [ ] Work-tracker sync: detect and soft-delete projects removed from external tracker (like git-host sync does with repos)
- [ ] Work-tracker sync: add error-path test (adapter throws → assert provider `syncStatus === "error"` and `lastSyncAt` is set)
- [ ] Work-tracker sync: pagination safety cap (e.g., 500 pages max) to prevent runaway loops if API misbehaves

---

## Unimplemented Adapters & Integrations

### Work Tracker Adapters

- [x] JIRA adapter — fully implemented with pagination, Basic auth, API v3 migration (`work-tracker-adapter-jira.ts`)
- [ ] JIRA adapter: implement HMAC webhook verification (`verifyWebhook` always returns `valid: true`)
- [ ] JIRA adapter: use bulk issue creation API (`POST /rest/api/3/issue/bulk`) in `pushIssues` instead of sequential single-issue calls
- [ ] Linear adapter — all 6 methods stubbed (`work-tracker-adapter-linear.ts`)

### Observability Adapters

- [ ] ClickStack adapter — all 17 methods stubbed (`observability-adapter-clickstack.ts`)
- [ ] SigNoz adapter — all 17 methods stubbed (`observability-adapter-signoz.ts`)

### Tunnel Backends

- [ ] Gateway tunnel backend (`cli/src/lib/backends/gateway-backend.ts`) — requires gateway infrastructure
- [ ] SSH tunnel backend (`cli/src/lib/backends/ssh-backend.ts`)
- [ ] kubectl tunnel backend (`cli/src/lib/backends/kubectl-backend.ts`)

### `dx forward` — Remote Port Forwarding (new, from design addendum)

- [x] `dx forward <host>:<port>` — bring remote port to localhost via SSH `-L` (host resolved from `dx factory` aliases)
- [x] `dx forward <host>:<port> --as <local-port>` — map to a different local port
- [x] `dx forward <host>:<port> <host>:<port>` — multiple ports in one command
- [x] `dx forward list` / `dx forward close [id|--all]` — manage active forwards
- [x] Port conflict auto-detection — if local port in use, auto-assign next free port (unless `--as` explicit)
- [x] Wire `dx db connect --target` to use `dx forward` internally for remote DB tunneling
- [x] Global forward state persistence (`~/.config/dx/forwards.json`) with dead-PID pruning
- [x] PortManager integration — compose port allocation excludes globally-forwarded ports
- [x] `dx forward --bg` — spawn SSH process detached and exit CLI, close via `dx forward close`
- [x] Document two-token auth model (opaque bearer for auth service vs JWT for Factory API) in developer guide

### Deprecated Commands

- [ ] Deprecate `dx connect <env>` — show migration message pointing to `dx forward <host>:<port>` (per design addendum)

### Tunnel System — Production Hardening

> Note: `dx tunnel` = expose local port publicly (ngrok model, per design addendum). `dx forward` = bring remote port to localhost (SSH -L). Existing tunnel implementation aligns with addendum semantics.

- [x] POST/PUT/PATCH request body forwarding through tunnel (DATA frame handling in tunnel-client.ts)
- [x] WebSocket passthrough: browser WS ↔ gateway proxy ↔ tunnel WS_DATA ↔ local WS
- [x] WS connect-phase message buffering (queue WS_DATA while local WS is CONNECTING)
- [x] Smoke test suite using real `handleBinaryFrame` (not inline fakes), dual-mode local/prod via `FACTORY_URL`
- [x] Multiple concurrent WebSocket connections per tunnel — replaced single `onWsMessage` callback with `Map<streamId, WsStreamHandlers>` dispatch via `registerWsStream`/`unregisterWsStream`
- [x] Binary WebSocket data round-trip test (smoke test + echo server binary support)
- [x] Tunnel client backpressure on incoming DATA frames — `BodySink` with 4MB high-water mark, pull-based overflow drain
- [x] Tunnel reconnect with `onReconnected` callback (full stream resumption deferred — requires protocol-level changes)
- [x] Gateway proxy connection pooling — verified Bun.serve uses HTTP keep-alive by default; single persistent WS per tunnel with multiplexed streams is sufficient
- [x] Tunnel reconnect with stream resumption — broker-side replay buffer (1024 frames, 60s grace), client `lastReceivedSeq` tracking, resume on reconnect
- [x] Make `wsConnectQueues` per-connection instead of module-level singleton — threaded as parameter through `handleBinaryFrame` → `forwardWsUpgrade`
- [x] Body stream inactivity timeout — `bodyTimer` resets on each DATA frame, configurable via `bodyTimeoutMs`
- [x] Cancel `streamBody` reader on `cleanup()` — `activeReaders` set tracks in-flight readers, cancelled in `cleanup()`
- [ ] Tunnel reconnect: keep route alive during grace period — currently closes tunnel + route on disconnect, creating a brief 502 window before re-registration

---

## Bugs Found in Smoke Testing

- [ ] **Reconciler marks workspace active before containers are ready** — workspace pod shows `ContainerCreating 0/2` but reconciler already set `lifecycle: active`. Should check pod phase/conditions for readiness.
- [ ] **Bitemporal workbench delete fails** — `dx workbench delete` tries to re-insert the full row (bitemporal soft delete) but fails with a constraint violation. The `ontologyRoutes` delete handler may not be correct for PGlite.
- [ ] **`dx workbench create` sends wrong body shape** — CLI was sending `type` and `ownerId` nested in `spec` instead of at the top level. Fixed: now sends `slug`, `type`, `ownerId` at root.
- [ ] **Demo seed missing principals** — `seedDemoData()` inserts workspaces referencing alice/bob/charlie but never creates those principals. Fixed: added principal inserts before workspace inserts.
- [ ] **`dx ssh` kubectl exec container name mismatch** — attempts `kubectl exec` with container name "workspace" but the pod may use a different container name. Needs investigation.
- [ ] **PGlite migration fails on re-run** — `CREATE SCHEMA "build"` fails with "already exists" when PGlite data persists across schema changes. Need `IF NOT EXISTS` or migration state tracking.

---

## Unimplemented Reconciler Strategies

- [ ] Docker Compose strategy — SSH, compose generation, drift detection (`reconciler/strategies/compose.ts`)
- [ ] systemd strategy — SSH, unit file generation, status checks (`reconciler/strategies/systemd.ts`)
- [ ] Windows Service strategy — WinRM, PowerShell deployment (`reconciler/strategies/windows.ts`)
- [ ] Windows IIS strategy — WinRM, IIS site management (`reconciler/strategies/windows.ts`)

---

## Stub CLI Commands

These commands are registered but return "Not yet implemented":

- [ ] `dx factory login` — authenticate with Factory, configure registries + SSH hosts (replaces `dx auth login`). Should not print session file path (security concern — just say "Signed in as ...")
- [ ] `dx factory status` — auth status, token expiry, org, managed hosts
- [ ] `dx factory sync hosts` — re-fetch host inventory from Factory API, update SSH config, clear stale host keys
- [ ] `dx factory hosts list` / `dx factory hosts update <name> --ip <ip>` — host inventory management
- [ ] `dx factory login --ci` — non-interactive auth using ambient CI credentials (replaces `dx auth ci`)
- [ ] `dx ops restart`, `dx ops scale`
- [ ] `dx context list`, `dx context show`, `dx context select`
- [x] `dx secret` — centralized secret management (see Phase 10 below)
- [ ] `dx agent list`, `dx agent run`, `dx agent show`
- [ ] `dx work` — full work item & branching system (see "dx work — Work Item System" section below)
- [ ] `dx tenant assign`, `dx tenant list`, `dx tenant show`
- [ ] `dx factory create`, `dx factory remove` (note: `dx factory` namespace now also includes `login`, `status`, `sync hosts`, `hosts` — see above)
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
- [ ] SSH server feature in devcontainer (sshd) for `ssh -p <nodeport>` access — needed for `dx open` editor remote-SSH and AI agent filesystem access
- [ ] Ensure all workspace tiers (container, VM) expose SSH uniformly — `dx open` assumes SSH-based access for editor remote open
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

## Production Infrastructure

- [ ] SpiceDB database auto-creation in docker compose init (currently requires manual `CREATE DATABASE spicedb`)
- [ ] SpiceDB migration step in docker compose startup (run `datastore migrate head` before serve)
- [ ] Traefik v3 config validation: add CI check that HostRegexp rules use v3 syntax (not v2 `{name:.+}` which silently fails)
- [ ] Edge Traefik health monitoring: alert when `*.tunnel.lepton.software` or `*.preview.lepton.software` routes stop resolving

### Build & Deploy Hygiene

- [x] Root `.dockerignore` — excludes `**/node_modules`, `.output`, `.cache`, `dist`, `.next`, `.vinxi`, `.turbo`, `coverage`, `.git`. Without it, `COPY ./api ./api` was pulling host's stale `node_modules` (with absolute pnpm-store paths baked into `.bin` wrappers) into the image and overriding the fresh builder install
- [x] `api-server/Dockerfile` — copy `graph` and `graph-dx-factory` workspace packages (was still referencing renamed-away `ontology`)
- [x] `authPlugin` throws `UnauthorizedError` so global error handler emits proper 401 + `{code:"unauthorized"}` body (was rewriting to 500)
- [x] Surface curl errors when slack `setStatus` calls fail — switch `-s` to `-sS` and include exit code in the thrown error so timeout (28) / DNS (6) / TLS (35) failures are distinguishable in logs
- [ ] Replace ad-hoc `factoryBaseUrl()` duplicates in `documents/index.ts`, `ide-hook.controller.ts`, `threads/index.ts` with a single shared helper

### Route Resolution & Network Topology

- [ ] Compose-project port mapping resolution in route resolver (deferred — how do compose ports map to host ports?)
- [ ] Cascade invalidation: host IP change → mark dependent routes as stale for re-resolution
- [ ] Config drift detection: compare DB route state vs actual Traefik dynamic config on disk
- [x] `POST /infra/trace` endpoint: walk the networkLink graph from a starting entity to produce the full request path (IPs, ports, slugs at each hop)
- [ ] Reconciler auto-creates networkLink entities from Traefik/Gateway config (read actual proxy config → upsert links)
- [x] networkLink validation hooks: verify source/target entities exist on create/update (beforeCreate/beforeUpdate hooks via `validateEndpoints`)
- [ ] networkLink cascade delete: remove links when source/target entities are deleted
- [ ] `traceFrom` branching support: walk all links at each hop (tree trace) instead of only first link; add ORDER BY priority/createdAt for deterministic single-path trace
- [ ] Multi-target weighted load balancing in Traefik YAML generation (traefik-sync currently uses only first resolved target)
- [ ] **Unify reconciler multi-pass into per-host atomic reconciliation** — main-host routes created in step 8c can conflict with crawled-host route updates in the second pass (step 8c½+). Refactor so each host's scan data (services, reverseProxies, routes) is reconciled as one atomic unit, eliminating ordering dependencies between passes. Currently airflow `resolvedTargets` is intermittently cleared between passes.
- [x] `dx route trace --probe` — per-segment vantage-point probes via SSH (cURL/nc timing from each hop's source host)
- [x] `dx route trace` always-on health signals — stale badges, middleware chain, backend weight on forward links
- [x] Filter Traefik `@internal` services at scan time (collector) and trace time (route matcher)
- [x] Traefik API detection from container static config (`--api.insecure=true` + `--entrypoints.traefik.address`) with container→host port map translation
- [x] Crawled host `reverseProxies` + `services` preserved in API scan payload (were stripped before)
- [x] Reconciler second pass: update `resolvedTargets` and component specs from crawled host scan data
- [x] Linux collector: capture `TargetPort` (not just `PublishedPort`), prefer `Publishers` list over `Ports` string
- [x] `collectContainerIpMap`: capture `ExposedPorts`, full `NetworkSettings.Ports` JSON, and `Config.Cmd`

---

## CLI Error Reporting & Diagnostics

### Completed (2026-04-06)

- [x] `DxError` structured error class with operation, metadata, suggestions, cause chain (`cli/src/lib/dx-error.ts`)
- [x] CLI logger with level control via `--verbose`/`--quiet`/`DX_LOG_LEVEL` (`cli/src/lib/logger.ts`)
- [x] Top-level error handler renders DxError context, stack traces with `--verbose`, structured JSON with `--json` (`cli/src/cli.ts`)
- [x] `exitWithDxError()` convenience for command handlers (`cli/src/lib/cli-exit.ts`)
- [x] `shellCaptureOrThrow()` throws DxError with stdout/stderr context (`cli/src/lib/shell.ts`)
- [x] `apiCall()` wraps API errors in DxError with status, recovery suggestions (`cli/src/commands/list-helpers.ts`)

### Deferred

- [ ] Migrate existing `exitWithError(flags, message)` call sites to `exitWithDxError(flags, DxError)` with operation context
- [ ] `dx workbench create --wait` timeout UX: query workbench status on timeout, show actionable guidance ("still provisioning", "reconciler error")
- [ ] Typed response schemas exported from ontology routes so Eden clients carry proper types (eliminates `as unknown as` casts)
- [ ] `dx doctor --category local --fix` — auto-fix mode that runs recovery actions instead of just showing fix suggestions

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

## Phase 10: `dx secret` + `dx var` — Centralized Config & Secret Management

> CLI surface also tracked in "dx secret" under "dx CLI — Design Handoff Core Commands" (handoff Appendix B).

Inspired by Fly.io secrets, Doppler, Railway variables, GitHub Actions vars/secrets split. Store config vars (plain-text) and secrets (AES-256-GCM encrypted) in Factory DB, scoped per org/team/principal/system + environment. Eliminates plaintext `.env` files on VMs.

- [x] `org.config_var` DB table (plain-text variables, scoped by scopeType/scopeId/environment)
- [x] `org.secret` DB table (envelope-encrypted, AES-256-GCM with iv/authTag/keyVersion for rotation)
- [x] Zod schemas for ConfigVar and OrgSecret (shared package)
- [x] Encryption service: AES-256-GCM encrypt/decrypt with master KEK from env var or KMS
- [x] Key rotation support: re-encrypt all secrets with new keyVersion on KEK rotation
- [x] `dx var set KEY=value --scope <scope>` — store a plain-text config variable
- [x] `dx var get KEY --scope <scope>` — retrieve a variable value
- [x] `dx var list --scope <scope>` — list all variables with values
- [x] `dx var delete KEY --scope <scope>` — remove a variable
- [x] `dx secret set KEY=value --scope <scope>` — store an encrypted secret (write-only after creation)
- [x] `dx secret list --scope <scope>` — list secret keys with masked values and metadata
- [x] `dx secret delete KEY --scope <scope>` — remove a secret
- [x] `dx env --scope <scope>` — generate combined `.env` from vars + secrets to stdout
- [x] `dx env --scope <scope> | docker compose --env-file /dev/stdin up -d` — pipe into docker compose
- [ ] Secret injection into `dx ci run` (replaces `--secret` flag with automatic lookup)
- [ ] Audit log: track who set/read/deleted each secret and when
- [x] Secret rotation support: `dx secret rotate KEY --scope <scope>` (set new value, restart dependent services)
- [x] Environment inheritance: `production` inherits from `all`, with per-env overrides

### Phase 10 — Follow-up / Polish

- [x] Consolidate `getFactoryClient` — extracted to `cli/src/handlers/factory-fetch.ts`, shared across secret/var/env-scope handlers
- [x] Atomic upsert for config var — switched to `onConflictDoUpdate` on the unique index
- [x] Align scope models — both config vars and secrets now use `org/team/project/principal/system` scope types (v2 schema)
- [x] Wire v2 secret table — secret controller now uses v2 `org.secret` table with `keyVersion`, `slug`, `name`, `spec` columns, atomic upserts, and aligned scope model
- [x] Add `project` scope type — full inheritance: `system(0) < org(1) < team(2) < project(3) < principal(4)` with env +10 bonus
- [x] Shared scope utilities — extracted `scope-models.ts` with `ScopeQuery`, `ResolveBody`, `scopeCondition`, `mergeWithScopePriority`
- [x] Pagination on list endpoints — `limit`/`offset` query params (default 200, max 1000)
- [x] Transactional rotation — `POST /secrets/rotate` loop wrapped in `db.transaction()`
- [x] API-level input validation for `scopeType` — validate before DB, return 400 instead of relying on check constraint (500)
- [ ] Rate limiting on resolve endpoints — unbounded SELECTs across multiple scope levels
- [ ] **`dx secret set` / `dx var set` flags for `system`, `site`, `deployment` scopes** — `cli/src/handlers/secret.ts:41-52` + `var.ts` equivalent only wire `--team` and `--project` to `scopeId` (scopeType auto-infers from whichever flag is used). `--scope system/site/deployment` sets scopeType but leaves `scopeId="default"`. Add `--system <slug>`, `--site <slug>`, `--deployment <slug>` flags + inference in `buildScopeParams`. API already supports these (scope-models.ts enum). Unblocks system-scope credential storage for trafficure-core (currently stored at org/default as a workaround).
- [x] Tests for Phase 10 — crypto key versioning (13 tests), config var + secret controller (18 tests)
- [x] `localVarList` should return values — returns `{ key, value }` pairs, list output shows `key=value`
- [x] Auto-infer `--scope` from `--team`/`--project` flags — `buildScopeParams` now infers scopeType from flag used

---

## Schema V2 — Follow-up Work

### Completed (2026-04-06)

- [x] Remove `"sandbox"` from `RouteTypeSchema` (shared/src/schemas/infra.ts)
- [x] Fix `RouteSpecSchema` — replace aspirational multi-target schema with flat fields matching actual `createRoute()` usage, keep optional `targets` for route resolver
- [x] Deprecate dead v1 types: `Sandbox`, `SandboxTemplate`, `SandboxSnapshot`, `SandboxAccess`, `Cluster` in shared/src/types.ts
- [x] Fix CLI type errors from v1→v2 migration: customer.ts (`slugOrId`), entitlement.ts (subscriptions v2 path), plan.ts (cast), repo-context.ts (type narrowing), port-manager.test.ts
- [x] Remove dead v1 types from shared/src/types.ts: Sandbox*, Cluster*, ClusterStatus (zero imports confirmed)
- [x] Remove `createSandboxRoutes` backward compat alias in gateway.service.ts

### Spec-to-Column Migration (service layer)

- [ ] Update service code to read promoted columns directly instead of `spec.*` for: identityLink.externalId, sshKey.fingerprint, job.status/mode/trigger, memory.layer/status/sourceAgentId, agent.status, toolUsage.tool/costMicrodollars, webhookEvent.gitHostProviderId/deliveryId, gitRepoSync.externalRepoId, gitUserSync.externalUserId, workItem.status/externalId/assignee, pipelineRun.status/commitSha, systemVersion.version, tunnel.subdomain/phase, dnsDomain.fqdn, ipAddress.address, route.domain, preview.phase/sourceBranch/prNumber
- [ ] Backfill migration script: copy existing spec values to new columns for rows created before the migration
- [ ] Entity relationship graph API: query `software.entity_relationship` for dependency graphs, impact analysis, ownership views

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

### Factory Web App — Unified Platform UI

- [~] `factory.threads` module — thread viewer with plan drawer, context panel, turn cards (implemented, needs unified app embedding)
- [~] `factory.build` module — repos, systems, components list pages (implemented, missing detail pages)
- [~] `factory.infra` — estates + realms pages (implemented), host detail page (implemented)
- [~] Data transformer fixes — all ops/infra hooks now extract `spec.*` fields and `status.phase` from ontology API responses
- [~] `DashboardPage` shared layout component — standardizes header/toolbar/scroll pattern across all list pages
- [ ] System detail page (`/build/systems/:slug`) — tabbed: Overview, Components, Deployments, Versions, Dependency Graph
- [ ] System dependency graph tab — React Flow visualization of component-to-component dependencies with different edge types (dependency vs connection), auto-layout. Reference: `dx catalog tree` output
- [ ] Component detail page (`/build/components/:slug`) — show parent system, deployments, versions, API surface
- [ ] Repo detail page (`/build/repos/:slug`) — show systems it contains, branches, last sync, pipeline runs
- [ ] Site detail page improvements — wire deployment targets to real data, add env tab from site controller API
- [ ] Unified app embedding — build Vinxi app with `nitro: { preset: "bun" }`, import handler in CLI's dev console server, replace static HTML serving
- [ ] IDE channel slug naming — derive from git repo origin + branch (e.g. `github.com/user/repo:branch`) instead of folder directory path, for cross-machine uniqueness
- [ ] Cross-entity linking — every detail page links outward: sites→systems→components→repos, hosts→sites, clusters→sites, realms→hosts
- [ ] Sortable columns + copy-on-hover — generalize the hosts page pattern (SortHeader, CopyCell components) into shared components for all table views
- [ ] Mobile responsive — thread list collapses, context panel becomes bottom sheet, PWA manifest
- [ ] Message/Exchange/ToolCall API endpoints — `GET /threads/:id/messages`, `GET /threads/:id/exchanges`, `GET /threads/:id/tool-calls` for the new interaction model

### Plans — Capture, Surfacing, Replay

- [x] `GET /threads/:slugOrId/plans` — returns authored plans (where `document.thread_id = :id`) UNION plans referenced by Read/Edit/Bash/Grep tool inputs in the thread
- [x] Inline plan viewer in `/plans` page (split layout: list + content), drawer mode preserved for narrow viewports
- [x] Markdown syntax highlighting via `rehype-highlight` (github-dark) for plan + chat code blocks
- [x] Auto-select channel from thread URL — backfill `?channel=` from `thread.channelId` when only `?thread=` is present
- [ ] Backfill `thread_id` on the 580 legacy null-thread plan documents — scan turns for plan-path references and back-populate the originating thread (lossy: pick first/most-recent referencing thread)
- [ ] Raise `toolInput` 2048-char truncation cap in `handleToolPost` — currently lossy for full session replay; design a separate fields/storage if too large for thread_turn.spec
- [ ] Show `authored` vs `referenced` badge on plan rows in context panel + `/plans` page (data already returned by endpoint)
- [ ] Plan grep/search across content — full-text index over `document_version.contentText`
- [ ] Plan version diffs — render side-by-side comparison between two `document_version` rows with highlighted edits
- [ ] Cross-thread "where else was this plan referenced" — reverse lookup from a plan slug to the list of threads that read/wrote it

### Data Model — Message-First Interaction Model

- [x] `message`, `exchange`, `tool_call` tables + migration (org schema)
- [x] `sourceMessageId` + `sourceToolCallId` FK columns on `document_version`
- [x] Zod spec types for Message, Exchange, ToolCall in shared schemas
- [ ] Ingestion adapter — write messages + tool_calls on IDE hook ingestion (alongside existing thread_turn writes)
- [ ] Exchange derivation — classifier that watches message stream and materializes exchange rows
- [ ] `thread_turn` backward-compat view — SQL view over message content blocks
- [ ] Shared ingestion library — unified `classifyPlanPath`, artifact extractors usable by both CLI hooks and API scanner

- [ ] Scout prompt input — file actions not implemented (`ui/src/modules/smart-market.scouts/.../scout-prompt-input.tsx`)

---

## Fleet / Workspace Runtime

- [ ] **Workspace auto-assign runtime: throw vs silent** — `createWorkspace()` throws if no runtime is registered. Consider whether workspace creation should succeed with `runtimeId = null` and let the reconciler retry when a runtime becomes available (more resilient for bootstrapping scenarios where runtime registration happens after workspace creation).
- [ ] **Remove `FleetPlaneService` dead code** — `api/src/modules/fleet/plane.service.ts` defines `FleetPlaneService` which is never instantiated. Delete it along with its imports.
- [ ] **Remove legacy sandbox adapter infrastructure** — `SandboxAdapter`, `NoopSandboxAdapter`, and the adapter registry are no longer used by workspace creation or TTL cleanup. The snapshot service still uses adapter for `snapshot()` operations. Audit and remove what's unused.

---

## `dx scan` — Infrastructure Host Scanning

### Implemented (this session)

- [x] Shared schemas: `HostScanResultSchema`, scan wire format types, new runtime types (`iis`, `windows-service`, `process`)
- [x] DB migration: runtime type CHECK constraint includes new types
- [x] API scan reconciler: upserts Systems/Runtimes/Components from scan results, decommissions missing
- [x] API host scan action endpoint (`POST /infra/hosts/:slug/scan`)
- [x] CLI collectors: Linux (bash), Windows (PowerShell), local dispatch, remote SSH
- [x] CLI `--scanner ide|infra|all` flag, target argument for host slugs
- [x] CLI output formatting for infra scan results + reconciliation summary

### Follow-ups

- [ ] macOS-specific collector — local scan routes macOS to Linux bash script which partially works (`ss` and `systemctl` don't exist on macOS). Add macOS collector using `lsof -iTCP -sTCP:LISTEN` for ports and `launchctl` for services
- [ ] `jq` fallback in Linux collector — python3 is a soft dependency for compose/systemd JSON parsing; add `jq`-based fallback for minimal environments without python3
- [ ] Python3 availability collector status — emit a collector status entry when python3 is missing so users understand why compose/systemd data is empty
- [ ] Scan reconciler unit tests — cover: basic create, idempotent re-scan, decommission of disappeared services, re-activation of decommissioned services
- [ ] OS detection for remote hosts — currently defaults to linux; should read `spec.os` from the host entity in Factory rather than `(entity as any).os`
- [ ] Scheduled/periodic scanning — cron or timer-based re-scan to keep infrastructure digital twin current
- [ ] Scan diff/changelog — show what changed between consecutive scans on the same host (new services, removed services, port changes)
- [ ] Network topology from scan data — use port/service data across multiple hosts to infer service-to-service communication links

---

## Operations / Tunnel

- [x] **Remaining operations plan: Steps 5-7** — Log Pipeline (Loki + OTel + adapter), CLI `dx factory logs`, Edge Deployment + Cloud Smoke Test. Done: Loki adapter with WebSocket streaming, `/logs` + `/logs/stream` SSE endpoints, `dx factory logs` with `--follow`, OTel filelog receiver, enriched webhook/request log messages.
- [x] **Tunnel: disable auto-decompression** — Done: uses `decompress: false` on fetch to preserve original compressed bytes through the tunnel. (c95c74d)
- [ ] **Production deploy pipeline** — Currently manual (`git push` → SSH pull → `docker compose build` → `docker compose up -d`). Automate with a `dx factory deploy` command or CI-triggered deploy.
- [ ] **`dx factory logs` level filtering** — `--level warn` flag exists in CLI but Loki adapter's `level >= N` filter depends on Pino numeric levels being extracted as labels. Verify end-to-end and add tests.
- [ ] **`dx factory logs` grep/sandbox filtering** — `--grep` and `--sandbox` flags exist but need end-to-end verification with Loki label-based filtering.
- [x] **Slack sync fails under Bun runtime** — Fixed: replaced `@slack/web-api` SDK with direct curl subprocess calls (`slack-client.ts`). Bun's fetch AND node:https polyfill both drop sockets; curl bypasses Bun's networking entirely.
- [ ] **Remove `@slack/web-api` dependency** — No longer imported anywhere in `api/src/`. Can be removed from `api/package.json` to reduce install size. Verify no other packages depend on it first.
- [ ] **Validation error on `POST /api/v1/factory/infra/hosts/:slug/update`** — Recurring error: `spec.hostname` required but undefined. Investigate caller sending incomplete payloads.

---

## DNS/IP Graph Follow-ups (2026-04-11)

- [ ] Add NAT/firewall network-link ingestion from gateway device APIs (e.g. Gajshield) so traces include middle hops without manual CRUD.
- [ ] Add endpoint abstraction service: compute "how to reach this entity" from graph + access metadata for CLI/API consumers.
- [ ] Add VIP/floating-IP lifecycle workflows (create/assign/reassign) on top of existing `ip_address` model support.
- [ ] Add DNS record write-back (create/update/delete) from Factory to providers after sync/read model is stable.
- [ ] Add non-Cloudflare DNS provider sync adapters (Route53 first, then generic provider abstraction).
- [ ] Fix `gateway-service` full-suite test fixture mismatch with current `system_deployment` schema (`workbench_id` insert failure) so full test run is green.
- [ ] Fix `infra-controller` host→realm relation test (`GET /hosts/:id/realms` returning empty) by aligning relation wiring or test setup with current v2 model.

---

## DX Observability Commands

### Implemented (this session)

- [x] `dx logs <url>` — resolve URL via trace pipeline, SSH to host, stream container logs
- [x] `dx inspect <url|slug>` — show component details (host, ports, image, URL, compose project)
- [x] `dx health <url|slug>` — end-to-end timing (DNS/TCP/TLS/TTFB), TLS cert expiry, optional per-hop probes
- [x] `trace-resolver.ts` — shared URL→component resolution via trace API
- [x] `LogSource` interface with `SshLogSource` (SSH docker logs) and `LocalLogSource` (local docker compose) implementations
- [x] `@internal` service detection in `dx logs` — warns user with actionable message

### Follow-ups

- [ ] `dx inspect` — populate `Service` and `Compose` fields from component metadata (currently show "—" for crawled-host components)
- [ ] `dx logs <service-name>` outside site context — require `--host` flag, resolve service on that host
- [ ] `dx logs` Loki backend — swap `SshLogSource` for a `LokiLogSource` when centralized logging is available
- [ ] `dx health --verbose` per-hop probes for service-slug targets (currently only URL targets get per-hop)
- [ ] `dx dns <domain>` — quick DNS record dump (A, CNAME, TXT, MX) with provider info from catalog

---

## dx CLI follow-ups

- [ ] **Component-level depEnv resolution for native processes** — `resolveDepEnvForNative()` in `native.ts` resolves `dx.dep.*.env.*` templates against localhost + published ports. Works but untested end-to-end because Docker auto-starts `infra-factory` (see next item). Env resolution logic verified correct via unit test.

- [ ] **Fix Docker auto-starting dev-target containers** — `docker compose up -d` for infra deps causes Docker to auto-create/start `infra-factory` when its `depends_on` services become healthy, even with `--no-deps`. Root cause: `CompositeExecutor.executorFor()` defaults to compose when `getMode()` returns null (line 53 in `composite.ts`). Likely because `project.name` is `undefined` → `sdSlug` is undefined → SD slug mismatch. Fix: use `project.catalog.metadata.name` for sdSlug, or set `skipInfra: true` in prelude + explicit `compose.stop(targets)` after health wait.

- [ ] **Remove self-referencing `x-dx.dependencies` entry** — `docker-compose.yaml` still has `factory-core` depending on itself. Should be `dependencies: []` now that component-level `dx.dep.*.env.*` labels handle env resolution. The removal keeps getting reverted by deploy commits.

- [ ] **Separate Docker build from run in orchestrator** — `compose.up --build` builds ALL services with build contexts, not just the listed ones. Split into `compose.build(depsNeedingBuild)` then `compose.up({ noBuild: true })` so dev targets don't get built/started as Docker containers.

- [ ] **Prelude skipInfra for dx dev** — The prelude's infra step runs `compose.up()` on ALL services when `usingRemoteDeps` is false. For `dx dev`, the orchestrator manages Docker deps itself. Pass `skipInfra: true` from `dev.ts` to `runPrelude()`.

- [ ] **Named port selection in depEnv templates** — `resolveDepEnvForNative` picks `http` port first, then first available. For multi-port services (e.g., infra-factory has http:4100 + gateway-proxy:9090), templates can't target a specific named port. Consider `{port:gateway-proxy}` syntax.

- [ ] **Extract shared deps-install dispatcher** — `cli/src/lib/prelude.ts` and `cli/src/commands/sync.ts` both dispatch pnpm/bun/yarn/npm installs via an internal lockfile→command map. Extract to a shared primitive (`cli/src/lib/install-dispatcher.ts`) when a third caller appears or when they diverge. Leaving duplicated for now — premature extraction would lock an API before the second consumer's needs are settled.

- [ ] **Multi-system slice 6: Factory API endpoint discovery** — `cli/src/lib/linked-sd-resolver.ts` currently guesses the remote SD slug as `<site>-<system>`. That's brittle for sites whose SDs don't follow that convention. Replace with `GET /api/v1/sites/:slug/system-deployments/:sd/endpoints` so the authoritative slug + endpoints come from the reconciler's source of truth. Covered by slice 6 in `.claude/plans/vivid-prancing-lake.md`.

- [ ] **Dev-orchestrator integration test for linked SDs** — resolver has 9 unit tests; the `startDevSession` wiring is validated only by a one-off smoke on product-trafficure. Add an integration test that constructs a fake SiteManager + ProjectContext, calls `startDevSession` with `connectTo`, and asserts `site.systemDeployments` has the expected linked SDs. Would catch regressions when slice 6 extends the path.

- [ ] **Enforce slug safety at schema level** — `shared/src/dependency-graph.ts` uses `/` as separator for qualified multi-system IDs. Nothing in `shared/src/schemas/*` currently restricts slug charset (`z.string()` with only length bounds). Add a regex `/^[a-z0-9][a-z0-9-]*$/` to slug fields in `site-state.ts` / `software.ts` so qualified IDs can't collide with literal slug characters.

- [ ] **Windows-native dx installer (PowerShell)** — current install script is bash-only; `curl | bash` path works on Git Bash/WSL but not native PowerShell. Add `api/src/modules/install/windows.ts` serving `install.ps1` at `/api/v1/factory/install.ps1`, mirroring the bash installer: detect arch via `$env:PROCESSOR_ARCHITECTURE`, fetch `lepton-dx-windows-x64` tarball, extract to `%LOCALAPPDATA%\dx\bin`, add to PATH. CI for it is already stubbed in `.github/workflows/test-dx-install.yml` (windows job currently no-ops). Not urgent — all production VMs are Linux.

- [ ] **Native musl binaries for Alpine (optional follow-up)** — resolved for v1 by auto-installing `gcompat libstdc++ libgcc` on Alpine; the glibc binary runs fine under gcompat. A future native build (via `bun build --compile --target=bun-linux-x64-musl`) would shave the ~2MB gcompat shim but still requires `libstdc++`/`libgcc` at runtime, so the UX win is minimal. Path: either upstream `@crustjs/crust` musl targets, or a parallel `build:musl` script that directly invokes bun and post-processes `dist/npm/manifest.json` + `dist/npm/root/package.json` + resolver.

- [ ] **`dx source link` — detect broken symlinks at target** — `cli/src/handlers/source/link.ts` uses `existsSync(targetPath)` which follows symlinks and returns false for broken ones, then `symlinkSync` fails with EEXIST. Switch to `lstatSync(target, { throwIfNoEntry: false })` so a stale symlink (e.g. carried over from a Conductor workspace clone) yields a clear error instead of EEXIST. Reverted by linter once already; re-apply with intent encoded in a comment so the lstat usage isn't auto-replaced.

- [ ] **`dx source link` — automate pnpm.overrides for linked npm sources** — currently each link requires manually adding `"<pkg-name>": "link:./<path>"` to root `package.json#pnpm.overrides` and running `pnpm install`. Add a `cli/src/handlers/pkg/pnpm-overrides.ts` helper, read the package name from the linked source's `package.json`, store as `npm_name` in `.dx/packages.json`, and auto-add/remove the override in `integrateNpm` / `unintegrateNpm`. Avoid editing each dependent's `package.json`.

---

## Site Lifecycle & Remote Operations

### Completed (2026-04-19–20)

- [x] Spec/status split on site.json — `{spec: SiteSpec, status: LocalSiteStatus}`
- [x] SiteOrchestrator (renamed from DevOrchestrator) + mode-aware create (up/dev)
- [x] SiteBackend interface — LocalSiteBackend + RemoteSiteBackend (Factory API)
- [x] `--site` flag on `dx status` and `dx ps` for remote operations
- [x] `GET /api/v1/factory/ops/site-live/:slug` endpoint
- [x] Orphaned process cleanup on intent change
- [x] `dx stop`, `dx restart` commands + `dx down` lifecycle alignment
- [x] `dx status` spec vs reality delta with dead PID detection
- [x] Host-level port registry for multi-worktree dev
- [x] Centralized host dirs (`host-dirs.ts`) — XDG config/data/cache split
- [x] Partial site resolution — `x-dx.dependencies` + envMapping in docker-compose
- [x] Endpoint discovery — host IP + published ports from Factory API
- [x] Scan SSH user fix (factory-prod `accessUser` was `root`, should be `lepton`)

### Deferred

- [ ] **Remote write operations** — `dx restart/stop/down --site <slug>` need write methods on SiteBackend + API endpoints
- [ ] **`--site` flag on `dx logs`, `dx down`, `dx restart`** — natural candidates for remote operation
- [ ] **Deploy `feat/unified-site-agent` API to prod** — Drizzle migration error (`CREATE SCHEMA "public"` fails) blocks deployment. Likely `@workflow/world-postgres` compat issue with newer schema
- [ ] **Component `name` field in site-live API** — prod API doesn't return compose service name alongside DB slug. CLI uses prefix-stripping fallback. Deploy updated `site-state.service.ts`
- [ ] **Structured port mappings in scan reconciler** — collector sends `portMappings: [{container, host}]` but prod reconciler ignores them. Deploy updated `scan-reconciler.ts`
- [ ] **Port name label standard** — every published port should have `dx.port.*.name`. Add validation in `dx check`
- [ ] **`configDir("dx")` → `DX_CONFIG_DIR` migration** — 7 files still use `@crustjs/store`'s `configDir("dx")` instead of centralized `host-dirs.ts`. Same path on Linux, different on macOS
- [ ] **`@crustjs/core` subcommand `.meta()` bug** — `.meta().flags()` and `.meta().args()` don't work on subcommand callbacks. Only `.meta().run()` works. Framework needs fix
- [ ] **Docker stale port proxy on prod** — after `docker compose stop`, docker-proxy holds the port. Requires `fuser -k` or daemon restart. Investigate iptables cleanup
- [ ] **DB migrations in prelude** — run after infra healthy, before dev servers start
- [ ] **Source repo clone in prelude** — fetch `dx.sources` entries that haven't been cloned
- [ ] **Docker compose service rename** — `svc-api` → `infra-factory` done on `feat/unified-site-agent` but not on `effect-ts-adoption`. Need to reconcile and rename `init-postgres-bootstrap` too
- [ ] **oxfmt clears YAML block content** — oxfmt collapses `x-dx.dependencies` array to `[]` on format. Fixed by excluding `docker-compose.yaml` from oxfmt. Consider reporting upstream

- [ ] **Use relative symlinks for dx-managed packages** — `cli/src/handlers/source/link.ts` calls `symlinkSync(absolutePkgSource, targetPath)`. When Conductor clones a workspace, the absolute target preserves a path back at the original workspace, leaving stale links in the new clone. Switch to `relative(dirname(targetPath), pkgSource)` so the symlink resolves within whichever workspace it's currently in.

- [ ] **`dx sync` — heal stale dx-managed symlinks** — when a workspace is cloned (e.g. via Conductor), absolute symlinks under `packages/npm/*` point back at the original workspace. `dx sync` should detect dx-managed entries whose symlink target leaves the workspace root, and repoint them at the local `.dx/pkg-repos/<name>/<source_path>`.
