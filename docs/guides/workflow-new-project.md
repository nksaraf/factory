# Workflow: New Project — From Zero to Production URL

For engineers and AI agents starting a brand new project in the Software Factory.

**Goal:** Run one command, get a scaffolded project with CI/CD, git hooks, and quality tooling. Push a change, get a live preview URL. Merge to main, get a production URL.

---

## The Perfect Flow

```bash
# 1. Scaffold the project
dx init my-product --type project

# 2. Create a GitHub repo and push
cd my-product
gh repo create my-org/my-product --private
git remote add origin git@github.com:my-org/my-product.git
git push -u origin main

# 3. Start developing locally
dx up                              # Start postgres, redis, auth, gateway
dx dev                             # Start API + frontend with hot reload

# 4. Make a change, ship it
git checkout -b feat/user-search
# ... code ...
git commit -m "feat: add user search endpoint"   # hooks validate commit
git push                                          # pre-push runs dx check

# 5. Get a preview URL (automatic on PR, or manual)
gh pr create
dx preview deploy                  # → https://my-product-feat-xyz.preview.factory.rio.software

# 6. Merge → production
gh pr merge
dx release create 0.1.0            # Cut a release
dx deploy create --release 0.1.0 --target prod  # → https://my-product.factory.rio.software
```

**Total time from `dx init` to live preview: ~5 minutes.**

---

## Step-by-Step Guide

### Step 1: Scaffold the Project

```bash
dx init my-product
```

Interactive prompts will ask:
- **Type:** project (full monorepo), service, website, or library
- **Runtime:** node, java, python
- **Framework:** For services — Elysia (Node), Spring Boot (Java), FastAPI (Python). For websites — React + Vinxi.
- **Owner:** Your team slug

For a full-stack project, this generates:

```
my-product/
  docker-compose.yaml              # Root compose with includes
  compose/
    postgres.yml                   # PostgreSQL resource
    auth.yml                       # Auth service
    gateway.yml                    # API gateway
    my-product-api.yml             # Backend service (Elysia or Spring Boot)
    my-product-app.yml             # Frontend app (React + Vinxi)
  services/my-product-api/         # Backend source code
  apps/my-product-app/             # Frontend source code
  packages/                        # Shared libraries (npm/java/python)
  package.json                     # Monorepo root with dx config
  pnpm-workspace.yaml
  .dx/
    hooks/                         # Git hooks (committed)
      commit-msg                   # Validates conventional commits
      pre-commit                   # Runs lint-staged
      pre-push                     # Runs dx check
      post-merge                   # Syncs local state
      post-checkout                # Syncs local state
    conventions.yaml               # Branch naming, quality rules
    ports.json                     # Port allocation
  .github/
    workflows/dx.yaml              # CI: dx check on PR, deploy on tags
    pull_request_template.md       # PR template
  .gitattributes                   # Line endings and binary detection
  .cursor/rules                    # AI agent context
  .npmrc                           # npm config
  .node-version                    # Node 22
```

The project catalog (components, resources, ownership) is defined entirely by docker-compose labels — there is no separate `catalog.yaml`.

The `package.json#dx` key holds project config:
```json
{
  "dx": {
    "version": "1.0.0",
    "type": "monorepo",
    "team": "my-team",
    "conventions": { "commits": "conventional", "branching": "trunk" },
    "deploy": {
      "preview": { "trigger": "pull-request", "ttl": "72h" },
      "production": { "trigger": "release-tag", "approval": true }
    }
  }
}
```

### Step 2: Create a GitHub Repo

```bash
# Via GitHub CLI
gh repo create my-org/my-product --private --source=. --remote=origin
```

### Step 3: Initial Push

The scaffold already ran `git init`, installed hooks, and made the initial commit. Just push:

```bash
git push -u origin main
```

### Step 4: Local Development

```bash
dx up                    # Start infrastructure (postgres, redis, auth, gateway)
dx dev                   # Sync hooks + deps + codegen, then start dev servers

# Your services are now running:
# API:      http://localhost:8080
# Frontend: http://localhost:3000
# Gateway:  http://localhost:8005
```

