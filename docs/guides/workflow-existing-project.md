# Workflow: Existing Project — Install dx and Get a Better Workflow

For engineers and AI agents adopting dx on an existing VM or project. Whether you have a bare VM, a Docker Compose app, or a systemd-managed service, dx gives you a structured workflow for making changes safely, pushing, deploying, and getting preview URLs.

**Goal:** Install dx on your existing setup, get a fast dev loop, and ship changes with confidence — previews on branches, production deploys on merge.

---

## The Perfect Flow

```bash
# 1. Install dx
curl -fsSL https://get.dx.rio.software | sh
dx auth login

# 2. Connect your project to the Factory
cd /path/to/your/project
dx install --role workbench

# 3. Start working
dx status                          # Check everything is healthy
dx up && dx dev                    # Start dev environment

# 4. Make a change safely
git commit -m "fix: resolve auth timeout"  # hooks validate conventions
git push                                   # pre-push runs dx check

# 5. Preview before merging
gh pr create
dx preview deploy                  # → https://my-fix.preview.factory.rio.software
dx preview open                    # Open in browser

# 6. Merge and deploy
gh pr merge
dx release create 1.2.1
dx deploy create --release rel_xxx --target prod
```

---

## Starting Points

dx handles all these scenarios:

### Scenario A: Bare VM (nothing installed)

```bash
# Install dx
curl -fsSL https://get.dx.rio.software | sh
dx auth login

# Install Docker remotely (if you're setting up from your laptop)
dx setup docker --on my-vm.example.com

# Or install Docker locally (if you're on the VM)
dx run @dx/docker

# Install Node.js if needed
dx run @dx/node --set v=20

# Set up the workbench
dx install --role workbench
```

### Scenario B: VM with Docker + docker-compose app

Your app is already running via `docker-compose.yaml`. dx works with this directly.

```bash
# Install dx
curl -fsSL https://get.dx.rio.software | sh
dx auth login
dx install --role workbench

# dx discovers your project from docker-compose.yaml
cd /path/to/project
dx status                # Shows discovered components and resources

# Add catalog labels to your existing docker-compose.yaml (recommended)
# This tells dx about your component types, owners, and dev commands:
#   labels:
#     catalog.type: service
#     catalog.owner: my-team
#     dx.dev.command: "npm run dev"
#     dx.test: "npm test"

# Now dx commands work
dx up                    # Bring up your stack
dx dev                   # Start dev servers
dx test                  # Run tests
dx db connect            # Connect to your database
```

### Scenario C: VM with app running via systemd/PM2 (no Docker)

```bash
# Install dx
curl -fsSL https://get.dx.rio.software | sh
dx auth login
dx install --role workbench

# Set up hooks for git workflow even without Docker
dx sync                  # Installs git hooks, checks deps

# You can still use dx for quality checks
dx test                  # Auto-detects test runner
dx lint                  # Auto-detects linter
dx check                 # Runs all quality checks

# To add Docker-based workflow later:
dx run @dx/docker        # Install Docker
# Then add a docker-compose.yaml to your project
dx up && dx dev          # Now you have the full dx workflow
```

---

## Step-by-Step: Adopting dx on an Existing Project

### Step 1: Install dx

```bash
# Linux/macOS
curl -fsSL https://get.dx.rio.software | sh

# Or via npm
npm install -g lepton-dx
```

### Step 2: Authenticate

```bash
dx auth login
# Opens browser for authentication, or:
dx auth login --email you@company.com --password ***
```

### Step 3: Register as a Workbench

```bash
dx install --role workbench
```

This:

- Generates a workbench ID
- Checks your toolchain (git, docker, node)
- Validates Factory connectivity
- Sets up registry credentials
- Registers your machine with the Factory

### Step 4: Add Labels to Your docker-compose.yaml

If you already have a `docker-compose.yaml`, add labels to teach dx about your services:

```yaml
services:
  api:
    build: ./api
    ports:
      - "8080:8080"
    labels:
      catalog.type: service
      catalog.owner: my-team
      dx.runtime: node
      dx.dev.command: "npm run dev"
      dx.test: "npm test"
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
```

dx will auto-classify:

- Services with `build:` → **Components** (your code)
- Services with just `image:` → **Resources** (infrastructure)

### Step 5: Connect Your Repo to the Factory

```bash
# Register your git host (one-time)
dx git host create --type github --token ghp_xxx

# Register your repo
dx git repo create my-project
```

This enables PR management, preview deployments, and webhook-driven automation.

### Step 6: Start Working

```bash
dx status                # Everything healthy?
dx up                    # Start the stack
dx dev                   # Start dev servers
```

---

## The Daily Workflow

### Morning: Start Your Day

```bash
dx up                    # Start infrastructure
dx dev                   # Start dev servers
dx status                # Quick health check
```

### Coding: The Fast Loop

```bash
# Edit code → hot reload happens automatically

# Check things
dx status                # Services healthy?
dx logs api              # What's the API saying?
dx db query --sql "SELECT count(*) FROM users"  # Quick data check

# Test
dx test                  # Run all tests
dx test api              # Test specific component
```

