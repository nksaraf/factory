# Workbench isolation tiers

Factory **workbenches** support three isolation tiers, each offering a different tradeoff between resource efficiency and isolation.

## Tiers

| Tier          | Shared                                | Isolated                                               | Use case                                        |
| ------------- | ------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **Worktree**  | Filesystem, Docker daemon, network    | Git working tree, ports, compose project, `.dx/` state | Laptop development, parallel agents (Conductor) |
| **Container** | Docker daemon, host network (bridged) | Filesystem (except mounted source), process namespace  | CI runners, heavier agent workloads             |
| **VM**        | Nothing                               | Everything                                             | Production-like environments, untrusted code    |

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
# Create a worktree workbench (installs deps, allocates ports, sets up hooks)
dx workbench create my-feature --tier worktree --branch feat/my-feature

# List all workbenches (local worktrees + remote)
dx workbench list

# List only local worktree workbenches
dx workbench list --tier worktree

# Show details for a workbench
dx workbench show colombo

# Delete a worktree workbench (stops compose, removes worktree)
dx workbench delete my-feature

# Force delete even with uncommitted changes
dx workbench delete my-feature --force
```

### Configuration

Conductor-style repo and worktree base paths can be configured in `~/.config/dx/config.json`:

```json
{
  "workbenchReposDir": "~/conductor/repos",
  "workbenchWorktreesDir": "~/conductor/workspaces"
}
```

Or via environment variables:

- `DX_REPOS_DIR` — base directory for main repo checkouts
- `DX_WORKTREES_DIR` — base directory for worktree checkouts

When not configured, the CLI auto-detects the Conductor layout from the current directory.

### Port Isolation

Each worktree gets its own `PortManager` instance backed by `<worktree>/.dx/ports.json`. Ports are allocated independently, so two worktrees running `dx up` simultaneously will get different host ports with no conflicts.

The docker-compose project name defaults to `basename(worktreeDir)` (e.g., `colombo`, `accra`), ensuring container names don't collide.

### Discovery

`dx workbench list --tier worktree` discovers **all** existing git worktrees for the current project, including ones created outside of `dx` (e.g., by Conductor directly, or manually via `git worktree add`). No migration step is required.

## Container Tier

Container-based workbenches run inside Kubernetes pods via the Factory API. They provide filesystem and process isolation while sharing the host's Docker daemon.

```bash
dx workbench create my-ws
dx workbench create my-ws --type container --cpu 2 --memory 4Gi
```

See `dx workbench --help` for the full set of remote workbench commands (start, stop, resize, snapshot, etc.).

## VM Tier

VM-based workbenches provide full machine isolation. Used for production-like environments or running untrusted code.

```bash
dx workbench create my-ws --type vm
```