The dev loop:
```bash
# Edit code → hot reload → test → repeat
dx test                  # Run tests (auto-detected)
dx test --watch          # Watch mode
dx db connect            # Debug database
dx logs api              # Check API logs
dx status                # Is everything healthy?
```

### Step 5: Ship a Change

```bash
git checkout -b feat/user-search

# Make your changes, then commit
git commit -m "feat: add user search endpoint"
# → commit-msg hook validates conventional format
# → pre-commit hook runs lint-staged

git push
# → pre-push hook runs dx check (lint + typecheck + test + format)
```

### Step 6: Preview URL

On every PR, a preview deployment is automatically created (if webhooks are configured). You can also create one manually:

```bash
dx preview deploy        # Creates preview from current branch
# → https://my-product-user-search.preview.factory.rio.software

dx preview status        # Check preview for current branch
dx preview list          # List all active previews
dx preview open          # Open preview URL in browser
dx preview destroy       # Tear down when done
```

### Step 7: Merge and Deploy to Production

```bash
gh pr merge              # Merge the PR

# Cut a release
dx release create 0.1.0

# Deploy to production
dx deploy create --release rel_xxx --target prod
dx deploy status         # Watch rollout progress
```

---

## What Happens Under the Hood

### On `dx init`
- Generates docker-compose.yaml with catalog/dx labels (the project catalog)
- Creates starter services with health checks, DB migrations, auth plugins
- Sets up quality tooling (oxlint, prettier, vitest, lint-staged)
- Installs git hooks in `.dx/hooks/` and sets `core.hooksPath`
- Generates GitHub Actions workflow (`.github/workflows/dx.yaml`)
- Writes `package.json#dx` with project config and conventions
- Runs `git init` + initial commit

### On `dx dev` (pre-flight)
- Checks git hooks health, installs if needed
- Runs detected code generators (drizzle-kit, prisma generate, etc.)
- Starts docker-compose infrastructure
- Starts native dev servers with port allocation

### On `git commit` (via hooks)
- `commit-msg` hook validates conventional commit format
- `pre-commit` hook runs `lint-staged` on changed files

### On `git push` (via hooks)
- `pre-push` hook runs `dx check` (lint + typecheck + test + format)
- If checks fail, push is blocked with a hint: `git push --no-verify` to bypass

### On `dx preview deploy`
- Calls Factory API to create preview
- Factory provisions infrastructure (namespace, containers, routes)
- Returns a preview URL with the format: `https://{slug}.preview.{domain}`
- Preview auto-expires based on TTL (default 72h, extendable)

### On `dx deploy create`
- Creates a rollout from a release to a deployment target
- Factory orchestrates the deployment (rolling update, health checks)
- Routes are updated to point to the new version

---

## Anti-Patterns

| Wrong | Right | Why |
|-------|-------|-----|
| `docker compose up` | `dx up` | dx manages port allocation, env injection |
| `npm run dev` | `dx dev` | dx runs pre-flight sync, manages ports |
| Creating `.github/workflows/` by hand | Let `dx init` generate them | Keeps CI aligned with project structure |
| Manual deploy via SSH | `dx deploy create` | Tracked, auditable, rollback-able |
| Skipping `dx preview` | Always preview before merge | Catches issues before they hit production |
| Installing git hooks manually | `dx sync` | dx manages `.dx/hooks/` and `core.hooksPath` |

---

## Current Status

### What Works Today
- `dx init` — Full project scaffold (Node/Elysia + React/Vinxi) with hooks, CI, and conventions
- `dx up` / `dx dev` — Local development with Docker Compose and pre-flight sync
- `dx test` / `dx lint` / `dx format` / `dx typecheck` / `dx check` — Auto-detected quality tooling
- `dx sync` — Local state healing (hooks, deps, docker, codegen, db)
- Git hooks — Automatic commit validation, lint-staged, pre-push checks
- `dx preview deploy` — Full preview lifecycle with URL generation
- `dx release` / `dx deploy` — Release and deployment management
- Script pass-through — `dx <name>` falls back to `package.json` scripts

### Coming Soon
- **Spring Boot template** — `dx init` with `--runtime java --framework spring-boot` for the backend service
- **One-command deploy** — auto-deploy to production on merge via GitHub Actions
- **Automatic webhook setup** — `dx git repo create` with full webhook configuration
