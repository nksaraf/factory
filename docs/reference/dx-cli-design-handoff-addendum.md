# dx CLI — Design Handoff Addendum

**Document type:** Architecture & implementation specification (supplement to `dx-cli-design-handoff.md`)
**Audience:** Claude Code / AI coding agents implementing the dx CLI
**Status:** Design complete, ready for implementation
**Last updated:** 2026-04-04
**Prerequisite:** Read `dx-cli-design-handoff.md` first. This document adds new command groups and revises several commands from the original.

---

## Table of Contents

1. [Summary of Changes](#1-summary-of-changes)
2. [dx factory — Replaces dx auth](#2-dx-factory--replaces-dx-auth)
3. [dx work — Work Item & Branching System](#3-dx-work--work-item--branching-system)
4. [Worktree Architecture](#4-worktree-architecture)
5. [PR Stacking](#5-pr-stacking)
6. [Agent-Specific Workflows](#6-agent-specific-workflows)
7. [dx tunnel — Expose Local Ports (ngrok model)](#7-dx-tunnel--expose-local-ports-ngrok-model)
8. [dx forward — Remote Port Forwarding](#8-dx-forward--remote-port-forwarding)
9. [SSH Management (No Wrapper)](#9-ssh-management-no-wrapper)
10. [Known Hosts Strategy](#10-known-hosts-strategy)
11. [Revised Command Surface](#11-revised-command-surface)
12. [New package.json Config](#12-new-packagejson-config)
13. [Convention Enforcement Summary](#13-convention-enforcement-summary)

---

## 1. Summary of Changes

### New command groups

| Command group | Purpose                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `dx factory`  | Replaces `dx auth`. Factory authentication, host management, registry credentials. |
| `dx work`     | Work item management, branching, worktrees, PR stacking, agent orchestration.      |
| `dx tunnel`   | Expose local ports publicly (ngrok/cloudflared mental model).                      |
| `dx forward`  | Bring remote ports to localhost (SSH port forwarding).                             |

### Removed/renamed from original handoff

| Original                    | Change                       | Reason                                                       |
| --------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `dx auth login`             | → `dx factory login`         | "auth with what?" — `dx factory` is explicit                 |
| `dx auth ci`                | → `dx factory login --ci`    | Same operation, just non-interactive                         |
| `dx auth refresh-hosts`     | → `dx factory sync hosts`    | Natural verb under factory namespace                         |
| `dx connect <env>`          | **Dropped entirely**         | Over-engineered. Replaced by `dx forward` for specific ports |
| `dx tunnel <host>:<port>`   | → `dx forward <host>:<port>` | `dx tunnel` now means expose (matching industry convention)  |
| `dx tunnel --expose <port>` | → `dx tunnel <port>`         | Expose is the default meaning of "tunnel"                    |

### Design principles reaffirmed

- **No SSH wrapper.** `dx` configures SSH (config, keys, known_hosts) but never wraps the `ssh` command.
- **Work items drive branches.** Every branch maps to a Jira ticket. No manual branch naming.
- **Worktrees for parallel work.** Multiple branches checked out simultaneously. Essential for agent workflows.
- **`dx tunnel` matches ngrok.** Industry standard: "tunnel" = expose local to the internet.

---

## 2. dx factory — Replaces dx auth

### Why the rename

`dx auth` is generic — auth with what? `dx factory` makes it immediately clear you're interacting with the Factory platform. It also opens a natural namespace for other Factory operations.

### Command surface

```bash
dx factory login                    # authenticate with Factory, configure registries, write SSH host aliases
dx factory login --ci               # non-interactive, uses ambient CI credentials (workload identity, GITHUB_TOKEN)
dx factory status                   # am I authenticated? token expiry? org?
dx factory sync hosts               # re-fetch host inventory, update SSH config, clear stale host keys
dx factory hosts list               # show all known hosts with names, IPs, and status
dx factory hosts update <name> --ip <ip>  # manual override when Factory hasn't caught up
```

### `dx factory login` — full behavior

```bash
$ dx factory login

  Opening browser for authentication...
  ✓ Authenticated as nikhil@lepton.software (Lepton org)

  Configuring registries...
    ✓ GCP Artifact Registry (credential helper → gcloud)
    ✓ GitHub Container Registry (credential helper → gh)
    ✓ GitHub npm registry (token via gh auth token)

  Configuring SSH hosts...
    ✓ staging       → 10.0.1.42
    ✓ prod-1        → 10.0.1.43
    ✓ prod-2        → 10.0.1.44
    ✓ runner        → 192.168.5.17

  Ready.
```

Under the hood:

1. **Factory auth:** Open browser for SSO/OAuth, exchange for Factory API token, store in `~/.dx/credentials`
2. **Registry credential helpers:** Configure `~/.docker/config.json` credHelpers (gcloud for GCP AR, gh for ghcr.io). Set npm registry token via `gh auth token` in shell config.
3. **SSH host config:** Fetch host inventory from Factory API (name → IP mapping), write to `~/.ssh/config.d/dx-hosts` or append to `~/.ssh/config`. Set per-host SSH options for dx-managed hosts (see [Known Hosts Strategy](#10-known-hosts-strategy)).

### `dx factory login --ci`

```bash
$ dx factory login --ci

  Detected CI environment (GitHub Actions)
  ✓ Configured registries from ambient credentials
  ✓ Factory API authenticated via workload identity
```

Detects CI via environment variables and no TTY. Configures credential helpers using ambient CI credentials instead of interactive browser login.

### `dx factory sync hosts`

```bash
$ dx factory sync hosts

  Fetching host inventory from Factory...

  Updated:
    ~ staging       10.0.1.42 → 10.0.1.50  (IP changed)
    ✓ prod-1        10.0.1.43               (unchanged)
    ✓ prod-2        10.0.1.44               (unchanged)
    + build-runner  10.0.1.60               (new host)
    - old-runner    192.168.5.17            (removed)

  ✓ SSH config updated
  ✓ Stale host keys cleared for changed/removed hosts
```

Internally:

1. Fetch current host inventory from Factory API
2. Rewrite the dx-managed block in SSH config
3. Delete `~/.ssh/known_hosts.d/dx-infra` (clear stale host keys — see [Known Hosts Strategy](#10-known-hosts-strategy))
4. Next SSH connection to changed hosts re-accepts (via `StrictHostKeyChecking accept-new`)

### `dx factory hosts update <name> --ip <ip>`

For when a developer reprovisioned a VM and Factory hasn't synced yet:

```bash
$ dx factory hosts update staging --ip 10.0.1.50

  ✓ SSH config updated: staging → 10.0.1.50
  ✓ Stale host key cleared for staging
  ✓ Factory notified of IP change
```

Updates the SSH config alias immediately, clears the known_hosts entry, and tells Factory about the new IP.

### `dx factory status`

```bash
$ dx factory status

  Authenticated: nikhil@lepton.software
  Organization: Lepton Software
  Token expires: 2026-04-05T14:30:00Z (23 hours)

  Registries:
    ✓ GCP Artifact Registry: credential helper configured (gcloud)
    ✓ GitHub Container Registry: credential helper configured (gh)
    ✓ GitHub npm registry: token valid

  Managed hosts: 4
    staging (10.0.1.42), prod-1 (10.0.1.43), prod-2 (10.0.1.44), runner (192.168.5.17)
```

### `dx factory hosts list`

```bash
$ dx factory hosts list

  Name          IP             User     Status
  staging       10.0.1.42      deploy   reachable
  prod-1        10.0.1.43      deploy   reachable
  prod-2        10.0.1.44      deploy   reachable
  runner        192.168.5.17   deploy   unreachable (timeout)
```

With `--json` for agents:

```json
{
  "hosts": [
    {
      "name": "staging",
      "ip": "10.0.1.42",
      "user": "deploy",
      "status": "reachable"
    },
    {
      "name": "prod-1",
      "ip": "10.0.1.43",
      "user": "deploy",
      "status": "reachable"
    }
  ]
}
```

### How `dx install` and `dx factory login` relate

`dx install` sets up the machine (git, docker, shell, SSH defaults). It does NOT do Factory auth. At the end of `dx install`, it prints:

```
  Factory
    → Run dx factory login to connect to your organization
```

Clean separation: "set up my machine" vs. "connect to my organization."

---

## 3. dx work — Work Item & Branching System

### Core invariant

**Every branch maps to a work item. Every work item maps to a branch.** This is enforced, not suggested. No orphan branches, no manual naming.

### Branch naming convention

```
<ticket-slug>/<description-slug>

Examples:
  traf-142/add-search-endpoint
  traf-305/fix-kratos-auth-timeout
  traf-89/refactor-tenant-isolation
```

Rules:

- All lowercase
- Ticket prefix: Jira project key + number, lowercased
- Description: auto-slugified from ticket title (truncated to ~50 chars)
- No `feature/`, `bugfix/`, `hotfix/` prefixes — ticket type IS the categorization
- `pre-push` hook validates branch name matches pattern (except `main`)

### Command surface

```bash
# === Starting work ===
dx work start <TICKET>                      # create branch + worktree from Jira ticket
dx work start --quick "description"         # auto-create Jira ticket + branch + worktree
dx work start <TICKET> --agent              # create worktree optimized for AI agent
dx work start <TICKET> --no-worktree        # just create branch, no worktree (simple mode)

# === Stacking ===
dx work stack "description"                 # create stacked branch from current
dx work restack                             # rebase entire stack after base changes
dx work stack status                        # show stack state + sync status

# === Status ===
dx work list                                # all active work items with worktrees, ports, agents
dx work status                              # detailed status of current work item

# === Switching ===
dx work switch <TICKET>                     # cd to that worktree (or checkout if no worktree)

# === Keeping current ===
dx work rebase                              # rebase current branch onto main
dx work sync                                # rebase onto main + run dx sync in worktree

# === Finishing ===
dx work done                                # cleanup after PR merge: delete worktree + branch + drop DB
dx work done --all                          # cleanup ALL merged work items
dx work abandon <TICKET>                    # delete worktree + branch without merge

# === PR shortcuts ===
dx work pr                                  # gh pr create --fill (auto-sets base for stacks)
dx work pr --draft                          # create as draft PR

# === CI ===
dx work check-age                           # warn if branch is stale (for CI checks)
```

### `dx work start <TICKET>` — full behavior

```bash
$ dx work start TRAF-142

  Fetching ticket: TRAF-142 — "Add search endpoint"
  Type: Story | Priority: Medium

  Creating worktree...
  Branch: traf-142/add-search-endpoint
  Worktree: ~/projects/my-product.worktrees/traf-142/

  Setting up worktree...
    ✓ Worktree created from main (at abc1234)
    ✓ Dependencies installed (pnpm install — cached, 0.8s)
    ✓ .env generated (DATABASE_URL → my-product-traf-142)
    ✓ Database created: my-product-traf-142
    ✓ Migrations applied (14 migrations, 1.2s)

  Jira updated:
    ✓ TRAF-142 → In Progress
    ✓ Branch name added to ticket

  cd ~/projects/my-product.worktrees/traf-142
  dx dev    # to start dev environment
```

Internal steps:

1. **Fetch ticket** from Jira API (title, type, status)
2. **Generate branch name** from ticket key + slugified title
3. **Create worktree** from main: `git worktree add ../my-product.worktrees/traf-142 -b traf-142/add-search-endpoint main`
4. **Install dependencies** in worktree: `pnpm install` (fast — content-addressed store, hard-links from global store)
5. **Generate `.env`** with worktree-specific `DATABASE_URL` (e.g., `postgres://localhost:5432/my-product-traf-142`)
6. **Create per-worktree database** and run migrations
7. **Update Jira** — move ticket to In Progress, add branch name
8. **Print instructions** — cd path and next command

### `dx work start --quick "description"`

When the developer doesn't have a ticket yet:

```bash
$ dx work start --quick "fix auth timeout on slow connections"

  Creating Jira ticket...
  ✓ TRAF-312: "Fix auth timeout on slow connections" (type: Task)

  # ... same flow as dx work start TRAF-312 ...
```

Creates a Jira ticket automatically (default type: Task, in the project configured in `package.json` `dx.work.project`), then proceeds with normal flow.

### `dx work start <TICKET> --no-worktree`

Simple mode for developers who prefer single-checkout:

```bash
$ dx work start TRAF-142 --no-worktree

  Branch: traf-142/add-search-endpoint
  ✓ Checked out from main
  ✓ Jira TRAF-142 → In Progress
```

Just creates the branch and checks it out. No worktree, no separate database. For developers who work on one thing at a time and prefer the traditional model.

### `dx work list`

```bash
$ dx work list

  Active work items:

  TICKET    BRANCH                          MODE       WHO     COMMITS  PORTS        AGE
  TRAF-142  traf-142/add-search-endpoint    worktree   human   8        api:3001     2d
  TRAF-305  traf-305/add-search             worktree   agent   3        api:3002     4h
  TRAF-306  traf-306/refactor-notifs        worktree   agent   1        api:3003     2h
  TRAF-307  traf-307/increase-coverage      worktree   agent   5        —            1h
  TRAF-89   traf-89/refactor-tenant         branch     human   12       —            5d ⚠

  Shared infrastructure: postgres:5432, redis:6379, kratos:4433

  ⚠ TRAF-89 is 5 days old. Consider: dx work rebase
```

With `--json`:

```json
{
  "items": [
    {
      "ticket": "TRAF-142",
      "branch": "traf-142/add-search-endpoint",
      "mode": "worktree",
      "path": "/home/nikhil/projects/my-product.worktrees/traf-142",
      "who": "human",
      "commits": 8,
      "ports": { "api": 3001, "frontend": 5174 },
      "age_hours": 48,
      "stale": false
    }
  ],
  "shared_infra": {
    "postgres": 5432,
    "redis": 6379,
    "kratos": 4433
  }
}
```

### `dx work switch <TICKET>`

```bash
$ dx work switch TRAF-305

  Worktree: ~/projects/my-product.worktrees/traf-305/

  cd ~/projects/my-product.worktrees/traf-305
```

If in a shell that supports it, dx can actually `cd` via a shell function. Otherwise it prints the path for the developer to copy. For worktree-less branches, it does `git checkout`.

### `dx work rebase`

```bash
$ dx work rebase

  Fetching main...
  Rebasing traf-142/add-search-endpoint onto main...
  ✓ Rebased (3 commits replayed cleanly)
  ✓ Migrations checked (no new migrations from main)
```

If there are conflicts, it drops into normal git rebase flow — dx doesn't try to be smart about conflict resolution.

### `dx work done`

```bash
$ dx work done

  Checking PR status...
  ✓ PR #47 merged to main

  Cleaning up:
    ✓ Worktree removed: ~/projects/my-product.worktrees/traf-142/
    ✓ Branch deleted: traf-142/add-search-endpoint (local + remote)
    ✓ Database dropped: my-product-traf-142
    ✓ Jira TRAF-142 → Done

  Cleaned up.
```

If the PR is NOT merged:

```bash
$ dx work done

  ✗ PR #47 is not merged yet (status: open, 1 approval, CI passing)
  Use dx work abandon TRAF-142 to discard without merging.
```

### `dx work done --all`

```bash
$ dx work done --all

  Checking merged PRs...

  ✓ TRAF-142: PR #47 merged — cleaned up (worktree, branch, database)
  ✓ TRAF-305: PR #52 merged — cleaned up (worktree, branch, database)
  ✗ TRAF-306: PR #53 still open — skipped
  ✗ TRAF-307: no PR — skipped

  Cleaned up 2 work items. 2 still active.
```

### `dx work abandon <TICKET>`

```bash
$ dx work abandon TRAF-89

  ⚠ This will delete the worktree, branch, and database for TRAF-89.
  The PR (if any) will NOT be closed.
  Continue? [y/N]

  ✓ Worktree removed
  ✓ Branch deleted (local + remote)
  ✓ Database dropped
  ✓ Jira TRAF-89 → status unchanged
```

### `dx work check-age` (CI command)

```bash
$ dx work check-age

  Branch: traf-142/add-search-endpoint
  Age: 6 days
  Behind main: 12 commits

  ⚠ Branch is older than 7 days. Consider rebasing or splitting.

  Exit code: 1 (warning threshold exceeded)
```

Configurable thresholds in `package.json` (see [New package.json Config](#12-new-packagejson-config)).

### Short-lived branch enforcement

| Mechanism                              | What it does                                                       |
| -------------------------------------- | ------------------------------------------------------------------ |
| `dx work start`                        | Always creates from `main` HEAD — no stale starting point          |
| `dx work check-age` in CI              | Warns at configurable threshold (default 3 days), errors at 7 days |
| `dx work list`                         | Shows age with ⚠ indicator for stale branches                      |
| Branch protection (squash merge)       | Ensures clean history on main, no merge commits                    |
| `git config --global fetch.prune true` | Dead remote branches cleaned up on every fetch                     |
| `gh pr merge --delete-branch`          | Auto-delete branch after merge                                     |

---

## 4. Worktree Architecture

### Directory layout

```
~/projects/
├── my-product/                        # main worktree (main branch, always clean)
│   ├── .git/                          # the actual git database (shared by all worktrees)
│   ├── src/
│   ├── package.json
│   ├── docker-compose.yaml
│   └── ...
└── my-product.worktrees/              # dx-managed worktree directory
    ├── traf-142/                      # full independent checkout for TRAF-142
    │   ├── src/
    │   ├── package.json
    │   ├── node_modules/              # pnpm hard-links — minimal disk usage
    │   ├── .env                       # worktree-specific (DATABASE_URL differs)
    │   └── ...
    ├── traf-305/                      # full independent checkout for TRAF-305
    │   └── ...
    └── traf-306/
        └── ...
```

Key properties:

- All worktrees share a single `.git` database (in the main worktree)
- Each worktree is a full, independent file system checkout
- Changes in one worktree don't affect any other
- No stashing, no context switching — just `cd` to another directory

### Dependencies across worktrees — why pnpm matters

Each worktree needs its own `node_modules`, but duplicating 500MB+ per worktree is wasteful. pnpm solves this with a content-addressed store:

- All packages are stored once in `~/.local/share/pnpm/store/`
- Each worktree's `node_modules` contains hard-links to the store
- `pnpm install` in a new worktree is near-instant (everything is already in the store)
- Disk usage per additional worktree: negligible (just hard-links)

This is a key reason pnpm is the recommended package manager for Lepton projects.

### Docker resources across worktrees — shared infra, isolated apps

**Problem:** If each worktree runs `dx dev`, you'd get N copies of postgres, redis, etc. fighting for the same ports.

**Solution:** Shared infrastructure, isolated application servers.

```
Main worktree (or first dx dev invocation):
  postgres    → localhost:5432  (shared, one instance)
  redis       → localhost:6379  (shared, one instance)
  ory-kratos  → localhost:4433  (shared, one instance)

Worktree traf-142:
  api         → localhost:3001  (isolated, worktree-specific)
  frontend    → localhost:5174  (isolated, worktree-specific)

Worktree traf-305:
  api         → localhost:3002  (isolated, worktree-specific)
  frontend    → localhost:5175  (isolated, worktree-specific)
```

`dx dev` inside a worktree:

1. Checks if shared infra is already running → reuses if yes, starts if no
2. Starts app servers on auto-assigned ports (base port + worktree index)
3. Connects app to the shared postgres/redis

```bash
$ dx dev    # inside worktree traf-142

  ● Infrastructure (shared)
    ✓ postgres:16    → localhost:5432  (reusing, started by main worktree)
    ✓ redis:7        → localhost:6379  (reusing)
    ✓ ory-kratos     → localhost:4433  (reusing)

  ● Application (this worktree)
    ✓ api            → localhost:3001  (watching src/**)
    ✓ frontend       → localhost:5174  (watching src/**)

  Ready at http://localhost:5174
```

### Per-worktree database isolation

Each worktree gets its own database to prevent migration conflicts:

```
Main worktree:  DATABASE_URL=postgres://localhost:5432/my-product
traf-142:       DATABASE_URL=postgres://localhost:5432/my-product-traf-142
traf-305:       DATABASE_URL=postgres://localhost:5432/my-product-traf-305
```

All databases run in the same shared postgres instance (saving resources), but each has an independent schema. `dx dev` in a worktree auto-creates the database and runs migrations for that worktree's schema version.

`dx work done` drops the per-worktree database as part of cleanup.

### Port assignment strategy

Base ports are defined in `docker-compose.yaml`. Worktree ports are offset by worktree index:

```
Worktree 0 (main):   api:3000, frontend:5173
Worktree 1 (traf-142): api:3001, frontend:5174
Worktree 2 (traf-305): api:3002, frontend:5175
Worktree 3 (traf-306): api:3003, frontend:5176
```

If a port is already in use, dx auto-increments until it finds a free one. `dx work list` shows the assigned ports.

### Worktree detection

`dx dev` needs to know if it's running in a worktree or the main checkout. Git provides this:

```bash
git rev-parse --git-common-dir    # returns path to shared .git
git rev-parse --git-dir           # returns worktree-specific .git path

# If these differ → we're in a worktree
# If they're the same → we're in the main checkout
```

dx uses this to decide: start infra (main/first) vs. reuse infra (worktree).

---

## 5. PR Stacking

### The model

Break large features into reviewable chunks where each PR targets the previous one:

```
main
 └── traf-142/data-model         PR #1 (base: main)
      └── traf-142/api-endpoints  PR #2 (base: traf-142/data-model)
           └── traf-142/ui         PR #3 (base: traf-142/api-endpoints)
```

When PR #1 merges to main, GitHub auto-retargets PR #2 to main (native behavior with branch protection).

### `dx work stack "description"`

Creates a new branch based on the current branch (not main):

```bash
# Currently on traf-142/data-model
$ dx work stack "api endpoints"

  Creating stacked branch...
  Branch: traf-142/api-endpoints (based on traf-142/data-model)
  Worktree: ~/projects/my-product.worktrees/traf-142-api-endpoints/

  Stack:
    1. traf-142/data-model → main
    2. traf-142/api-endpoints → traf-142/data-model  ← you are here

  Stack metadata saved to .dx/local/stacks.yaml
```

### Stack metadata

Tracked locally (not checked in — stacks are per-developer):

```yaml
# .dx/local/stacks.yaml (gitignored)
traf-142:
  - branch: traf-142/data-model
    base: main
    pr: 47
  - branch: traf-142/api-endpoints
    base: traf-142/data-model
    pr: 48
  - branch: traf-142/ui
    base: traf-142/api-endpoints
    pr: 49
```

### `dx work stack status`

```bash
$ dx work stack status

  TRAF-142 stack:

  1. traf-142/data-model → main
     PR #47: ✓ approved, CI passing

  2. traf-142/api-endpoints → traf-142/data-model
     PR #48: review requested, CI passing
     ⚠ 2 commits behind base (needs restack)

  3. traf-142/ui → traf-142/api-endpoints
     PR #49: draft, CI passing
     ⚠ 2 commits behind base (needs restack)

  Run: dx work restack
```

### `dx work restack`

Rebases each branch in the stack onto its parent, in order:

```bash
$ dx work restack

  Restacking TRAF-142...

  1. traf-142/data-model: up to date with main ✓
  2. traf-142/api-endpoints: rebasing onto traf-142/data-model...
     ✓ 2 commits replayed cleanly
     ✓ Force-pushed (--force-with-lease)
  3. traf-142/ui: rebasing onto traf-142/api-endpoints...
     ✓ 1 commit replayed cleanly
     ✓ Force-pushed (--force-with-lease)

  Stack updated.
```

If conflicts occur during restack, dx drops into normal git rebase flow for that branch. After the developer resolves conflicts and continues the rebase, re-running `dx work restack` continues with the remaining branches.

### After a stacked PR merges

```bash
$ dx work restack

  PR #47 (traf-142/data-model) merged to main.
  → traf-142/api-endpoints: rebased onto main
  → PR #48: retargeted to main
  → traf-142/ui: rebased onto traf-142/api-endpoints
  ✓ Stack updated. traf-142/data-model branch deleted.
```

### `dx work pr` — stack-aware PR creation

When creating a PR from a stacked branch, dx auto-sets the base:

```bash
# On traf-142/api-endpoints (stacked on traf-142/data-model)
$ dx work pr

  Creating PR...
  Base: traf-142/data-model (from stack metadata)

  → gh pr create --base traf-142/data-model --fill

  PR #48 created.
  Stack metadata updated.
```

Without stack context, `dx work pr` defaults to `gh pr create --fill` (base: main).

---

## 6. Agent-Specific Workflows

### Starting agent work

```bash
dx work start TRAF-305 --agent
```

This creates a worktree like normal, but with additional agent-specific setup:

1. **Stricter quality gates:** The worktree's `.dx/local/agent-mode` flag tells `dx check` to use `--strict` mode
2. **Context injection:** The Jira ticket description is written to `.dx/local/ticket-context.md` in the worktree for agent reference
3. **No `--no-verify` leakage:** Agent context files (`.cursor/rules`, `.claude/settings.json`) don't mention the escape hatch

### What `--strict` mode adds to `dx check`

```bash
dx check --strict
# Everything in normal dx check, PLUS:
#   - Full test suite (not just --changed)
#   - Coverage threshold check (if configured)
#   - No TODO/FIXME/HACK allowed in changed files
#   - Lint with zero warnings (not just zero errors)
#   - All generated files up to date (dx generate --check)
```

The pre-push hook in agent worktrees runs `dx check --strict` instead of `dx check`. This is configured via the `.dx/local/agent-mode` flag, not via a different hook script (same hooks, behavior varies based on context).

### Multiple agents in parallel

```bash
# Developer kicks off multiple agent tasks
dx work start TRAF-305 --agent    # agent 1: search feature
dx work start TRAF-306 --agent    # agent 2: notification refactor
dx work start TRAF-307 --agent    # agent 3: test coverage

# Each gets:
#   - Own worktree (isolated files)
#   - Own branch (isolated commits)
#   - Own port allocation (isolated dev servers)
#   - Own database (isolated schema)
#   - Shared postgres/redis infrastructure

# Developer monitors:
dx work list

  TICKET    BRANCH                       MODE       WHO     COMMITS  PORTS      AGE
  TRAF-305  traf-305/add-search          worktree   agent   3        api:3002   4h
  TRAF-306  traf-306/refactor-notifs     worktree   agent   1        api:3003   2h
  TRAF-307  traf-307/increase-coverage   worktree   agent   5        —          1h
```

### Agent guard rails

The agent can't bypass conventions because:

1. **Hooks always run.** Agents use `git commit` and `git push`, which trigger hooks. Agents don't know about `--no-verify`.
2. **`dx check --strict`** is the pre-push gate in agent worktrees — higher bar than human worktrees.
3. **Branch naming is automatic.** `dx work start` generates the branch name from the ticket. The agent never names a branch.
4. **Commit messages are validated.** The `commit-msg` hook rejects non-conventional messages.

### Context files for agents

`dx work start --agent` writes additional context:

```markdown
# .dx/local/ticket-context.md (in the worktree, gitignored)

# Auto-generated by dx work start --agent

## TRAF-305: Add search endpoint

**Type:** Story
**Priority:** Medium
**Description:**
As a user, I want to search for products by name so that I can quickly find what I'm looking for.

**Acceptance criteria:**

- GET /api/v1/search?q=<query> returns matching products
- Results are paginated (default 20 per page)
- Search is case-insensitive
- Response time < 200ms for up to 1M products

**Related tickets:**

- TRAF-142: Search data model (merged)
- TRAF-306: Search UI (in progress)
```

The agent's context file (`.cursor/rules` or `.claude/settings.json`) can reference this file for task-specific context.

---

## 7. dx tunnel — Expose Local Ports (ngrok model)

### Design decision: why "tunnel" means "expose"

The industry standard (ngrok, cloudflared, localtunnel) uses "tunnel" to mean "make my local service accessible from the internet." When developers hear "tunnel," they think ngrok. dx matches this mental model.

### Command surface

```bash
dx tunnel <local-port>                          # expose local port publicly
dx tunnel <local-port> --name <subdomain>       # custom subdomain
dx tunnel list                                  # show active tunnels
dx tunnel close [id|--all]                      # close tunnels
```

### Behavior

```bash
$ dx tunnel 3000

  Tunnel open.
  Local:  http://localhost:3000
  Public: https://nikhil-3000.tunnel.factory.rio.software

  Press Ctrl+C to close.
```

```bash
$ dx tunnel 3000 --name demo

  Tunnel open.
  Local:  http://localhost:3000
  Public: https://demo.tunnel.factory.rio.software

  Press Ctrl+C to close.
```

### `dx tunnel list`

```bash
$ dx tunnel list

  ID    LOCAL    PUBLIC URL                                         AGE
  t1    :3000    https://nikhil-3000.tunnel.factory.rio.software    2h
  t2    :5173    https://nikhil-5173.tunnel.factory.rio.software    30m
```

### `dx tunnel close`

```bash
dx tunnel close t1          # close specific tunnel
dx tunnel close --all       # close all tunnels
```

### Use cases

- Show WIP to a teammate without deploying
- Test webhooks against local development server
- Mobile testing against local dev
- Demo to stakeholders during development

### Implementation note

The tunnel goes through the Factory relay infrastructure. The Factory API manages subdomain allocation, TLS termination, and connection routing. The dx client opens a persistent connection to the Factory relay and proxies traffic to the local port.

---

## 8. dx forward — Remote Port Forwarding

### Design decision: why "forward" not "tunnel"

"Forwarding" is what SSH calls this operation (`-L` is "local port forwarding"). It's the established term for "bring a remote port to my localhost." Keeping it separate from `dx tunnel` (which is expose) eliminates all ambiguity.

### Command surface

```bash
dx forward <host>:<port>                        # remote → localhost (same port)
dx forward <host>:<port> --as <local-port>      # remote → localhost (different port)
dx forward <host>:<port> <host>:<port> ...      # multiple ports in one command
dx forward list                                 # show active forwards
dx forward close [id|--all]                     # close forwards
```

### Behavior

```bash
$ dx forward staging:3000

  Forward open.
  Remote: staging:3000
  Local:  http://localhost:3000

  Press Ctrl+C to close.
```

```bash
$ dx forward staging:3000 --as 3100

  Forward open.
  Remote: staging:3000
  Local:  http://localhost:3100

  Press Ctrl+C to close.
```

### Multiple ports

```bash
$ dx forward staging:3000 staging:5432

  Forwards open.
  staging:3000 → localhost:3000 (API)
  staging:5432 → localhost:5432 (postgres)

  Press Ctrl+C to close all.
```

### Port conflict handling

```bash
$ dx forward staging:5432

  Port 5432 in use locally (postgres from dx dev).
  Auto-assigned: localhost:5433 → staging:5432

  Forward open.
  Connect with: psql -h localhost -p 5433 -U postgres

  Press Ctrl+C to close.
```

If `--as` is specified and that port is also in use, dx errors instead of auto-assigning (explicit request, explicit failure).

### `dx forward list`

```bash
$ dx forward list

  ID    REMOTE            LOCAL    STATUS
  f1    staging:3000      :3000    connected
  f2    staging:5432      :5433    connected
```

### Implementation note

Under the hood, `dx forward` is SSH local port forwarding (`ssh -L <local>:localhost:<remote> <host>`). The host name is resolved from the SSH config aliases written by `dx factory login`. The SSH connection uses the same defaults configured by `dx install` (ControlMaster, keepalive, etc.).

### Relationship to `dx db connect --target`

`dx db connect --target staging` internally uses the same port forwarding mechanism, but it's a higher-level command that:

1. Auto-detects the database service and port from `docker-compose.yaml`
2. Opens the forward
3. Launches the database client (psql/mysql/mongosh)
4. Closes the forward when the client exits

`dx forward` is the general-purpose primitive. `dx db connect --target` is the convenience command for the most common use case.

---

## 9. SSH Management (No Wrapper)

### Principle

dx NEVER wraps the `ssh` command. It configures SSH to work well and provides named host aliases. Developers use `ssh` directly for interactive access.

### What dx manages

| Concern             | dx command                | What it does                                                    |
| ------------------- | ------------------------- | --------------------------------------------------------------- |
| SSH defaults        | `dx install`              | Writes ControlMaster, keepalive, compression to `~/.ssh/config` |
| Host aliases        | `dx factory login`        | Writes name → IP mappings to SSH config                         |
| Host key management | `dx factory sync hosts`   | Clears stale entries from known_hosts                           |
| Manual host update  | `dx factory hosts update` | Updates single alias + clears host key                          |
| Key distribution    | `dx factory login`        | Future: short-lived certificates. Now: manual key management    |

### What developers do directly

```bash
ssh staging                     # works because dx factory login wrote the alias
ssh prod-1                      # same
ssh -L 9090:localhost:3000 staging  # power-user forwarding — use ssh directly
scp file.txt staging:/tmp/      # file copy — use scp directly
```

### SSH config structure (written by dx)

```
# ~/.ssh/config

# === Global defaults (written by dx install) ===
Host *
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
    ServerAliveInterval 60
    ServerAliveCountMax 3
    Compression yes
    AddKeysToAgent yes

# === dx-managed hosts (written by dx factory login) ===
# Regenerated on dx factory sync hosts

Host staging
    HostName 10.0.1.42
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
    UserKnownHostsFile ~/.ssh/known_hosts.d/dx-infra

Host prod-1
    HostName 10.0.1.43
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
    UserKnownHostsFile ~/.ssh/known_hosts.d/dx-infra

Host prod-2
    HostName 10.0.1.44
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
    UserKnownHostsFile ~/.ssh/known_hosts.d/dx-infra

Host runner
    HostName 192.168.5.17
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
    UserKnownHostsFile ~/.ssh/known_hosts.d/dx-infra
```

### Windows differences

- `ControlMaster` not supported on Windows OpenSSH — omitted
- Config file at `C:\Users\<user>\.ssh\config`
- `UserKnownHostsFile` path uses Windows path separator
- ssh-agent configured via `Set-Service ssh-agent -StartupType Automatic`

---

## 10. Known Hosts Strategy

### The problem

VMs on Proxmox with internal IPs get rebuilt. IPs get reassigned. SSH screams "REMOTE HOST IDENTIFICATION HAS CHANGED" and developers waste 15 minutes or blindly run `ssh-keygen -R`.

### The solution: scoped trust levels

```
GitHub, personal servers, public hosts:
    → Strict checking (the default)
    → Known hosts stored in ~/.ssh/known_hosts (normal file)

dx-managed infrastructure (internal IPs, Proxmox VMs):
    → StrictHostKeyChecking accept-new (trust on first connect, warn on change)
    → Known hosts stored in ~/.ssh/known_hosts.d/dx-infra (separate file)
```

Why `accept-new` instead of `no`:

- `accept-new` trusts a host on first connection (TOFU — trust on first use)
- But still **warns** if a key **changes** — this catches actual problems
- `no` would silently accept everything, including actual MITM (even on internal networks, it's good hygiene)

Why separate `UserKnownHostsFile`:

- When a VM is reprovisioned, `dx factory sync hosts` can delete `~/.ssh/known_hosts.d/dx-infra` without affecting GitHub, personal server keys, etc.
- Next SSH connection re-accepts (via `accept-new`)
- One command fixes all stale keys: `dx factory sync hosts`

### When the key-changed warning fires

Even with `accept-new`, if a host key changes (VM reprovisioned), SSH warns. The fix:

```bash
dx factory sync hosts
# Deletes ~/.ssh/known_hosts.d/dx-infra
# Updates SSH config with current IPs from Factory
# Next SSH connection re-accepts automatically
```

No need for `ssh-keygen -R <ip>`. No need to find which known_hosts file has the entry. One command, everything fixed.

### Future: SSH certificates

If/when the Factory implements a CA:

```
@cert-authority *.factory.rio.software ssh-ed25519 AAAA...factory-ca-key...
```

This eliminates known_hosts entirely for managed hosts — trust is based on the CA signature, not individual host keys. VMs can be rebuilt freely. But this requires:

- Factory CA infrastructure
- Host key signing during provisioning
- DNS for managed hosts (certificates work with hostnames, not bare IPs)

This is a "nice to have later" — the `accept-new` + separate known_hosts approach solves the practical problem now without any infrastructure changes.

---

## 11. Revised Command Surface

### Complete command list (original + addendum)

```bash
# === Machine setup (once per machine) ===
dx install                                          # git, docker, shell, SSH, editor defaults
dx self-update                                      # update dx binary

# === Factory (organization) ===
dx factory login [--ci]                             # authenticate, configure registries + SSH hosts
dx factory status                                   # auth status, token expiry
dx factory sync hosts                               # re-fetch host inventory, fix known_hosts
dx factory hosts list                               # show all managed hosts
dx factory hosts update <name> --ip <ip>            # manual host IP override

# === Project lifecycle ===
dx init <name>                                      # scaffold + repo + hooks + config + first push
dx upgrade [--check]                                # adopt latest template conventions
dx sync                                             # heal local state (usually automatic via hooks)
dx doctor                                           # diagnose environment problems

# === Work items & branching ===
dx work start <TICKET> [--agent|--no-worktree]      # create branch + worktree from ticket
dx work start --quick "description"                 # auto-create ticket + branch + worktree
dx work stack "description"                         # create stacked branch from current
dx work restack                                     # rebase entire PR stack
dx work stack status                                # show stack state
dx work list                                        # all active work items
dx work status                                      # current work item details
dx work switch <TICKET>                             # cd to worktree / checkout branch
dx work rebase                                      # rebase current branch onto main
dx work sync                                        # rebase + dx sync
dx work done [--all]                                # cleanup merged work items
dx work abandon <TICKET>                            # discard without merge
dx work pr [--draft]                                # create PR (stack-aware base)
dx work check-age                                   # CI: warn/error on stale branches

# === Local development ===
dx dev [--with <profile>]                           # start everything (infra + migrations + app)
dx dev stop                                         # tear down
dx dev reset                                        # nuke and rebuild
dx status                                           # what's running, health, environments
dx logs [service]                                   # tail logs

# === Quality ===
dx check [--strict]                                 # full quality pipeline
dx lint [--fix]                                     # auto-detected linter
dx typecheck                                        # auto-detected type checker
dx test [--watch|--changed|--integration|--e2e|--coverage|--all]
dx format                                           # auto-detected formatter

# === Database ===
dx db connect [--target <env>]                      # launch DB client (tunnel for remote)
dx db query "SQL" [--target <env>] [--json]         # run query
dx db migrate [--status|--down|--create <n>|--target <env>]
dx db seed                                          # auto-detected seeder
dx db studio                                        # launch DB browser UI

# === Codegen ===
dx generate                                         # run all detected generators

# === Networking ===
dx tunnel <local-port> [--name <subdomain>]         # expose local port (ngrok model)
dx tunnel list                                      # active tunnels
dx tunnel close [id|--all]                          # close tunnels
dx forward <host>:<port> [--as <local-port>]        # bring remote port to localhost
dx forward list                                     # active forwards
dx forward close [id|--all]                         # close forwards

# === Releases & deployment ===
dx release [major|minor|patch]                      # tag + gh release + trigger deploy
dx deploy preview                                   # force-trigger preview deploy
dx deploy prod                                      # deploy to production

# === Environments ===
dx env list                                         # all environments
dx env status [preview|staging|prod]                # environment health + version

# === Secrets ===
dx secret list                                      # available secrets
dx secret get <KEY> --target <env>                  # fetch from vault
dx secret set <KEY> --target <env>                  # set (opens $EDITOR)

# === Introspection ===
dx config [--json]                                  # detected tools, overrides, pipeline
dx config get [key]                                 # query specific config

# === Hooks (called by git, not by developers) ===
dx hook commit-msg <file>
dx hook pre-commit
dx hook pre-push
```

### Commands that DO NOT EXIST (use the real tool)

```bash
# Git — hooks enforce standards
git commit, git push, git pull, git rebase, git stash, etc.

# GitHub — dx init configures branch protection
gh pr create, gh pr merge, gh pr checks, gh pr review

# Docker — power-user operations
docker compose build, docker compose exec, docker compose run

# SSH — dx configures, developers use directly
ssh staging, scp, sftp
```

---

## 12. New package.json Config

### Updated `dx` key with work item configuration

```jsonc
{
  "dx": {
    "version": "2.4.0",
    "type": "service",
    "team": "platform",

    "conventions": {
      "commits": "conventional",
      "branching": "trunk",
    },

    "work": {
      "tracker": "jira", // jira | linear | github-issues
      "project": "TRAF", // default project for --quick ticket creation
      "branch_max_age_days": 7, // dx work check-age error threshold
      "branch_warn_age_days": 3, // dx work check-age warn threshold
      "agent_strict_checks": true, // use dx check --strict for agent worktrees
      "default_worktree": true, // dx work start creates worktree by default
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
}
```

### Config resolution

All `dx.work` settings have defaults:

| Setting                | Default                    | Description                                                    |
| ---------------------- | -------------------------- | -------------------------------------------------------------- |
| `tracker`              | `"jira"`                   | Work item tracker integration                                  |
| `project`              | auto-detect from repo name | Jira project key                                               |
| `branch_max_age_days`  | `7`                        | Error threshold in CI                                          |
| `branch_warn_age_days` | `3`                        | Warning threshold in CI                                        |
| `agent_strict_checks`  | `true`                     | Stricter quality for agent worktrees                           |
| `default_worktree`     | `true`                     | `dx work start` creates worktree (use `--no-worktree` to skip) |

---

## 13. Convention Enforcement Summary

### Complete enforcement matrix (original + new)

| Convention                           | Enforcement mechanism                                      | Who enforces           |
| ------------------------------------ | ---------------------------------------------------------- | ---------------------- |
| Commit messages (conventional)       | `commit-msg` hook → `dx hook commit-msg`                   | Git hook               |
| Code formatting                      | `pre-commit` hook → lint-staged                            | Git hook               |
| Quality gates before push            | `pre-push` hook → `dx check`                               | Git hook               |
| Stricter quality for agents          | `pre-push` hook → `dx check --strict` (in agent worktrees) | Git hook               |
| Branch naming (`<ticket>/<slug>`)    | `dx work start` generates it; `pre-push` validates         | dx + Git hook          |
| One branch per ticket                | `dx work start` checks for existing branch                 | dx                     |
| Short-lived branches                 | `dx work check-age` in CI (warn 3d, error 7d)              | CI                     |
| Squash merge only                    | GitHub branch protection (configured by `dx init`)         | GitHub                 |
| PR reviews required                  | GitHub branch protection (configured by `dx init`)         | GitHub                 |
| CI must pass before merge            | GitHub branch protection (configured by `dx init`)         | GitHub                 |
| PR has linked ticket                 | PR template + CI validation                                | Template + CI          |
| Stack integrity                      | `dx work restack` keeps stack coherent                     | Developer/dx           |
| Environment sync after branch change | `post-merge`/`post-checkout` hooks → `dx sync`             | Git hook               |
| Dependencies match lockfile          | `dx sync` runs install if lockfile changed                 | Git hook (via dx sync) |
| No secrets in git                    | `.gitignore` + `.env` generated at runtime                 | dx                     |
| Line endings (LF)                    | `.gitattributes` + `core.autocrlf`                         | Git config             |

---

## Appendix: Advanced Features (Outside Core Design Scope)

### `dx docker` — Remote Docker Proxy

`dx docker` is an advanced feature for proxying Docker commands to remote machines via SSH. It is already implemented (see BACKLOG Phase 8) but is outside the scope of the core dx CLI design. It serves a different use case from the commands in this document — remote Docker execution for deployment and machine management rather than local developer workflow.

Key commands: `dx docker <args> --on <slug>`, `dx docker compose <args> --on <slug>`, `dx docker connect <slug>`, `dx docker setup <slug>`.

This feature coexists with the core design. `dx forward` (SSH port forwarding) is the general-purpose primitive for bringing remote ports to localhost; `dx docker` is the specialized tool for remote Docker operations.

### `dx ssh` — SSH Wrapper

`dx ssh` wraps the SSH command with Factory's cascading machine resolver (Factory API → SSH config → local machines.json). While the core design philosophy says "dx NEVER wraps ssh," this command is already implemented and provides practical value for resolving Factory-managed hosts. It is a pragmatic exception to the design principle.

---

## Appendix: Implementation Priority

### Phase 1 — Foundation (build first)

1. `dx factory login` / `dx factory status` — auth is prerequisite for everything
2. `dx factory sync hosts` / `dx factory hosts` — SSH host management
3. `dx tunnel` — expose local ports (needs Factory relay infrastructure)
4. `dx forward` — SSH port forwarding (simpler, pure client-side)

### Phase 2 — Work items

1. `dx work start` (without worktree) — branch creation + Jira integration
2. `dx work start` (with worktree) — full worktree setup
3. `dx work list` / `dx work status` / `dx work switch`
4. `dx work done` / `dx work abandon` — cleanup
5. `dx work check-age` — CI integration

### Phase 3 — Stacking & agents

1. `dx work stack` / `dx work restack` / `dx work stack status`
2. `dx work start --agent` — agent-specific worktree setup
3. `dx check --strict` — agent quality gates
4. Per-worktree database isolation
5. Multi-worktree port management in `dx dev`

### Dependencies

```
dx factory login
  └── dx factory sync hosts (needs Factory API for host inventory)
  └── dx tunnel (needs Factory relay for public URLs)

dx work start
  └── Jira API integration (fetch ticket, update status)
  └── git worktree management
  └── pnpm (for fast worktree dependency setup)

dx work stack / restack
  └── dx work start (foundation)
  └── Stack metadata tracking (.dx/local/stacks.yaml)

dx check --strict
  └── dx check (foundation from original handoff)
  └── Agent-mode detection (.dx/local/agent-mode flag)
```
