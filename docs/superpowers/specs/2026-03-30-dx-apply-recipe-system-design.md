# `dx run` — Universal Execute & Recipe System

**Date:** 2026-03-30
**Status:** Approved design, ready for implementation planning

---

## Problem

The dx CLI has a fragmented "run stuff" surface: `dx script` runs TS locally, `dx install` bootstraps the platform, `dx docker setup` installs Docker remotely. Engineers need a unified way to run scripts, recipes, and playbooks on local or remote machines — without learning separate commands for each.

## Solution

Rationalize the CLI verb space into three clear commands:

| Command | Purpose | Replaces |
|---------|---------|----------|
| **`dx run`** | Universal execute — scripts, recipes, Ansible playbooks. Local or remote via `--on`. | `dx script`, `dx apply` (never shipped) |
| **`dx setup`** | Bootstrap machines with tools. Sugar over `dx run @dx/<tool> --on`. | `dx install`, `dx docker setup` |
| **`dx exec`** | Run a command inside a running context (sandbox, container). | Future — not in this spec |

`dx script` becomes a deprecated alias for `dx run`. `dx install` becomes a deprecated alias for `dx setup`.

---

## CLI Verb Rationalization

### dx run — universal execute

```bash
# Run a TS/JS script locally (current dx script behavior)
dx run script.ts
dx run script.ts --watch

# Run a script on a remote machine
dx run script.sh --on staging-1
dx run deploy.ts --on staging-1

# Run a built-in recipe
dx run @dx/docker --on staging-1
dx run @dx/node --on staging-1 --set version=20

# Run a custom recipe (from .dx/recipes/)
dx run ghost-cms --on staging-1 --set domain=blog.example.com

# Run an Ansible playbook (auto-detected, dx generates inventory)
dx run playbook.yml --on tag:webservers

# Utility subcommands
dx run list                              # list available recipes
dx run show <recipe>                     # show recipe details
```

### dx setup — machine provisioning sugar

```bash
# Bootstrap the dx platform (replaces dx install)
dx setup
dx setup --role workbench

# Install a tool on a remote machine (sugar for dx run @dx/<tool> --on)
dx setup docker --on staging-1
dx setup node --on staging-1 --set version=20
dx setup caddy --on staging-1 --set domain=example.com
```

### Input type detection

`dx run` auto-detects what it's running based on the input:

| Input | Detection | Behavior |
|-------|-----------|----------|
| `*.ts` / `*.js` | File extension | Run via embedded Bun (current `dx script`) |
| `*.sh` | File extension | Run as shell script (local or remote) |
| `@dx/<name>` | `@dx/` prefix | Resolve built-in recipe |
| Directory with `recipe.yml` | Directory check | Run recipe flow |
| Bare name (e.g. `ghost-cms`) | Recipe resolution | Search project → user → built-in recipes |
| `*.yml` with Ansible markers | YAML content detection (hosts, tasks keys) | Run via `ansible-playbook` with dx-generated inventory |

### Remote TS execution

When running `.ts` on a remote machine (`dx run deploy.ts --on staging-1`):

1. Check if dx is installed on the remote machine
2. If not, offer to install it: "dx is not installed on staging-1. Install it? (dx carries its own Bun runtime)"
3. If yes: rsync the dx binary to the remote, then `ssh machine 'dx run /tmp/script.ts'`
4. If no: fall back to syncing the script and running via `bun` or `node` if available

This means remote machines with dx installed get full TS recipe support with the `@dx/run` SDK for free.

---

## Recipe Format

A recipe is a directory with a YAML manifest and script files.

### Directory structure

```
<recipe-name>/
  recipe.yml       # metadata, params, dependencies (required)
  install.sh       # main install/apply script (required)
  verify.sh        # idempotency check (optional)
  uninstall.sh     # teardown script (optional)
```

### recipe.yml

