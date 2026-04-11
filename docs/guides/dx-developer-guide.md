# DX Developer Guide

For engineers and AI agents working in the Software Factory.

---

## Quick Start

```bash
dx auth login              # Sign in to the Factory
dx status                  # Check API health + git status
dx up                      # Start infrastructure (postgres, redis, etc.)
dx dev                     # Start dev servers with hot reload
```

That's it. You're developing.

---

## The Inner Loop — Stay Fast

The inner loop is the minute-to-minute cycle: code, test, debug, repeat. These commands keep you in flow.

### Start Your Environment

```bash
dx up                      # Bring up docker-compose stack (all services + infra)
dx dev                     # Start local dev servers (reads dx.dev.command labels)
dx dev api                 # Start only the API component
dx up infra                # Start only infrastructure resources
```

`dx up` reads your `docker-compose.yaml` (or `compose/` directory), allocates ports, generates `.dx/ports.env`, and brings everything up. `dx dev` runs a pre-flight sync (hooks, deps, codegen) then starts native dev servers for components that have a `dx.dev.command` label.

### Check Health

```bash
dx status                  # API reachable? Git clean? Services running?
```

Use this liberally. It's your "am I in a good state?" command. Run it before debugging anything.

### Database Workflows

```bash
dx db connect              # Open interactive psql/mysql shell
dx db query --sql "SELECT * FROM users LIMIT 5"   # Quick query
dx db migrate status       # Check pending migrations
dx db migrate up           # Apply migrations
dx db migrate down         # Rollback last migration
```

`dx db` reads connection info from your docker-compose resource definitions — no manual URL management.

### Debugging

```bash
dx logs api                # Tail container logs for the API
dx logs --follow           # Follow all container logs
```

### Running Tests

```bash
dx test                    # Run tests (auto-detects runner: vitest, jest, pytest, go test)
dx test api                # Run tests for a specific component
dx test --watch            # Watch mode
dx test --coverage         # With coverage
dx test --changed          # Only test changed files
dx test --integration      # Run integration tests
```

`dx test` uses the convention engine: it checks `package.json` scripts first, then auto-detects from config files (vitest.config.ts, jest.config.ts, pyproject.toml, etc.).

### Quality Checks

```bash
dx check                   # Run all checks: lint + typecheck + test + format
dx check lint              # Run linting only
dx check typecheck         # Run type checking only
dx check --fix             # Auto-fix lint and format issues
dx check --ci              # CI mode (exit code from conventions)
```

Individual commands are also available:

```bash
dx lint                    # Run auto-detected linter (eslint, biome, oxlint, ruff, golangci-lint)
dx lint --fix              # Auto-fix
dx typecheck               # Run auto-detected type checker (tsc, pyright, mypy)
dx format                  # Run auto-detected formatter (prettier, biome, ruff, gofmt)
dx format --check          # Check without writing
dx generate                # Run all detected code generators (prisma, drizzle, sqlc)
```

### Resetting State

```bash
dx down                    # Tear down the stack (data persists)
dx down --volumes          # Tear down + delete volumes (clean slate)
dx down --volumes && dx up # Full reset
```

---

## The Ship Loop — Get Code Merged

The ship loop is the hour-to-hour cycle: commit, push, review, deploy. Git commands are used directly — dx enforces conventions via git hooks.

### Commits

```bash
git commit -m "feat: add user search endpoint"
```

Git hooks (installed by dx in `.dx/hooks/`) automatically:

- **commit-msg**: validates conventional commit format
- **pre-commit**: runs `lint-staged`
- **pre-push**: runs `dx check`

No need for `dx commit` — just use `git commit`. If hooks aren't installed, run `dx sync` to set them up.

### Push and PR

```bash
git push                   # Pre-push hook runs dx check first
gh pr create               # Create a PR (use GitHub CLI directly)
```

### Build Verification

```bash
dx build                   # Build Docker images for all components
dx build api               # Build a specific component
```

### Schema Migrations

```bash
dx db migrate status       # What's pending?
dx db migrate up           # Apply pending migrations
dx db migrate down         # Rollback if something went wrong
```

### Release and Deploy

```bash
dx release create 2.4.0    # Create a release
dx release status <id>     # Check release status
dx deploy create --release <id> --target <id>  # Deploy to a target
dx deploy status <id>      # Check deployment status
```

---

## Project Setup and Maintenance

### Initialize a New Project

```bash
dx init my-product         # Interactive scaffold
dx sync                    # Sync hooks, deps, env, migrations
dx doctor                  # Diagnose environment issues
```

### Keep Your Environment Healthy

```bash
dx sync                    # Heal local state: hooks, deps, docker images, codegen, db
dx upgrade                 # Check for dx template updates
dx self-update             # Update dx binary itself
```

`dx sync` is called automatically by git hooks after merge/checkout and as a pre-flight step in `dx dev`.

---

## Understanding docker-compose.yaml + Labels

### Source of Truth

Your project has two source-of-truth files:

1. **`docker-compose.yaml`** (or `compose/` directory) — defines the project catalog: components, resources, and their relationships via labels
2. **`package.json#dx`** — project-level config: team, conventions, deploy settings

There is no separate `catalog.yaml`. The catalog is derived from docker-compose labels.

### How dx Classifies Services

- **Component**: A service with a `build:` block (it has source code to build). Or explicitly: `catalog.kind: Component`
- **Resource**: A service with just an `image:` like `postgres:16-alpine` (infrastructure). Or explicitly: `catalog.kind: Resource`

### Catalog Labels (`catalog.*`)

These describe what a service IS in the software catalog:

```yaml
labels:
  catalog.type: service # service, worker, website, library, database, cache, queue
  catalog.owner: platform-eng # Team that owns this component
  catalog.description: "User API"
  catalog.tags: "auth,api"
  catalog.lifecycle: production # experimental, development, production, deprecated

  # Port metadata
  catalog.port.8080.name: http
  catalog.port.8080.protocol: http

  # API declarations
  catalog.api.provides: "user-api"
  catalog.api.consumes: "auth-api"

  # Connection references
  catalog.connection.auth.module: auth
  catalog.connection.auth.component: auth-service
  catalog.connection.auth.env_var: AUTH_URL
```

### Development Labels (`dx.*`)

These tell dx how to develop, test, and build the component:

```yaml
labels:
  dx.runtime: node # node, java, python
  dx.dev.command: "pnpm dev" # Command to start dev server
  dx.dev.sync: "./src,./shared" # Paths to watch for hot reload
  dx.test: "pnpm test" # Test command
  dx.lint: "pnpm lint" # Lint command
```

### The `package.json#dx` Key

Project-level configuration lives in the root `package.json`:

```json
{
  "dx": {
    "version": "1.0.0",
    "type": "monorepo",
    "team": "platform-eng",
    "conventions": {
      "commits": "conventional",
      "branching": "trunk"
    },
    "deploy": {
      "preview": { "trigger": "pull-request", "ttl": "72h" },
      "production": { "trigger": "release-tag", "approval": true }
    }
  }
}
```

### The `.dx/` Directory

`.dx/` is for **runtime state and hooks**, not project definition:

```
.dx/
  hooks/                # Git hooks (committed, managed by dx)
    commit-msg          # Validates conventional commits
    pre-commit          # Runs lint-staged
    pre-push            # Runs dx check
    post-merge          # Runs dx sync --quiet
    post-checkout       # Runs dx sync --quiet
  ports.json            # Port allocation state
  config.json           # User config (factory URL, role)
  conventions.yaml      # Branch naming, quality rules
  ports.env             # Generated port env vars for compose
  dev/                  # Dev server state (gitignored)
  generated/            # Generated files
```

### Example: Full docker-compose.yaml

```yaml
services:
  api:
    build:
      context: ./services/api
    ports:
      - "8080:8080"
    labels:
      catalog.type: service
      catalog.owner: platform-eng
      dx.runtime: node
      dx.dev.command: "pnpm dev"
      dx.test: "pnpm test"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
    depends_on:
      postgres:
        condition: service_healthy

  worker:
    build:
      context: ./services/worker
    labels:
      catalog.type: worker
      catalog.owner: platform-eng

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

## Convention-Over-Configuration Engine

dx auto-detects your project's tools from config files. No manual configuration needed.

### What Gets Detected

| Category            | Tools Detected From                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Runtime**         | `package.json` (node), `pyproject.toml` (python), `go.mod` (go), `Cargo.toml` (rust), `pom.xml` (java)      |
| **Package manager** | `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`, `packageManager` field                     |
| **Test runner**     | `vitest.config.ts`, `jest.config.ts`, `pyproject.toml [tool.pytest]`, `go.mod`                              |
| **Linter**          | `eslint.config.js`, `biome.json`, `oxlint.config.*`, `.golangci-lint.yaml`, `pyproject.toml [tool.ruff]`    |
| **Formatter**       | `.prettierrc`, `biome.json`, `pyproject.toml [tool.ruff]`, `gofmt` (built-in)                               |
| **Type checker**    | `tsconfig.json`, `pyproject.toml [tool.pyright]`                                                            |
| **Migration tool**  | `drizzle.config.ts`, `prisma/schema.prisma`, `alembic.ini`                                                  |
| **Codegen**         | `drizzle-kit`, `prisma generate`, `openapi-typescript`, `graphql-codegen`, `sqlc`                           |
| **Framework**       | `next.config.*`, `vite.config.*`, `app.config.ts` (vinxi), `manage.py` (django), `pyproject.toml` (fastapi) |

### Resolution Order

1. **`package.json` scripts** — if a `test`, `lint`, or `format` script exists, it takes priority
2. **Config file detection** — auto-detect from config files present in the project
3. **Clear error** — if nothing found, dx tells you what to add

### Script Pass-Through

If you run `dx <name>` and `<name>` isn't a built-in command, dx falls back to `package.json#scripts`:

```bash
dx storybook               # Runs scripts.storybook from package.json
dx codegen                  # Runs scripts.codegen from package.json
```

---

## Git Hooks

dx uses `.dx/hooks/` with `core.hooksPath` (no symlinks, works on all platforms).

### Installed Hooks

| Hook            | What It Does                                                      |
| --------------- | ----------------------------------------------------------------- |
| `commit-msg`    | Validates conventional commit format via `dx git-hook commit-msg` |
| `pre-commit`    | Runs `lint-staged` via `dx git-hook pre-commit`                   |
| `pre-push`      | Runs `dx check` via `dx git-hook pre-push`                        |
| `post-merge`    | Runs `dx sync --quiet` to heal deps/hooks/env                     |
| `post-checkout` | Runs `dx sync --quiet` on branch switch                           |

### Managing Hooks

```bash
dx sync                    # Installs/updates hooks if needed
```

Hooks are POSIX sh scripts that delegate to `dx git-hook <name>`. They're committed to the repo so the whole team gets them.

To skip hooks in emergencies: `git commit --no-verify` (but the pre-push hook will still catch you).

---

## Anti-Patterns — You're Doing It Wrong If...

| What You're Doing                     | What To Do Instead  | Why                                                                         |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Running `docker compose up` directly  | `dx up`             | dx manages port allocation, generates `.dx/ports.env`, reads catalog labels |
| Running `npm run dev` / `bun run dev` | `dx dev`            | dx handles port allocation, env injection, pre-flight sync                  |
| Managing database URLs manually       | `dx db connect`     | dx reads connection info from compose resource definitions                  |
| Running migrations with raw SQL       | `dx db migrate`     | dx tracks migration state and supports rollback                             |
| Running `dx down` to reset            | `dx down --volumes` | Without `--volumes`, database data persists and you get stale state         |
| Debugging without checking status     | `dx status` first   | Tells you if services are running, API is healthy, git is clean             |
| Installing git hooks manually         | `dx sync`           | dx manages `.dx/hooks/` and `core.hooksPath` automatically                  |

---

## Global Flags

Every dx command supports these flags:

| Flag               | Description                   | When to Use                               |
| ------------------ | ----------------------------- | ----------------------------------------- |
| `--json` / `-j`    | Structured JSON output        | Agents should always use this for parsing |
| `--verbose` / `-v` | More detailed output          | Debugging dx itself                       |
| `--quiet` / `-q`   | Suppress non-essential output | CI/CD pipelines                           |
| `--debug`          | Show HTTP/API traces          | Debugging API calls                       |
| `--help` / `-h`    | Show command help             | Learning a new command                    |

---

## For AI Agents

- Always use `--json` when you need to parse dx output
- Use `dx status --json` to check environment health before taking action
- Use `dx db query --sql "..." --json` for database inspection
- Non-interactive: all commands work without TTY when flags are provided explicitly
- Agent skills: `dx agent skill sync` installs org-standard skills for your agent type
- Authentication: set `DX_TOKEN` environment variable for API access

---

## Authentication Tokens

The CLI uses two distinct tokens. Using the wrong one is a common source of 401 errors.

| Token                                  | Function                      | Audience                                          |
| -------------------------------------- | ----------------------------- | ------------------------------------------------- |
| **Auth service token** (opaque bearer) | Session token for Better Auth | Auth endpoints only (`/get-session`, `/sign-out`) |
| **Factory API token** (JWT)            | JWKS-validated JWT            | All `/api/v1/factory/*` endpoints                 |

**For CLI contributors:**

- `getAuthServiceToken()` from `session-token.ts` — returns the opaque bearer token. Use this **only** for auth service calls (login, logout, whoami, session validation).
- `getFactoryApiToken()` from `client.ts` — returns a valid JWT, auto-refreshing via the auth service if expired. Use this for **all Factory API calls**.

The JWT is refreshed automatically by calling `/get-session` with the bearer token. It has a short TTL and is cached in `~/.config/dx/session.json` alongside the bearer token.

**Never send the opaque bearer token to Factory API endpoints** — the API validates tokens via JWKS and will reject non-JWT tokens with "Invalid Compact JWS".

---

## Command Reference by Category

### Setup

`dx install` | `dx auth` | `dx self-update`

### Project Lifecycle

`dx init` | `dx upgrade` | `dx sync` | `dx doctor`

### Development

`dx dev` | `dx up` | `dx down` | `dx status` | `dx logs`

### Quality

`dx check` | `dx lint` | `dx typecheck` | `dx test` | `dx format` | `dx generate`

### Database

`dx db connect` | `dx db query` | `dx db migrate`

### Deploy

`dx env` | `dx deploy` | `dx release` | `dx secret` | `dx preview`

### Infrastructure

`dx tunnel` | `dx connect` | `dx infra` | `dx cluster` | `dx kube` | `dx workbench` | `dx site`

### Platform

`dx catalog` | `dx config` | `dx context` | `dx build` | `dx run` | `dx agent`

Run `dx --help` for the full list, or `dx <command> --help` for details on any command.