### Shipping: Push with Confidence

```bash
# Git hooks enforce conventions automatically
git commit -m "feat: add search endpoint"    # commit-msg hook validates format
git push                                     # pre-push hook runs dx check

# Create PR
gh pr create
```

### Previewing: Verify Before Merge

```bash
dx preview deploy        # Create preview from current branch
dx preview open          # Open in browser
dx preview status        # Check preview health

# When done
dx preview destroy       # Clean up (or let TTL expire)
```

### Merging and Deploying

```bash
gh pr checks             # CI passing?
gh pr merge              # Squash-merge to main

# Production deploy
dx release create 1.2.0
dx deploy create --release rel_xxx --target prod
dx deploy status rel_xxx # Watch rollout
```

### End of Day

```bash
dx down                  # Tear down the stack
# Or leave it running — dx down is for clean stops
```

---

## Database Workflows

```bash
# Connect to local database
dx db connect

# Run a quick query
dx db query --sql "SELECT * FROM users WHERE created_at > now() - interval '1 day'"

# Migrations
dx db migrate status     # What's pending?
dx db migrate up         # Apply pending migrations
dx db migrate down       # Rollback last migration

# Connect to staging/production (via tunnel)
dx db connect --target staging
dx db query --sql "SELECT count(*) FROM orders" --target production
```

---

## Remote Operations

### Set Up Remote VMs

```bash
# Install tools on a remote machine
dx setup docker --on staging-1.example.com
dx setup node --on staging-1.example.com --set v=20

# Run a custom script remotely
dx run deploy.sh --on staging-1.example.com

# Run a recipe
dx run @dx/caddy --on web-1.example.com
```

### Tunnel to Remote Services

```bash
# Connect to a remote deployment target
dx connect staging
# All staging services are now available on local ports

# Expose a local port publicly
dx tunnel 3000           # → https://xxx.tunnel.factory.rio.software
dx tunnel list           # See active tunnels
dx tunnel close <id>     # Close a tunnel
```

---

## Troubleshooting

### "dx status shows unhealthy"

```bash
dx status                # What's wrong?
dx logs <component>      # Check the logs
dx down --volumes        # Nuclear option: full reset
dx up                    # Start fresh
```

### "Can't connect to database"

```bash
dx db connect            # Does this work?
# If not:
dx up postgres           # Make sure postgres is running
dx status                # Check service health
```

### "Convention check failed on commit"

```bash
# The commit-msg hook validates against conventional commit format
# If you need to bypass (with good reason):
git commit --no-verify -m "hotfix: resolve production outage"
# Note: pre-push hook will still run dx check when you push
```

### "Preview not deploying"

```bash
dx preview deploy --verbose  # See what's happening
dx preview status            # Check current preview state
# Make sure your repo is registered: dx git repo list
```

---

## Anti-Patterns

| Wrong                        | Right                                        | Why                                             |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------- |
| `ssh vm && vim && restart`   | `dx dev` + `git push`                        | Tracked, reversible, auditable                  |
| `scp deploy.tar.gz vm:`      | `dx deploy create`                           | Versioned releases, rollback support            |
| `git push && pray`           | `git push` (hooks run checks) + `dx preview` | Hooks + preview catch issues before prod        |
| Manual DB changes in prod    | `dx db migrate`                              | Tracked, reversible migrations                  |
| `docker compose up`          | `dx up`                                      | dx manages ports, env injection, catalog labels |
| Editing `.env` files by hand | `dx env` / `dx secret`                       | Secrets in vault, not in files                  |

---

## Current Status

### What Works Today

- `dx install --role workbench` — Full workbench setup with toolchain checks
- `dx setup <tool> --on <vm>` — Remote tool installation via recipes (docker, node, caddy)
- `dx run` — Script and recipe execution (local + remote)
- `dx up` / `dx dev` — Full local dev with Docker Compose and native dev servers
- `dx sync` — Local state healing (hooks, deps, docker images, codegen, db)
- `dx test` / `dx lint` / `dx format` / `dx typecheck` / `dx check` — Auto-detected quality tooling
- Git hooks — Automatic commit validation, lint-staged, pre-push checks via `.dx/hooks/`
- `dx preview` — Full preview lifecycle (deploy, list, show, destroy, open, extend)
- `dx db` — Database connect, query, migrate
- `dx tunnel` — Local port exposure
- `dx connect` — Tunnel to remote deployment targets
- `dx git` — Multi-host git provider management + repo CRUD
- Script pass-through — `dx <name>` falls back to `package.json` scripts

### Coming Soon

- **TUI dashboard** — `dx tui` for a terminal-based overview of all services, builds, and deployments
- **dx work** — Work item management (create, list, start, done) linked to Jira/Linear
- **dx agent** — Agent skill management (add, remove, sync)
- **Automatic webhook setup** — `dx git repo create` should auto-configure webhooks for preview deployments on PR
- **One-command production deploy** — Today requires `dx release create` + `dx deploy create`