```yaml
name: ghost-cms
description: Deploy Ghost CMS via Docker Compose
requires:
  - docker
params:
  domain:
    type: string
    required: true
    description: Domain name for Ghost
  port:
    type: number
    default: 2368
    description: Host port to expose
os:
  - linux
tags:
  - cms
  - blog
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Recipe identifier |
| `description` | string | yes | Human-readable description |
| `requires` | string[] | no | Other recipes that must be applied first |
| `params` | map | no | Named parameters with type, default, required, description |
| `os` | string[] | no | Supported OS types (`linux`, `darwin`). All if omitted. |
| `tags` | string[] | no | Categorization tags for filtering |

### Parameter types

- `string` — passed as-is
- `number` — validated as numeric
- `boolean` — `true`/`false`

### How scripts receive parameters

As environment variables prefixed with `DX_PARAM_`:

```bash
#!/bin/bash
# install.sh
echo "Installing on port ${DX_PARAM_PORT:-2368}"
echo "Domain: ${DX_PARAM_DOMAIN}"
```

Additional environment variables provided to all scripts:

| Variable | Description |
|----------|-------------|
| `DX_PARAM_*` | Recipe parameters |
| `DX_MACHINE_NAME` | Target machine slug |
| `DX_MACHINE_HOST` | Target hostname/IP |
| `DX_MACHINE_USER` | SSH user |
| `DX_RECIPE_NAME` | Recipe being applied |
| `DX_RECIPE_DIR` | Recipe directory path (on remote, after sync) |

### verify.sh contract

- Exit code `0` → already applied, skip install (unless `--force`)
- Exit code non-zero → needs to be applied
- Should be fast and side-effect-free

```bash
#!/bin/bash
# verify.sh — check if Docker is installed and running
command -v docker &>/dev/null && docker info &>/dev/null
```

---

## Recipe Resolution Order

1. **Project-local:** `.dx/recipes/<name>/`
2. **User-global:** `~/.config/dx/recipes/<name>/`
3. **Built-in:** Bundled with dx CLI (`cli/src/recipes/<name>/`)

First match wins. Users can override built-in recipes per-project.

---

## Execution Flow

When `dx run ghost-cms --on staging-1 --set domain=blog.example.com`:

1. **Detect input type** — bare name → recipe resolution
2. **Resolve recipe** — find `ghost-cms` in project → user → built-in
3. **Parse manifest** — read `recipe.yml`, validate params
   - Error if required param missing with no default
   - Apply defaults for optional params
4. **Check dependencies** — for each entry in `requires`:
   - Resolve the dependency recipe
   - Run its `verify.sh` on the target
   - If not satisfied, apply dependency first (recursive)
   - Circular dependency detection via visited set
5. **Resolve target(s)** — `resolveMachine()` for single, expand for comma/tag/inventory
6. **For each target machine:**
   a. If `--dry-run`: run `verify.sh`, report status, stop
   b. If `verify.sh` exists and exits 0: print "Already applied", skip (unless `--force`)
   c. Rsync recipe directory to `/tmp/dx-run-<recipe>-XXXXXX/` on remote
   d. Execute: `ssh machine 'bash /tmp/dx-run-.../install.sh'` with `DX_PARAM_*` env vars
   e. Report success/failure with duration
7. **Summary** — if multi-machine, print per-machine status table

### Multi-machine execution (v1)

Sequential. Print per-machine status:

```
Running docker on 3 machines...
  staging-1  ✓  applied (12s)
  staging-2  ✓  already applied (skipped)
  staging-3  ✗  failed: SSH connection refused
```

Parallel execution is a follow-up.

---

## Machine Targeting

### Single machine
`--on staging-1` — uses existing `resolveMachine()`

### Comma-separated
`--on staging-1,staging-2,prod-1` — resolves each, runs sequentially

### Tags
`--on tag:webservers` — machines need tags.

Add tag support to local machine registration:
```bash
dx docker add staging-1 --host 10.0.0.5 --user ubuntu --tag web --tag production
```

Stored in `~/.config/dx/machines.json`:
```json
{
  "staging-1": { "host": "10.0.0.5", "user": "ubuntu", "tags": ["web", "production"] }
}
```

For Factory-managed machines, tags come from host/VM labels in the DB.

Resolution: scan local machines.json tags → query Factory API host/VM labels.

### Inventory files

`.dx/inventory.yml`:
```yaml
groups:
  webservers:
    - staging-1
    - staging-2
  databases:
    - db-1
    - db-2
```

Target with: `--on @inventory:webservers`

---

## Ansible Playbook Support

When `dx run playbook.yml --on tag:webservers`:

1. Read the YAML file, detect Ansible format (has `hosts:` and `tasks:` keys)
2. Resolve all machines from `--on` target
3. Generate a temporary Ansible inventory file from resolved machines
4. Auto-install `ansible-playbook` if not present (like `dx ci` auto-installs `act`)
5. Run: `ansible-playbook -i /tmp/dx-inventory.ini playbook.yml`
6. SSH keys and access already handled by dx's machine resolution

This gives Ansible users the dx inventory for free — no manual `hosts.ini` maintenance.

---

## Built-in Recipes (v1)

### @dx/docker

```yaml
name: docker
description: Install Docker Engine and Docker Compose plugin
params:
  version:
    type: string
    description: Docker version (default: latest)
os:
  - linux
```

Replaces the current `DOCKER_BOOTSTRAP_SCRIPT` in `docker-remote.ts`. Includes Alpine/apk detection.

### @dx/node

```yaml
name: node
description: Install Node.js via nvm
params:
  version:
    type: string
    default: "20"
    description: Node.js major version
