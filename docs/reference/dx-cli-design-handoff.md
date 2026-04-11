# dx CLI — Design Handoff for Implementation

**Document type:** Architecture & implementation specification
**Audience:** Claude Code / AI coding agents implementing the dx CLI
**Status:** Design complete, ready for implementation
**Last updated:** 2026-04-03

---

## Table of Contents

1. [Philosophy & Core Principles](#1-philosophy--core-principles)
2. [Architecture](#2-architecture)
3. [Command Surface](#3-command-surface)
4. [Convention-Over-Configuration Engine](#4-convention-over-configuration-engine)
5. [The Two Source-of-Truth Files](#5-the-two-source-of-truth-files)
6. [Git Integration (Hooks, Not Wrappers)](#6-git-integration-hooks-not-wrappers)
7. [External Tool Composition](#7-external-tool-composition)
8. [Docker Compose Integration](#8-docker-compose-integration)
9. [Registry & Auth Management](#9-registry--auth-management)
10. [Cross-Platform Support](#10-cross-platform-support)
11. [Developer Environment Setup — `dx install`](#11-developer-environment-setup--dx-install)
12. [Project Scaffolding — `dx init`](#12-project-scaffolding--dx-init)
13. [Project Updates — `dx upgrade`](#13-project-updates--dx-upgrade)
14. [Environment Sync — `dx sync`](#14-environment-sync--dx-sync)
15. [Local Development — `dx dev`](#15-local-development--dx-dev)
16. [Quality Pipeline — `dx check`](#16-quality-pipeline--dx-check)
17. [Database Commands — `dx db`](#17-database-commands--dx-db)
18. [Deployment & Releases](#18-deployment--releases)
19. [Introspection & Diagnostics](#19-introspection--diagnostics)
20. [Agent-Native Design](#20-agent-native-design)
21. [File Tree Reference](#21-file-tree-reference)
22. [Anti-Patterns — What dx Must Never Do](#22-anti-patterns--what-dx-must-never-do)

---

## 1. Philosophy & Core Principles

### One-liner

**dx is the platform, git is git, hooks are the glue.**

### Core principles

1. **dx owns what only dx can own.** Local dev environment, quality gates, deployment pipeline, infrastructure management — these are specific to the Lepton platform. Everything else (version control, code hosting, PR workflow) already has best-in-class tools. Compose with them, don't compete.

2. **Convention over configuration.** dx has strong opinions and smart defaults. It auto-detects the right tool for every task (test runner, linter, migration tool). `package.json` scripts are the override mechanism when you need something non-standard. Most projects need zero overrides.

3. **One developer intent = one command.** `dx dev` starts everything. `dx check` validates everything. `dx release minor` ships to production. Decomposed commands exist for power users but never appear in the getting-started flow.

4. **Configure, don't wrap.** Instead of wrapping git/gh, dx configures them with the right defaults and enforces standards via hooks and branch protection rules. The developer uses tools they already know.

5. **The best developer tool is one you forget is there.** Magic means things just work — right Node version, formatted code, validated commits, auto-generated env vars, healthy infrastructure — without the developer setting any of it up.

6. **Agent-native from day one.** Every command that returns information supports `--json`. Config is readable from standard files. Agents don't need special integration — they use git (hooks enforce), read `docker-compose.yaml` + `package.json` (full project context), and call `dx` for platform operations.

### What dx is NOT

- dx is NOT a git wrapper. It never replaces `git commit`, `git push`, `git branch`, etc.
- dx is NOT a GitHub CLI replacement. It never replaces `gh pr create`, `gh pr merge`, etc.
- dx is NOT a Docker CLI replacement. Power-user Docker operations use `docker compose` directly.
- dx is NOT a package manager. It delegates to pnpm/npm/pip/go modules.

---

## 2. Architecture

### Runtime

```
dx (installer / binary wrapper)
├── embedded Bun runtime
├── dx core commands (TypeScript, runs on embedded Bun)
├── reads package.json for project tasks + dx config
├── reads docker-compose.yaml for services + infrastructure
└── delegates to system tools (git, gh, docker, etc.)
```

**Why Bun embedded in dx:**

- No chicken-and-egg: dx doesn't need Node installed to run. It carries its own runtime, then installs the right Node version for the project via fnm.
- Near-zero startup overhead for hooks, scripts, task running.
- dx core is TypeScript running on embedded Bun. Project-specific scripts execute via `bun run`.

**Install mechanism:**

```bash
# Linux/macOS
curl -fsSL https://get.dx.rio.software | sh

# Windows (PowerShell)
irm https://get.dx.rio.software | iex
```

The install script detects platform and drops the right binary.

### Composition model

```
Developer (or AI Agent)
    │
    ├── git              ← they already know this, use it directly
    │     │
    │     └── git hooks  ← dx installs these, enforces conventions silently
    │
    ├── gh               ← GitHub CLI for PRs, reviews, repo operations
    │
    ├── docker compose   ← power-user escape hatch for advanced Docker ops
    │
    └── dx               ← owns everything that ISN'T code history or code hosting
          ├── local dev environment (dx dev)
          ├── quality gates (dx check, dx test, dx lint)
          ├── database operations (dx db)
          ├── deployment pipeline (dx release, dx deploy)
          ├── environment/auth management (dx auth, dx env)
          ├── project lifecycle (dx init, dx upgrade, dx sync)
          └── diagnostics (dx doctor, dx status, dx config)
```

---

## 3. Command Surface

### Built-in commands (always available, not delegated to package.json)

```bash
# === Setup (once per machine) ===
dx install                      # full workbench setup: git config, ssh, docker, editor defaults, gh, fnm
dx auth login                   # authenticate with Factory + configure all registry credential helpers
dx auth ci                      # configure credential helpers for CI context (non-interactive)
dx self-update                  # update the dx binary itself

# === Project lifecycle ===
dx init <name>                  # scaffold + repo + hooks + editor config + first push
dx upgrade                      # adopt latest dx template conventions (interactive diff/merge)
dx upgrade --check              # report available upgrades without modifying (for CI)
dx sync                         # heal local state: hooks, deps, env, migrations (usually automatic via hooks)
dx doctor                       # diagnose environment problems

# === Local development ===
dx dev                          # orchestrate: docker compose up + migrations + codegen + app dev servers
dx dev stop                     # tear down everything
dx dev --with <profile>         # also start optional service groups (e.g., observability)
dx status                       # what's running, what's healthy, what's deployed
dx logs [service]               # tail logs (thin passthrough to docker compose logs)

# === Quality (called by hooks automatically, also runnable directly) ===
dx check                        # full quality pipeline: parallel(lint, typecheck, test --changed)
dx lint [--fix]                 # auto-detected or overridden via package.json
dx typecheck                    # auto-detected or overridden
dx test [--watch|--changed|--integration|--e2e|--coverage|--all]
dx format                       # auto-detected formatter

# === Database ===
dx db connect [--target env]    # auto-detect DB service, launch client, handle tunneling
dx db query "SQL" [--target env]  # run query, format output
dx db migrate [--status|--down|--create NAME|--target env]
dx db seed                      # auto-detected or overridden
dx db studio                    # launch DB browser UI

# === Codegen ===
dx generate                     # run all detected generators (prisma, openapi, sqlc, graphql)

# === Environments & Deploy ===
dx env list
dx env status [preview|staging|prod]
dx env logs [env]
dx deploy preview               # force-trigger preview (normally automatic on PR via CI)
dx deploy prod                  # deploy to production (requires release tag)
dx release [major|minor|patch]  # auto-increment version, tag, gh release, trigger deploy

# === Secrets ===
dx secret list
dx secret get <KEY> --target <env>
dx secret set <KEY> --target <env>   # opens $EDITOR, never takes value as argument

# === Infrastructure ===
dx tunnel <port>                # expose local port publicly
dx connect <env>                # tunnel to remote environment

# === Hooks (called by git hooks, not by developers directly) ===
dx hook commit-msg <file>       # validate commit message convention
dx hook pre-commit              # run lint-staged
dx hook pre-push                # run dx check

# === Introspection ===
dx config                       # show all detected tools, overrides, and pipeline
dx config get [key]             # query specific config (reads package.json dx key)
dx config --json                # structured output for agents
```

### Commands that are script pass-throughs

Any `dx <name>` that isn't a built-in command looks up `scripts.<name>` in `package.json`. Colon-separated script names map to flags:

```
package.json script       dx command
─────────────────────────────────────
test                      dx test
test:watch                dx test --watch
test:e2e                  dx test --e2e
test:integration          dx test --integration
db:migrate                dx db migrate
db:migrate:status         dx db migrate --status
db:seed                   dx db seed
build                     dx build
dev                       (override for step 4 of dx dev only)
```

If a script doesn't exist AND auto-detection fails:

```
$ dx foo
  No script "foo" found in package.json.
  Available: dev, test, lint, typecheck, check, build, db:migrate, ...
```

### Commands that DO NOT EXIST in dx (use the real tool)

```bash
# Git — use git directly. Hooks enforce conventions.
git commit, git push, git pull, git branch, git rebase, git stash, etc.

# GitHub — use gh directly. dx init configures branch protection.
gh pr create, gh pr merge, gh pr checks, gh pr review, gh repo create

# Docker power-user operations — use docker compose directly
docker compose build, docker compose exec, docker compose run,
docker compose pull, docker compose ps
```

---

## 4. Convention-Over-Configuration Engine

### Resolution order for every command

```
1. Is there a matching script in package.json?
   YES → bun run <script> (developer override wins)
   NO  ↓

2. Auto-detect from project files and installed tools
   Found matching config/tool → run with sensible defaults
   Nothing found ↓

3. Report clearly: "No <tool> detected. Add a '<name>' script to package.json
   or install <suggested-tool>."
```

### Auto-detection matrix

| Command         | Detection signals                                       | Default execution                                         |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `dx test`       | `vitest.config.*`                                       | `vitest run`                                              |
|                 | `jest.config.*`                                         | `jest`                                                    |
|                 | `pytest.ini` / `conftest.py` / `pyproject.toml[pytest]` | `pytest`                                                  |
|                 | `go.mod` or `*_test.go`                                 | `go test ./...`                                           |
|                 | `build.gradle`                                          | `./gradlew test`                                          |
|                 | `Cargo.toml`                                            | `cargo test`                                              |
| `dx lint`       | `eslint.config.js` / `.eslintrc.*`                      | `eslint . --fix`                                          |
|                 | `biome.json`                                            | `biome check --fix`                                       |
|                 | `.golangci-lint.yaml`                                   | `golangci-lint run`                                       |
|                 | `ruff.toml` / `pyproject.toml[ruff]`                    | `ruff check . --fix`                                      |
|                 | `Cargo.toml`                                            | `cargo clippy`                                            |
| `dx typecheck`  | `tsconfig.json`                                         | `tsc --noEmit`                                            |
|                 | `pyproject.toml[pyright]`                               | `pyright`                                                 |
|                 | `pyproject.toml[mypy]`                                  | `mypy .`                                                  |
|                 | Go, Rust                                                | N/A (compiler handles this) — skip silently               |
| `dx format`     | `.prettierrc` / `prettier.config.*`                     | `prettier --write .`                                      |
|                 | `biome.json`                                            | `biome format --write`                                    |
|                 | `Cargo.toml`                                            | `cargo fmt`                                               |
|                 | `go.mod`                                                | `gofmt -w .`                                              |
|                 | `ruff.toml`                                             | `ruff format .`                                           |
| `dx build`      | `vite.config.*`                                         | `vite build`                                              |
|                 | `next.config.*`                                         | `next build`                                              |
|                 | `tsconfig.json` (no framework)                          | `tsc`                                                     |
|                 | `go.mod`                                                | `go build ./...`                                          |
|                 | `Cargo.toml`                                            | `cargo build --release`                                   |
|                 | `build.gradle`                                          | `./gradlew build`                                         |
|                 | `Dockerfile` (fallback)                                 | `docker compose build`                                    |
| `dx dev` (app)  | `vite.config.*`                                         | `vite`                                                    |
|                 | `next.config.*`                                         | `next dev`                                                |
|                 | `go.mod` + `air.toml`                                   | `air`                                                     |
|                 | `go.mod` (no air)                                       | `go run ./cmd/server`                                     |
|                 | `Cargo.toml`                                            | `cargo watch -x run`                                      |
|                 | `manage.py`                                             | `python manage.py runserver`                              |
|                 | uvicorn in deps                                         | `uvicorn app.main:app --reload`                           |
| `dx db migrate` | `prisma/schema.prisma`                                  | `prisma migrate deploy`                                   |
|                 | `migrations/` + golang-migrate                          | `migrate -path migrations -database $DATABASE_URL up`     |
|                 | `alembic.ini`                                           | `alembic upgrade head`                                    |
|                 | `knexfile.*`                                            | `knex migrate:latest`                                     |
|                 | `drizzle.config.*`                                      | `drizzle-kit migrate`                                     |
|                 | `manage.py` (Django)                                    | `python manage.py migrate`                                |
| `dx db connect` | docker-compose.yaml `image: postgres:*`                 | `psql` with auto-detected creds                           |
|                 | docker-compose.yaml `image: mysql:*`                    | `mysql` with auto-detected creds                          |
|                 | docker-compose.yaml `image: mongo:*`                    | `mongosh` with auto-detected creds                        |
| `dx db seed`    | `prisma/seed.ts`                                        | `tsx prisma/seed.ts`                                      |
|                 | `src/db/seed.ts`                                        | `tsx src/db/seed.ts`                                      |
|                 | `scripts/seed.*`                                        | `bun run scripts/seed.*`                                  |
| `dx generate`   | `prisma/schema.prisma`                                  | `prisma generate`                                         |
|                 | `api/openapi.yaml` + openapi-ts                         | `openapi-typescript api/openapi.yaml -o src/types/api.ts` |
|                 | `sqlc.yaml`                                             | `sqlc generate`                                           |
|                 | `graphql.config.*`                                      | `graphql-codegen`                                         |
|                 | Runs ALL detected generators in sequence                |                                                           |

### Variant flags

For commands with variants, the resolution tries the flag variant first, then falls back:

```
dx test --watch
  1. package.json scripts["test:watch"]?  → bun run test:watch
  2. Auto-detect base test runner, add --watch flag
     vitest → vitest (already watch by default without "run")
     jest → jest --watch
     pytest → pytest-watch
```

```
dx test --integration
  1. package.json scripts["test:integration"]?
  2. vitest → vitest -c vitest.integration.config.ts
     pytest → pytest -m integration
     go → go test -tags=integration ./...
```

```
dx test --changed
  dx computes affected files via git diff, passes to runner:
  vitest → vitest run --related <files>
  jest → jest --findRelatedTests <files>
  pytest → pytest <files>
  go → go test <packages containing changed files>
```

### Transparency — dx always says what it detected

```
$ dx test
  Detected: vitest (from vitest.config.ts)
  Running: vitest run
  ✓ 42 tests passed (1.3s)

$ dx test   # project with override
  Using: package.json → "test"
  Running: vitest run --pool=forks --reporter=verbose
  ✓ 42 tests passed (2.1s)

$ dx db migrate
  Database: postgres (from docker-compose.yaml → service "postgres")
  Migration tool: prisma (from prisma/schema.prisma)
  Running: prisma migrate deploy
  ✓ 3 migrations applied
```

First run shows detection. Subsequent runs can be quieter. `--verbose` always shows full reasoning. `--json` gives structured output.

---

## 5. The Two Source-of-Truth Files

### `package.json` — tasks, project metadata, dependencies

```jsonc
{
  "name": "@lepton/my-product",
  "private": true,
  "packageManager": "pnpm@9.1.0",
  "engines": { "node": ">=20" },

  // === dx reads this section ===
  "dx": {
    "version": "2.4.0", // dx template version (for dx upgrade)
    "type": "service", // service | frontend | library | monorepo
    "team": "platform",

    "conventions": {
      "commits": "conventional", // conventional | none
      "branching": "trunk", // trunk | gitflow
    },

    "deploy": {
      "preview": {
        "trigger": "pull-request",
        "ttl": "72h",
      },
      "production": {
        "trigger": "release-tag",
        "approval": true,
      },
    },
  },

  // === Scripts are OVERRIDES, not required ===
  // Most projects have zero scripts. dx auto-detects everything.
  // Add scripts only when you need non-standard behavior.
  "scripts": {
    // Example: custom test flags
    "test": "vitest run --pool=forks --reporter=verbose",
    // Example: custom migration tool
    "db:migrate": "custom-migration-tool apply --config migrations.yaml",
  },

  // === lint-staged config (used by pre-commit hook) ===
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml,yml}": ["prettier --write"],
  },

  "dependencies": {},
  "devDependencies": {
    "@lepton/eslint-config": "^2.0.0",
    "@lepton/prettier-config": "^1.0.0",
    "@lepton/tsconfig": "^1.0.0",
  },
}
```

For non-JS projects (Go, Python, Java), `package.json` serves as a pure task runner. Since dx embeds Bun, Node doesn't need to be installed:

```jsonc
// Go project — package.json as pure task runner
{
  "name": "@lepton/my-go-service",
  "private": true,
  "dx": {
    "version": "2.4.0",
    "type": "service",
    "runtime": "go",
  },
  "scripts": {
    // Only needed if auto-detection defaults aren't right
    "dev": "air -c .air.toml",
  },
}
```

### `docker-compose.yaml` — services, infrastructure

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: my-product
      POSTGRES_PASSWORD: localdev
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  ory-kratos:
    image: oryd/kratos:v1.3
    ports:
      - "4433:4433"
      - "4434:4434"
    volumes:
      - ./infra/kratos:/etc/config/kratos
    depends_on:
      postgres:
        condition: service_healthy

  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:localdev@postgres:5432/my-product
      REDIS_URL: redis://redis:6379
      AUTH_ISSUER: http://ory-kratos:4433
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src

  # Optional service groups via profiles
  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports:
      - "16686:16686"
      - "4318:4318"
    profiles:
      - observability

volumes:
  pgdata:
```

### Relationship between the two files

```
package.json          → "what can I do in this project" (tasks, metadata, deps)
docker-compose.yaml   → "what runs in this project" (services, infrastructure)
```

They are complementary, not overlapping. dx reads both.

---

## 6. Git Integration (Hooks, Not Wrappers)

### Critical design decision

**dx NEVER wraps git commands.** No `dx commit`, no `dx push`, no `dx ship`. The developer uses `git` directly. Standards are enforced via git hooks that delegate to `dx`.

### Hook installation mechanism

**Do NOT use symlinks** (broken on Windows without Developer Mode). Use `core.hooksPath`:

```bash
git config core.hooksPath .dx/hooks
```

This is set by `dx init` (for new projects) and `dx sync` (for cloned projects). Hooks live in `.dx/hooks/`, are checked into the repo, and go through code review like any other file.

### Hook scripts (POSIX sh, thin, cross-platform)

All hooks are thin POSIX sh that delegate to `dx hook <name>`. The actual logic runs in TypeScript on the embedded Bun inside the dx binary. This ensures cross-platform compatibility (Git for Windows ships a POSIX shell that invokes hooks).

**`.dx/hooks/commit-msg`:**

```sh
#!/bin/sh
exec dx hook commit-msg "$1"
```

**`.dx/hooks/pre-commit`:**

```sh
#!/bin/sh
exec dx hook pre-commit
```

**`.dx/hooks/pre-push`:**

```sh
#!/bin/sh
exec dx hook pre-push
```

**`.dx/hooks/post-merge`:**

```sh
#!/bin/sh
exec dx sync --quiet
```

**`.dx/hooks/post-checkout`:**

```sh
#!/bin/sh
exec dx sync --quiet
```

### Hook implementations (inside dx, TypeScript)

**`dx hook commit-msg <file>`:**

- Reads `dx.conventions.commits` from `package.json`
- If `conventional`: validates against pattern `^(feat|fix|chore|refactor|test|docs|perf|ci)(\(.+\))?: .{3,}`
- Clear error message on failure with expected format and types listed
- Exit 1 to block commit, exit 0 to allow

**`dx hook pre-commit`:**

- Runs `bunx lint-staged` (reads `lint-staged` config from `package.json`)
- Auto-formats only staged files, keeping commits fast

**`dx hook pre-push`:**

- Runs `dx check` (full quality pipeline)
- On failure: prints clear message and reminds developer of `git push --no-verify` escape hatch
- Agents don't know `--no-verify`, so they always go through the gates

**`dx hook post-merge` / `dx hook post-checkout`:**

- Runs `dx sync --quiet` to heal local state after branch changes

### Git commit template

`dx install` sets up a commit template globally:

```bash
git config --global commit.template ~/.dx/commit-template.txt
```

Template content:

```
# <type>: <description>
#
# Types: feat fix chore refactor test docs perf ci
# Example: feat: add user search endpoint
#
# Why is this change needed?

# Any context or trade-offs?

```

### Escape hatch

`--no-verify` on any git command bypasses all hooks. This is intentional — developers are adults. Document it, don't prevent it.

---

## 7. External Tool Composition

### Principle

dx composes with external tools rather than competing with them. `dx install` ensures they're installed and configured.

### Tool responsibility matrix

| Concern           | Tool             | dx's role                                                 |
| ----------------- | ---------------- | --------------------------------------------------------- |
| Commits           | `git`            | Hooks enforce conventions                                 |
| Branches          | `git`            | Hooks validate naming (if configured)                     |
| Push/pull         | `git`            | SSH multiplexing makes it fast (configured by dx install) |
| PRs               | `gh`             | dx init configures branch protection rules via gh API     |
| PR reviews        | `gh` / GitHub UI | Not dx's concern                                          |
| Repo creation     | `gh`             | dx init calls `gh repo create` internally                 |
| Release creation  | `dx release`     | dx tags + calls `gh release create` + triggers deploy     |
| Local dev         | `dx dev`         | dx's core value-add                                       |
| Deploy            | `dx deploy`      | dx's core value-add                                       |
| Quality gates     | `dx check`       | dx's core value-add                                       |
| Docker operations | `docker compose` | dx wraps high-level workflows, delegates plumbing         |

### What `dx init` configures via `gh` API (one-time)

```bash
# Repo settings
gh api repos/lepton/<name> -X PATCH \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true

# Branch protection
gh api repos/lepton/<name>/branches/main/protection -X PUT \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]="dx-check"
```

### Shell aliases (optional, configured by `dx install`)

```bash
alias gs='git status'
alias gc='git commit'
alias gp='git push'
alias gpr='gh pr create --fill'
alias gpm='gh pr merge --squash --delete-branch'
alias gl='git log --oneline --graph -20'
```

These are transparent aliases, not dx subcommands. No code to maintain.

---

## 8. Docker Compose Integration

### When dx wraps vs when developers use docker compose directly

**dx wraps (adds genuine value beyond docker compose):**

| dx command      | What it does                                                                   | Why not just docker compose                            |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `dx dev`        | Pre-flight checks + docker compose up + migrations + codegen + app dev servers | Orchestrates multiple steps in order with health gates |
| `dx dev stop`   | `docker compose down`                                                          | Consistency with `dx dev`                              |
| `dx dev reset`  | `docker compose down -v` + rebuild                                             | One command for "nuke everything"                      |
| `dx status`     | Docker state + dx metadata + health + env info                                 | Adds context docker compose ps doesn't have            |
| `dx logs [svc]` | `docker compose logs -f [svc]`                                                 | Shorter, consistent (thin passthrough)                 |
| `dx db connect` | Auto-detect DB service, creds, launch client, handle tunneling                 | Developer doesn't need to remember connection details  |
| `dx db migrate` | Auto-detect migration tool, ensure DB healthy, run                             | Abstracts over prisma/knex/alembic/golang-migrate      |
| `dx test`       | Reads config, runs right tool with right flags                                 | Abstracts over vitest/jest/pytest/go test              |

**Developers use docker compose directly (dx does NOT wrap):**

```bash
docker compose build          # power user
docker compose exec api sh    # power user
docker compose run api npm install  # power user
docker compose pull           # power user
docker compose ps             # use dx status instead, but this works too
```

### Smart infra/app split in `dx dev`

A common pattern is running infrastructure in Docker but the application natively on the host — because file watching through Docker volume mounts is slow on macOS and Windows.

dx dev reads docker-compose.yaml and auto-classifies:

- Services with only `image:` (no `build:`) → infrastructure → Docker
- Services with `build:` + a detected dev command → application → run natively with hot reload

For application services, `dx dev` starts the dev command natively on the host (e.g., `vite`, `tsx watch`, `air`) rather than inside a container. This makes hot reload 5-10x faster on macOS/Windows.

Override: If a `"dev"` script exists in `package.json`, `dx dev` uses it for step 4 (app dev servers) instead of auto-detection.

### Profiles for optional service groups

```bash
dx dev                          # core services only
dx dev --with observability     # also starts jaeger + prometheus
dx dev --with observability,mailhog  # multiple profiles
```

Maps directly to Docker Compose profiles.

---

## 9. Registry & Auth Management

### The problem

Multiple authenticated registries (GCP Artifact Registry, GitHub Container Registry, GitHub npm registry, private PyPI, etc.) each with their own auth mechanism, token format, and expiry behavior. Developers waste hours on "denied: Permission denied" errors.

### The solution: credential helpers, not static tokens

`dx auth login` configures credential helpers so tokens auto-refresh. Developers never manage tokens.

**Docker credential helpers:**

```json
// ~/.docker/config.json
{
  "credHelpers": {
    "asia-docker.pkg.dev": "gcloud",
    "us-docker.pkg.dev": "gcloud",
    "ghcr.io": "gh"
  }
}
```

Every `docker pull` from GCP AR automatically calls `gcloud` for a fresh token. Every pull from ghcr.io calls `gh`. No expiry, no manual refresh.

**npm private packages:**

```bash
# .npmrc at project root (checked in) — references env var, not actual token
@lepton:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`dx dev` injects `GITHUB_TOKEN` by calling `gh auth token` at startup.

**CI context (`dx auth ci`):**

Detects CI environment (env vars, no TTY), configures credential helpers using ambient CI credentials (workload identity, GITHUB_TOKEN, etc.) instead of interactive login.

### `dx doctor` verifies auth

```
Registry auth
  ✓ GCP Artifact Registry: pull test passed
  ✓ GitHub Container Registry: pull test passed
  ⚠ GitHub npm registry: token expires in 2 hours
    → Run: gh auth refresh
  ✓ Factory API: authenticated (token auto-refreshes)
```

`dx doctor` doesn't just check if credentials are configured — it actually tries a lightweight operation to verify they work right now.

---

## 10. Cross-Platform Support

### Supported platforms

- Linux (x86_64, arm64)
- macOS (Intel, Apple Silicon)
- Windows 10/11 (native + WSL2)

### Platform-specific concerns

| Concern           | Linux    | macOS                 | Windows                                |
| ----------------- | -------- | --------------------- | -------------------------------------- |
| Shell             | bash/zsh | zsh (default)         | PowerShell (+ Git Bash, + WSL)         |
| SSH ControlMaster | ✓ works  | ✓ works               | ✗ not supported                        |
| Symlinks          | ✓        | ✓                     | requires Developer Mode                |
| Docker perf       | native   | Docker Desktop (good) | Docker Desktop + WSL2 (path-dependent) |
| File watchers     | inotify  | FSEvents              | ReadDirectoryChanges                   |
| Line endings      | LF       | LF                    | CRLF (must be handled)                 |

### Critical cross-platform decisions

**Hooks path (not symlinks):**

Use `git config core.hooksPath .dx/hooks` instead of symlinking `.git/hooks/ → .dx/hooks/`. Symlinks require Developer Mode on Windows. `core.hooksPath` works everywhere.

**Hook scripts are POSIX sh:**

Git for Windows ships a POSIX shell (Git Bash / MSYS2). Hooks use `#!/bin/sh` and delegate to `dx hook <name>`. Keep hooks to 3 lines of portable sh. All logic runs in the dx binary (TypeScript on embedded Bun), which is cross-platform.

**Line endings — .gitattributes is non-negotiable:**

Every repo gets a `.gitattributes` (generated by `dx init`):

```
* text=auto eol=lf
*.sh text eol=lf
*.bash text eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
*.ps1 text eol=crlf
*.png binary
*.jpg binary
*.ico binary
*.woff2 binary
```

Plus git config:

```bash
# Linux/macOS
git config --global core.autocrlf input

# Windows
git config --global core.autocrlf true
```

**SSH on Windows:**

SSH `ControlMaster` doesn't work on Windows OpenSSH. `dx install` detects this and picks the faster auth path:

- If SSH key exists → configure ssh-agent auto-start
- If no SSH key → configure HTTPS + credential manager (faster on Windows)

**Docker filesystem performance on Windows:**

Projects on the Windows filesystem (`C:\Users\...` / `/mnt/c/...` from WSL) have 10-50x slower Docker volume mounts. `dx doctor` detects this and warns:

```
⚠ Project on Windows FS — recommend cloning inside WSL2 for performance
```

**System limits (Linux only):**

```bash
fs.inotify.max_user_watches=524288    # default 8192 too low for large projects
fs.inotify.max_user_instances=1024
```

macOS uses FSEvents (no limit issues). Windows uses ReadDirectoryChanges (no config needed).

---

## 11. Developer Environment Setup — `dx install`

### What it configures

`dx install` detects the platform and applies appropriate defaults. It follows this pattern:

1. Check what's already configured
2. Diff against recommended defaults
3. Show what it wants to change
4. Ask (or apply with `--yes`)
5. Backup originals to `~/.dx/backups/`

### Universal (all platforms)

**Git defaults:**

```bash
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global push.autoSetupRemote true    # git push just works on new branches
git config --global fetch.prune true
git config --global rerere.enabled true
git config --global commit.verbose true
git config --global diff.algorithm histogram
git config --global merge.conflictstyle zdiff3
git config --global commit.template ~/.dx/commit-template.txt
```

`push.autoSetupRemote` is critical — eliminates "no upstream branch" errors. After dx install, `git push` always works.

**gh CLI:** Install and authenticate.

**fnm + corepack:** For Node version management.

```bash
corepack enable    # respects packageManager field in package.json
```

**Docker daemon defaults:**

```json
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "features": { "buildkit": true },
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "20GB" } }
}
```

**Docker Compose env vars:**

```bash
export COMPOSE_DOCKER_CLI_BUILD=1
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain
```

**npm defaults (`~/.npmrc`):**

```
save-exact=true
engine-strict=true
fund=false
audit-level=high
loglevel=warn
prefer-offline=true
```

`save-exact=true` is critical — caret ranges cause "works on my machine."

**curl defaults (`~/.curlrc`):**

```
--connect-timeout 10
--max-time 300
--retry 3
--retry-delay 2
-L
```

**psql defaults (`~/.psqlrc`):**

```
\pset null '(null)'
\pset linestyle unicode
\pset border 2
\x auto
\timing on
\set HISTSIZE 10000
\set ON_ERROR_ROLLBACK interactive
```

### Linux-specific

**Shell history (bash/zsh):**

```bash
export HISTSIZE=100000
export HISTFILESIZE=200000
export HISTCONTROL=ignoreboth:erasedups
export HISTTIMEFORMAT='%F %T '
shopt -s histappend
```

**SSH ControlMaster:**

```
Host *
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
    ServerAliveInterval 60
    ServerAliveCountMax 3
    Compression yes
    AddKeysToAgent yes
```

Create socket directory: `mkdir -p ~/.ssh/sockets && chmod 700 ~/.ssh/sockets`

**System limits:**

```bash
# /etc/security/limits.d/dx-dev.conf (needs sudo)
*    soft    nofile    65536
*    hard    nofile    65536

# /etc/sysctl.d/dx-dev.conf (needs sudo)
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
vm.swappiness=10
```

**Shell navigation:**

```bash
shopt -s autocd cdspell    # bash
setopt AUTO_CD CORRECT     # zsh
```

### macOS-specific

**Shell:** zsh defaults, same history config adapted for zsh (`setopt SHARE_HISTORY` etc.)

**SSH ControlMaster:** Same as Linux.

**File descriptor limits:**

```bash
sudo launchctl limit maxfiles 65536 200000
```

**No inotify** (uses FSEvents, no limit issues).

### Windows-specific

**Git credential manager:**

```bash
git config --global credential.helper manager
```

**SSH agent:**

```powershell
Set-Service ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

**PowerShell history:**

```powershell
Set-PSReadLineOption -HistorySaveStyle SaveIncrementally
Set-PSReadLineOption -MaximumHistoryCount 10000
```

**Docker Desktop:** Check WSL2 backend is enabled. Warn if Hyper-V.

### Optional tool configuration

**tmux (`~/.tmux.conf`):**

```
set -g mouse on
set -g history-limit 50000
set -g default-terminal "tmux-256color"
set -g base-index 1
set -g renumber-windows on
set -g escape-time 0
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"
bind c new-window -c "#{pane_current_path}"
```

---

## 12. Project Scaffolding — `dx init`

### What `dx init <name>` does

1. **Scaffold project structure** based on type (service, frontend, library)
2. **Create GitHub repo** via `gh repo create lepton/<name> --private --clone`
3. **Configure branch protection** via gh API (squash merge only, require reviews, require CI)
4. **Generate all config files** (see File Tree Reference)
5. **Install git hooks** via `git config core.hooksPath .dx/hooks`
6. **Install dependencies** (`pnpm install` or equivalent)
7. **First commit + push**

### Files generated by `dx init`

See [File Tree Reference](#21-file-tree-reference) for the complete list.

### Non-JS project support

For Go, Python, Java projects: `dx init --type service --runtime go` generates appropriate config. `package.json` exists as a task runner (using embedded Bun). Language-specific config files replace JS-specific ones.

---

## 13. Project Updates — `dx upgrade`

### Three update layers

| Layer            | What updates             | How                                 | Frequency          |
| ---------------- | ------------------------ | ----------------------------------- | ------------------ |
| Shared packages  | lint/format/ts rules     | `pnpm update` (Renovate/Dependabot) | Weekly (automated) |
| Scaffolded files | hooks, CI, editor config | `dx upgrade` (interactive)          | Monthly (manual)   |
| dx binary        | CLI itself               | `dx self-update`                    | As released        |

### `dx upgrade` behavior

1. Reads `dx.version` from `package.json` (e.g., "2.1.0")
2. Compares scaffolded files against current template version
3. Files unmodified from original template → auto-update safely
4. Files team has customized → show diff, let developer choose: apply, skip, or merge
5. New files that didn't exist in old template → offer to add
6. Updates `dx.version` in `package.json`

### `dx upgrade --check` (for CI)

Exits 0 if up to date, exits 1 with summary if upgrades available. Doesn't modify anything. Shows as yellow warning in PRs.

### `dx self-update`

- Auto-update check runs in background once daily, prints one-liner on next invocation
- `dx self-update` does the actual binary update
- On Windows: uses rename-on-restart trick for exe replacement

---

## 14. Environment Sync — `dx sync`

### What it does

```bash
$ dx sync

  ✓ Hooks: core.hooksPath set to .dx/hooks
  ✓ Dependencies: pnpm install (lockfile changed)
  ✓ .env: regenerated (new var: ELASTIC_URL)
  ⚠ New service in docker-compose.yaml: elasticsearch
    → Run: docker compose pull elasticsearch
  ✓ Database: 2 pending migrations (will run on next dx dev)
  ✓ Codegen: openapi types regenerated (spec changed)
```

### When it runs

- **Automatically** via `post-merge` and `post-checkout` hooks (after `git pull`, `git checkout`)
- **Manually** via `dx sync` when needed
- **During** `dx dev` startup

### What it checks/fixes

1. `core.hooksPath` is set correctly
2. Dependencies match lockfile (installs if not)
3. `.env` is regenerated from config + secrets
4. Docker images are pulled for new services
5. Codegen is re-run if input files changed
6. Migration status is checked (reported, not auto-run — `dx dev` runs them)

---

## 15. Local Development — `dx dev`

### Startup sequence

```
dx dev
  │
  ├─ 1. Pre-flight checks
  │     ✓ Docker running?
  │     ✓ Required ports available? (check ALL ports before starting anything)
  │     ✓ .env up to date?
  │     → If port conflict: identify process, offer to kill
  │     → If Docker not running: clear error message
  │
  ├─ 2. Start infrastructure (Docker)
  │     docker compose up -d --wait
  │     (only infra services — those with image: and no build: context)
  │     → Wait for healthchecks to pass before proceeding
  │
  ├─ 3. Run migrations (if pending)
  │     dx db migrate (auto-detected tool)
  │
  ├─ 4. Run codegen (if stale)
  │     dx generate (auto-detected generators)
  │
  ├─ 5. Start app dev servers
  │     Option A: "dev" script in package.json → bun run dev
  │     Option B: auto-detect framework → run natively (NOT in Docker)
  │     → Start with debug port open (--inspect=9229 for Node)
  │
  └─ Ready. Interactive controls:
       Ctrl+C → stop
       'd' → dashboard
       'l' → log viewer
```

### Key behaviors

- **Idempotent.** If services already running, don't restart. Just attach.
- **All-or-nothing pre-flight.** Check every port before starting any service. Report all conflicts at once.
- **Health-gate infra before app.** Don't start the API until postgres is healthy.
- **Remember state.** Ctrl+C detaches but leaves services running in background. Re-running `dx dev` is instant. `dx dev stop` is the explicit teardown.
- **App runs natively, not in Docker.** For hot reload performance. Infra runs in Docker.

### `dx dev stop`

```bash
docker compose down    # stop all containers
# + kill any native dev server processes dx started
```

### `dx dev reset`

```bash
docker compose down -v    # stop + remove volumes (nuke data)
docker compose build --no-cache    # rebuild images
dx dev    # start fresh
```

### `dx dev --with <profile>`

Starts optional Docker Compose profiles (observability, mailhog, etc.).

---

## 16. Quality Pipeline — `dx check`

### Default behavior (no override)

```
dx check = parallel(dx lint, dx typecheck, dx test --changed)
```

Runs all three in parallel. Streams output. Fails if any fail. Skips steps that aren't applicable (e.g., no typecheck for Go projects). Minimum: at least one of lint/typecheck/test must be configured.

### Override

If a `"check"` script exists in `package.json`, it replaces the whole pipeline. Individual overrides (`"test"`, `"lint"`) still feed into `dx check`'s orchestration.

### Where dx check runs

1. **Pre-push hook** — automatically, on every push
2. **CI pipeline** — `dx check` in GitHub Actions
3. **Manually** — developer runs `dx check` before pushing

### Output

```
$ dx check

  ┌─ lint (eslint) ─────────────────────────
  │ ✓ 0 errors, 0 warnings (1.2s)
  ├─ typecheck (tsc) ───────────────────────
  │ ✓ No errors (2.1s)
  ├─ test (vitest, 12 changed) ─────────────
  │ ✓ 12 tests passed (0.8s)
  └─────────────────────────────────────────
  ✓ All checks passed (2.3s)
```

```json
// dx check --json
{
  "result": "pass",
  "duration_ms": 2300,
  "checks": {
    "lint": {
      "tool": "eslint",
      "source": "auto-detect",
      "result": "pass",
      "errors": 0
    },
    "typecheck": { "tool": "tsc", "source": "auto-detect", "result": "pass" },
    "test": {
      "tool": "vitest",
      "source": "auto-detect",
      "result": "pass",
      "passed": 12,
      "failed": 0
    }
  }
}
```

---

## 17. Database Commands — `dx db`

### All built-in, zero config needed

dx reads `docker-compose.yaml` to find the database service, reads the project to find the migration tool. No package.json scripts required (but can be overridden).

### `dx db connect [--target env]`

```
1. Find DB service in docker-compose.yaml (image: postgres:* | mysql:* | mongo:*)
2. Extract connection info from environment/ports
3. Launch client: postgres → psql, mysql → mysql, mongo → mongosh
4. If --target staging/prod: open tunnel automatically, connect, close tunnel on exit
5. If --target prod: default to read-only mode
```

### `dx db query "SQL" [--target env] [--json]`

Run ad-hoc queries, format as table (human) or JSON (agent).

### `dx db migrate [flags]`

```
dx db migrate                → apply pending (auto-detect tool)
dx db migrate --status       → show pending/applied
dx db migrate --create NAME  → create new migration
dx db migrate --down         → rollback last
dx db migrate --target staging → run against staging (with confirmation prompt)
```

### `dx db seed`

Auto-detected from project structure, or override via `"db:seed"` script.

### `dx db studio`

Launch a DB browser UI (Prisma Studio, or a built-in lightweight browser).

---

## 18. Deployment & Releases

### `dx release [major|minor|patch]`

This is the one command where dx composes git, gh, and the Factory API:

```bash
$ dx release minor

  Current version: v0.2.3
  New version: v0.3.0

  Changelog (from conventional commits since v0.2.3):
    feat: add search endpoint (#142)
    feat: user profile avatars (#138)
    fix: auth timeout on slow connections (#141)

  → Creating tag v0.3.0
  → Creating GitHub release via gh (gh release create v0.3.0 --generate-notes)
  → CI triggered: deploying to production

  Release v0.3.0 created.
  Deploy status: https://factory.rio.software/deploys/d_xxx
```

Under the hood: `git tag v0.3.0` + `git push --tags` + `gh release create v0.3.0 --generate-notes` + Factory API notification. CI picks up the tag and runs `dx deploy prod`.

### Preview deployments

Automatic on PR (CI workflow calls `dx deploy preview`). Manual force-trigger: `dx deploy preview`.

### `dx deploy prod`

Requires a release tag. Talks to Factory API. Shows deploy status and URL.

---

## 19. Introspection & Diagnostics

### `dx doctor`

Comprehensive environment health check. Platform-aware output.

```
$ dx doctor

  System
    ✓ OS: Ubuntu 24.04, x86_64
    ✓ File descriptors: 65536 (minimum: 10240)
    ✓ inotify watches: 524288 (minimum: 65536)
    ✓ Disk: 142GB free (minimum: 20GB)

  Git
    ✓ Version: 2.44.0 (minimum: 2.34)
    ✓ pull.rebase: true
    ✓ push.autoSetupRemote: true
    ✓ core.hooksPath: .dx/hooks
    ✓ SSH key: registered with GitHub

  Docker
    ✓ Version: 26.1.0 (minimum: 24.0)
    ✓ BuildKit: enabled
    ✓ Log rotation: configured
    ✓ Disk usage: 8.2GB (gc threshold: 20GB)

  Node
    ✓ Version: 20.12.0 (matches .node-version)
    ✓ pnpm: 9.1.0 (via corepack)
    ✓ save-exact: true

  Editor
    ✓ VS Code settings: present
    ✓ Extensions: 4/4 recommended installed
    ✓ Launch config: present

  Registry auth
    ✓ GCP Artifact Registry: pull test passed
    ✓ GitHub Container Registry: pull test passed
    ✓ GitHub npm registry: authenticated
    ✓ Factory API: authenticated

  Project template
    ✓ dx template: v2.4.0 (up to date)

  ⚠ 1 suggestion:
    tmux not installed — optional but recommended
```

### `dx status`

What's running right now:

```
$ dx status

  Services
    ✓ postgres    localhost:5432  healthy
    ✓ redis       localhost:6379  ready
    ✓ ory-kratos  localhost:4433  ready
    ✓ api         localhost:3000  watching (pid 42311)
    ✓ frontend    localhost:5173  watching (pid 42315)

  Environments
    preview   https://my-product-feat-xyz.preview.factory.rio.software  v0.2.3-preview.4
    prod      https://my-product.factory.rio.software                   v0.2.3
```

### `dx config`

What dx detects and how it will behave:

```
$ dx config

  Project: @lepton/my-product (service)
  Team: platform
  Template: v2.4.0

  Detected tools:
    runtime     node 20 (from .node-version)
    package     pnpm 9.1.0 (from packageManager)
    test        vitest (from vitest.config.ts)
    lint        eslint (from eslint.config.js)
    format      prettier (from .prettierrc)
    typecheck   tsc (from tsconfig.json)
    db          postgres (from docker-compose.yaml)
    migrations  prisma (from prisma/schema.prisma)
    codegen     prisma generate, openapi-typescript

  Overrides (from package.json scripts):
    (none)

  Quality pipeline (dx check):
    parallel:
      ├── eslint (auto-detected)
      ├── tsc --noEmit (auto-detected)
      └── vitest run --changed (auto-detected)
```

### Every introspection command supports `--json`

```json
// dx status --json
{
  "services": {
    "postgres": { "status": "running", "port": 5432, "health": "healthy" },
    "redis": { "status": "running", "port": 6379 },
    "api": {
      "status": "running",
      "port": 3000,
      "hot_reload": true,
      "pid": 42311
    },
    "frontend": {
      "status": "running",
      "port": 5173,
      "hot_reload": true,
      "pid": 42315
    }
  },
  "environments": {
    "preview": {
      "url": "https://...",
      "version": "v0.2.3-preview.4",
      "health": "ok"
    },
    "prod": { "url": "https://...", "version": "v0.2.3", "health": "ok" }
  }
}
```

---

## 20. Agent-Native Design

### How AI agents (Claude Code, Cursor, Copilot) interact with dx projects

**Context gathering:** Agent reads `docker-compose.yaml` + `package.json` + `.cursor/rules` + `.claude/settings.json`. One read, full project context.

**Code changes:** Agent uses `git` normally. Hooks enforce conventions automatically — agent doesn't need to know about dx's standards.

**Validation:** Agent calls `dx check --json` for structured pass/fail results.

**State queries:** Agent calls `dx status --json`, `dx config --json`, `dx env status --json` for structured project state.

**No special integration needed.** Agents already know git, can read JSON, can read YAML config files. The only dx-specific commands they might call are `dx dev`, `dx check`, `dx test`, `dx config`.

### Files that give agents context

**`.cursor/rules`:**

```markdown
This project uses the dx platform. Key context:

- docker-compose.yaml defines all services and infrastructure
- package.json dx key defines conventions, quality gates, and deploy rules
- Git hooks in .dx/hooks/ enforce conventions — use standard git commands
- Conventional commits required: feat|fix|chore|refactor|test|docs|perf|ci
- Run dx dev to start local environment, dx check to validate before pushing
- Run dx status --json for structured project state
```

**`.claude/settings.json`:**

```json
{
  "context": {
    "include": [
      "docker-compose.yaml",
      "package.json",
      ".dx/hooks/*",
      "docs/architecture.md"
    ]
  },
  "commands": {
    "check": "dx check --json",
    "status": "dx status --json",
    "test": "dx test --changed --json",
    "dev": "dx dev"
  }
}
```

### `--json` output contract

Every dx command that returns information supports `--json` with a consistent structure:

```json
{
  "command": "test",
  "source": "auto-detect", // or "package.json"
  "detected_from": "vitest.config.ts",
  "executed": "vitest run",
  "result": "pass", // "pass" | "fail" | "error"
  "summary": { "passed": 42, "failed": 0, "duration_ms": 1300 }
}
```

---

## 21. File Tree Reference

### Complete project structure after `dx init`

```
my-product/
├── package.json                     # tasks + dx config + deps (source of truth #1)
├── docker-compose.yaml              # services + infrastructure (source of truth #2)
├── .dx/
│   ├── hooks/                       # CHECKED IN — convention enforcement
│   │   ├── commit-msg               # → exec dx hook commit-msg "$1"
│   │   ├── pre-commit               # → exec dx hook pre-commit
│   │   ├── pre-push                 # → exec dx hook pre-push
│   │   ├── post-merge               # → exec dx sync --quiet
│   │   └── post-checkout            # → exec dx sync --quiet
│   ├── templates/                   # CHECKED IN
│   │   └── release-notes.md
│   └── local/                       # GITIGNORED — personal overrides
│       ├── overrides.yaml           # docker compose personal overrides
│       └── secrets.yaml             # local secrets
├── .vscode/
│   ├── settings.json                # CHECKED IN — format on save, eslint, etc.
│   ├── extensions.json              # CHECKED IN — recommended extensions
│   └── launch.json                  # CHECKED IN — debug configs (Node attach, Chrome, compound)
├── .cursor/
│   └── rules                        # CHECKED IN — AI agent context
├── .claude/
│   └── settings.json                # CHECKED IN — Claude Code context + commands
├── .github/
│   ├── pull_request_template.md     # CHECKED IN
│   └── workflows/
│       └── dx.yaml                  # CHECKED IN — CI pipeline (calls dx commands)
├── .gitattributes                   # CHECKED IN — line endings, binary detection
├── .editorconfig                    # CHECKED IN — indent, charset, whitespace
├── .npmrc                           # CHECKED IN — registry config (no tokens)
├── .node-version                    # CHECKED IN — Node version for fnm
├── .prettierrc                      # CHECKED IN — extends @lepton/prettier-config
├── eslint.config.js                 # CHECKED IN — extends @lepton/eslint-config
├── tsconfig.json                    # CHECKED IN — extends @lepton/tsconfig
├── api.http                         # CHECKED IN — API test file for VS Code REST Client
├── .gitignore
├── .env                             # GITIGNORED — generated by dx dev
├── src/
│   └── ...
└── infra/                           # CHECKED IN — service configs referenced by compose
    ├── kratos/
    └── ...
```

### What's checked in vs. gitignored

| Category                | Checked in? | Why                                        |
| ----------------------- | ----------- | ------------------------------------------ |
| `package.json`          | Yes         | Source of truth for tasks + metadata       |
| `docker-compose.yaml`   | Yes         | Source of truth for services               |
| `.dx/hooks/*`           | Yes         | Conventions are code, reviewed like code   |
| `.dx/templates/*`       | Yes         | Team templates                             |
| `.dx/local/`            | No          | Personal preferences and overrides         |
| `.vscode/`              | Yes         | Consistent editor experience               |
| `.cursor/rules`         | Yes         | Agent context                              |
| `.claude/settings.json` | Yes         | Agent context                              |
| `.github/`              | Yes         | CI and PR templates                        |
| `.gitattributes`        | Yes         | Cross-platform consistency                 |
| `.editorconfig`         | Yes         | Editor-agnostic formatting                 |
| `.npmrc`                | Yes         | Registry config (no tokens, uses env vars) |
| `.node-version`         | Yes         | Node version pinning                       |
| `eslint.config.js`      | Yes         | Extends shared config                      |
| `.prettierrc`           | Yes         | Extends shared config                      |
| `tsconfig.json`         | Yes         | Extends shared config                      |
| `.env`                  | No          | Generated by dx dev from config + secrets  |
| `node_modules/`         | No          | Installed from lockfile                    |
| `dist/`                 | No          | Build output                               |

### `.gitignore` template

```gitignore
# Dependencies
node_modules/

# Build output
dist/
build/

# dx local state
.dx/local/
.dx/cache/
.dx/state/

# Environment (generated by dx dev)
.env
.env.local

# Docker
docker-compose.override.yaml

# IDE (personal, not project settings)
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

---

## 22. Anti-Patterns — What dx Must Never Do

| Anti-pattern                                    | Why it's wrong                                                                             | What to do instead                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Wrap `git commit` as `dx commit`                | Fights developer muscle memory, zero agent training data, massive surface area to maintain | Enforce via `commit-msg` hook that calls `dx hook commit-msg`                       |
| Wrap `git push` as `dx push` or `dx ship`       | Same as above. `push.autoSetupRemote` eliminates the main pain point                       | Enforce via `pre-push` hook that calls `dx check`                                   |
| Wrap `gh pr create` as `dx pr create`           | GitHub CLI is better maintained, more feature-complete, agents know it                     | Configure branch protection and PR templates via `dx init`                          |
| Wrap `docker compose build/exec/run`            | Power-user operations that don't need dx context                                           | Let developers use `docker compose` directly                                        |
| Generate `docker-compose.yaml` on every run     | Developers customize it. Regenerating blows away changes                                   | Generate once at `dx init`, team owns it after that                                 |
| Generate CI workflow on every run               | Same — teams customize CI                                                                  | Generate once at `dx init`, team owns it                                            |
| Store dx config in a separate `.dx/config.yaml` | Creates sync problem with `package.json` and `docker-compose.yaml`                         | Use `package.json` `dx` key for metadata, `docker-compose.yaml` for services        |
| Require dx for basic git operations             | Creates dependency, breaks in CI environments without dx                                   | Hooks are the enforcement layer, git works without dx (just no conventions)         |
| Auto-update without asking                      | Developers hate tools that change under them                                               | Check in background, print one-liner, require explicit `dx self-update`             |
| Assume Unix-only                                | Team is on Windows, Linux, and macOS                                                       | Use `core.hooksPath` not symlinks, POSIX sh hooks, platform detection in dx install |
| Use static tokens for registries                | They expire, break silently, waste debugging hours                                         | Use credential helpers that auto-refresh                                            |
| Put secrets in `.env.example`                   | Developers copy it, forget to update, commit secrets                                       | Generate `.env` from config + `.dx/local/secrets.yaml` at `dx dev` time             |

---

## Appendix A: CI Pipeline Template

Generated by `dx init`, checked in, team-owned:

```yaml
# .github/workflows/dx.yaml
name: dx

on:
  pull_request:
    branches: [main]
  push:
    tags: ["v*"]

jobs:
  check:
    runs-on: self-hosted # Lepton Proxmox runners
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}
      - run: dx auth ci
      - run: dx check
      - run: dx deploy preview
        if: github.event_name == 'pull_request'

  deploy:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: check
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: dx auth ci
      - run: dx deploy prod
```

Because CI just calls `dx` commands, you can change what `dx check` or `dx deploy` does without touching the workflow file.

---

## Appendix B: Environment Variable Management

### How `.env` is generated

`dx dev` (and `dx sync`) generates `.env` from two sources:

1. **`docker-compose.yaml` service environment blocks** — non-secret defaults
2. **`.dx/local/secrets.yaml`** — local secrets (gitignored)

For secrets that can be auto-generated (JWT_SECRET, dev API keys), dx generates random values on first run. For secrets that require real values (STRIPE_KEY), dx prompts once and stores in `.dx/local/secrets.yaml`.

### Secret management for non-local environments

```bash
dx secret list                          # list secrets for this project
dx secret get STRIPE_KEY --target staging   # fetch from vault
dx secret set STRIPE_KEY --target staging   # opens $EDITOR (value never in shell history)
```

Backend: whatever vault the organization uses (HashiCorp Vault, AWS SSM, Infisical, etc.). dx provides the interface, the backend is pluggable.

---

## Appendix C: Developer Workflow Summary

### First time on a new project

```bash
git clone git@github.com:lepton/my-product.git
cd my-product
# post-checkout hook fires dx sync automatically:
#   ✓ Hooks configured
#   ✓ Dependencies installed
#   ✓ Docker images pulled
#   ✓ .env generated

dx dev
# Everything is running. Open editor, start coding.
```

### Daily loop

```bash
dx dev                          # start everything (or still running from yesterday)
# Code... hot reload handles the rest
git add -p                      # stage changes
git commit                      # template + hook validates
git push                        # pre-push hook runs dx check
                                # CI runs, preview auto-deploys on PR
gh pr create --fill             # open PR with template
# Review, iterate
gh pr merge --squash            # merge
dx release minor                # tag + deploy to production
```

### For AI agents (Claude Code, Cursor)

```bash
# Agent reads docker-compose.yaml + package.json for full context
# Agent uses git normally — hooks enforce standards
# Agent validates with dx check --json
# Agent queries state with dx status --json
# No special dx knowledge needed beyond: dx dev, dx check, dx config
```
