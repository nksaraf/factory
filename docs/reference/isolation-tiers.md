# Workspace Isolation Tiers

Factory workspaces support three isolation tiers, each offering a different tradeoff between resource efficiency and isolation.

## Tiers

| Tier | Shared | Isolated | Use case |
|------|--------|----------|----------|
| **Worktree** | Filesystem, Docker daemon, network | Git working tree, ports, compose project, `.dx/` state | Laptop development, parallel agents (Conductor) |
| **Container** | Docker daemon, host network (bridged) | Filesystem (except mounted source), process namespace | CI runners, heavier agent workloads |
| **VM** | Nothing | Everything | Production-like environments, untrusted code |

## Worktree Tier

The worktree tier uses **Git worktrees** to create isolated development environments on the same machine. Each worktree gets:

- Its own git working directory (separate branch, separate changes)
- Its own docker-compose project name (no container conflicts)
- Its own port allocations (`.dx/ports.json`)
- Its own `.dx/` runtime state

This is the lowest-overhead tier — no containers or VMs, just separate directories backed by the same git object database.

### Directory Layout (Conductor Convention)

```
~/conductor/
├── repos/<project>/              # Main .git directory (shared object database)
└── workspaces/<project>/
    ├── accra/                    # Worktree → branch A
    │   ├── .git                  # File pointing to main repo
    │   ├── .dx/                  # Ports, workbench, worktree.json
    │   ├── .context/             # Agent collaboration files
    │   └── (project files)
    ├── colombo/                  # Worktree → branch B
    └── ...
```

### Commands

```bash
# Create a worktree workspace (installs deps, allocates ports, sets up hooks)
dx workspace create my-feature --tier worktree --branch feat/my-feature

# List all workspaces (local worktrees + remote)
dx workspace list

# List only local worktree workspaces
dx workspace list --tier worktree

# Show details for a workspace
dx workspace show colombo

# Delete a worktree workspace (stops compose, removes worktree)
dx workspace delete my-feature

# Force delete even with uncommitted changes
dx workspace delete my-feature --force
```

### Configuration

Workspace paths can be configured in `~/.config/dx/config.json`:

```json
{
  "workspaceReposDir": "~/conductor/repos",
  "workspaceWorktreesDir": "~/conductor/workspaces"
}
```

Or via environment variables:
- `DX_REPOS_DIR` — base directory for main repo checkouts
- `DX_WORKTREES_DIR` — base directory for worktree workspaces

When not configured, the CLI auto-detects the Conductor layout from the current directory.

### Port Isolation

Each worktree gets its own `PortManager` instance backed by `<worktree>/.dx/ports.json`. Ports are allocated independently, so two worktrees running `dx up` simultaneously will get different host ports with no conflicts.

The docker-compose project name defaults to `basename(worktreeDir)` (e.g., `colombo`, `accra`), ensuring container names don't collide.

### Discovery

`dx workspace list --tier worktree` discovers **all** existing git worktrees for the current project, including ones created outside of `dx` (e.g., by Conductor directly, or manually via `git worktree add`). No migration step is required.

## Container Tier

Container-based workspaces run inside Kubernetes pods via the Factory API. They provide filesystem and process isolation while sharing the host's Docker daemon.

```bash
dx workspace create my-ws
dx workspace create my-ws --type container --cpu 2 --memory 4Gi
```

See `dx workspace --help` for the full set of remote workspace commands (start, stop, resize, snapshot, etc.).

## VM Tier

VM-based workspaces provide full machine isolation. Used for production-like environments or running untrusted code.

```bash
dx workspace create my-ws --type vm
```