os:
  - linux
```

### @dx/caddy

```yaml
name: caddy
description: Install Caddy web server
requires:
  - docker
params:
  domain:
    type: string
    description: Domain for automatic HTTPS
os:
  - linux
```

---

## Migration Plan

### dx script → dx run

- `dx run` handles all current `dx script` functionality (TS/JS via Bun, --watch, --set, DX_BIN)
- `dx script` becomes a deprecated alias that prints a notice and delegates to `dx run`
- No breaking changes — `dx script setup.ts` keeps working

### dx install → dx setup

- `dx setup` with no arguments runs the platform install flow (current `dx install`)
- `dx setup docker --on staging-1` runs `@dx/docker` recipe
- `dx install` becomes a deprecated alias
- `dx docker setup <slug>` delegates to the recipe runner internally

---

## Files to Create

| File | Purpose |
|------|---------|
| `cli/src/commands/run.ts` | Command definition — input detection, dispatch to script/recipe/ansible runners |
| `cli/src/commands/setup.ts` | Sugar command — delegates to run for remote, to install flow for local |
| `cli/src/handlers/run.ts` | Recipe resolution, param validation, execution orchestration |
| `cli/src/lib/recipe.ts` | Recipe manifest parsing, dependency graph, verify/install execution |
| `cli/src/lib/machine-target.ts` | Multi-machine targeting: tag resolution, comma expansion, inventory parsing |
| `cli/src/recipes/docker/recipe.yml` | Built-in Docker recipe manifest |
| `cli/src/recipes/docker/install.sh` | Docker install script |
| `cli/src/recipes/docker/verify.sh` | Check if Docker is installed |
| `cli/src/recipes/node/recipe.yml` | Built-in Node.js recipe |
| `cli/src/recipes/node/install.sh` | Node install via nvm |
| `cli/src/recipes/node/verify.sh` | Check if Node is installed |
| `cli/src/recipes/caddy/recipe.yml` | Built-in Caddy recipe |
| `cli/src/recipes/caddy/install.sh` | Caddy install script |
| `cli/src/recipes/caddy/verify.sh` | Check if Caddy is installed |

## Files to Modify

| File | Change |
|------|--------|
| `cli/src/register-commands.ts` | Register `runCommand`, `setupCommand` |
| `cli/src/commands/script.ts` | Deprecation notice + delegate to `dx run` |
| `cli/src/commands/install.ts` | Deprecation notice + delegate to `dx setup` |
| `cli/src/handlers/docker-remote.ts` | Extract `resolveMachine` to `machine-target.ts`; add tag support; re-export for compat |
| `cli/src/commands/docker.ts` | `dx docker setup` calls shared recipe runner |

---

## Not in v1 Scope

- **TS recipe support** — `install.ts` with `@dx/run` SDK helpers (requires dx-on-remote)
- **dx on remote machines** — auto-install dx binary on remote for TS execution
- **Parallel multi-machine execution** — sequential is fine for v1
- **`dx run history`** — track what's been run on which machines
- **Community recipe registry** — `dx run @community/ghost-cms`
- **Recipe versioning** — lock recipe versions in project config
- **Rollback** — run `uninstall.sh`
- **`dx exec`** — run commands in running sandboxes/containers

---

## Error Handling

| Error | Detection | User message |
|-------|-----------|-------------|
| Unknown input type | Can't detect script, recipe, or playbook | `Cannot determine how to run "<input>". Expected: .ts/.js/.sh file, recipe name, or Ansible playbook.` |
| Recipe not found | Not in project, user, or built-in paths | `Recipe "<name>" not found. Available: dx run list` |
| Missing required param | Param has `required: true`, not in `--set` | `Missing required parameter "<name>". Use: --set <name>=<value>` |
| Machine not found | `resolveMachine()` fails | Same as `dx docker` — suggests `dx docker add` or `dx ssh config sync` |
| Dependency recipe missing | `requires` entry not resolvable | `Recipe "<name>" requires "<dep>" which was not found.` |
| SSH connection failed | SSH exits with error | `Cannot connect to <machine>. Check: dx ssh <machine>` |
| install.sh failed | Non-zero exit | `Recipe "<name>" failed on <machine> (exit code <N>)` |
| Circular dependency | Visited set detects loop | `Circular dependency detected: <chain>` |
| Unknown param in --set | Param not in manifest | Warning: `Unknown parameter "<name>" (ignored). Known: <list>` |
| Ansible not installed | `which ansible-playbook` fails | `Ansible not found. Install it? (y/n)` — auto-install via pip/pipx |
