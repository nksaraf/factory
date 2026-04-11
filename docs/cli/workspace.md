# dx workspace

## Synopsis

```
dx workspace list [flags]
dx workspace create [name] [flags]
dx workspace show <name>
dx workspace delete <name>
```

## Description

Manage developer workspaces — isolated environments for coding, testing, and running services. Workspaces exist at multiple tiers: `worktree` (local git worktree), `container` (Docker/k8s container), and `vm` (full virtual machine).

`dx workspace create` is interactive when no name is given — it prompts for size, repo, and branch. In CI or non-TTY environments, provide all required flags explicitly. Workspaces are backed by Factory's fleet system and can be accessed via SSH, web terminal, or your editor's remote extension (see `dx open`).

## Subcommands

| Subcommand      | Description                                |
| --------------- | ------------------------------------------ |
| `list`          | List workspaces (local worktrees + remote) |
| `create [name]` | Create a workspace                         |
| `show <name>`   | Show workspace details                     |
| `delete <name>` | Delete a workspace                         |

## Flags

### `create`

| Flag             | Type    | Description                                         |
| ---------------- | ------- | --------------------------------------------------- |
| `--tier`         | string  | Isolation tier: `worktree`, `container`, `vm`       |
| `--type`         | string  | Runtime type: `container`, `vm`                     |
| `--template`     | string  | Workspace template slug                             |
| `--size`         | string  | Size preset: `small`, `medium`, `large`, `xlarge`   |
| `--ttl`          | number  | TTL in minutes                                      |
| `--cpu`          | string  | CPU spec (e.g. `"2"`)                               |
| `--memory`       | string  | Memory spec (e.g. `"4Gi"`)                          |
| `--storage`      | number  | PVC size in GB                                      |
| `--repo`         | string  | Repo URL to clone into the workspace                |
| `--branch`       | string  | Branch name (worktree tier) or repo branch          |
| `--path`         | string  | Directory path override (worktree tier)             |
| `--skip-install` | boolean | Skip dependency install (worktree tier)             |
| `--cluster`      | string  | Cluster ID to deploy to (auto-selects if omitted)   |
| `--wait` / `-w`  | boolean | Wait for workspace to become active (default: true) |
| `--force`        | boolean | Skip branch validation or force deletion            |

### `list`

| Flag        | Short | Type    | Description                                   |
| ----------- | ----- | ------- | --------------------------------------------- |
| `--tier`    |       | string  | Filter by tier: `worktree`, `container`, `vm` |
| `--all`     | `-a`  | boolean | Include stopped/destroyed workspaces          |
| `--status`  | `-s`  | string  | Filter by status                              |
| `--runtime` |       | string  | Filter by runtime: `container`, `vm`          |
| `--sort`    |       | string  | Sort by: `name`, `status`, `created`          |
| `--limit`   | `-n`  | number  | Limit results (default: 50)                   |
| `--project` | `-p`  | string  | Filter worktrees by project                   |

## Examples

```bash
# List all workspaces (local worktrees + remote)
dx workspace list

# List only local worktrees
dx workspace list --tier worktree

# Create a local worktree workspace
dx workspace create my-feature --tier worktree --branch my-feature

# Create a remote container workspace (interactive)
dx workspace create my-workspace

# Create a medium-sized remote workspace
dx workspace create dev-env --size medium --repo https://github.com/org/repo

# Show workspace details
dx workspace show my-workspace

# Delete a workspace
dx workspace delete my-workspace

# Machine-readable output
dx workspace list --json
```

## Related Commands

- [`dx open`](/cli/open) — Open a workspace in your editor or terminal
- [`dx exec`](/cli/exec) — Run a command inside a workspace
- [`dx ssh`](/cli/ssh) — SSH into a workspace interactively
- [`dx cluster`](/cli/cluster) — Manage the clusters that host workspaces
