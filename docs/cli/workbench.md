# dx workbench

## Synopsis

```
dx workbench list [flags]
dx workbench create [name] [flags]
dx workbench show <name>
dx workbench delete <name>
```

## Description

Manage developer **workbenches** — isolated environments for coding, testing, and running services. Workbenches exist at multiple isolation tiers: `worktree` (local git worktree), `container` (Docker/k8s container), and `vm` (full virtual machine).

`dx workbench create` is interactive when no name is given — it prompts for size, repo, and branch. In CI or non-TTY environments, provide all required flags explicitly. Remote workbenches are backed by Factory's fleet system and can be accessed via SSH, web terminal, or your editor's remote extension (see `dx open`).

## Subcommands

| Subcommand      | Description                                 |
| --------------- | ------------------------------------------- |
| `list`          | List workbenches (local worktrees + remote) |
| `create [name]` | Create a workbench                          |
| `show <name>`   | Show workbench details                      |
| `delete <name>` | Delete a workbench                          |

## Flags

### `create`

| Flag             | Type    | Description                                         |
| ---------------- | ------- | --------------------------------------------------- |
| `--tier`         | string  | Isolation tier: `worktree`, `container`, `vm`       |
| `--type`         | string  | Provisioner type: `container`, `vm`                 |
| `--template`     | string  | Workbench template slug                             |
| `--size`         | string  | Size preset: `small`, `medium`, `large`, `xlarge`   |
| `--ttl`          | number  | TTL in minutes                                      |
| `--cpu`          | string  | CPU spec (e.g., `"2"`)                              |
| `--memory`       | string  | Memory spec (e.g., `"4Gi"`)                         |
| `--storage`      | number  | PVC size in GB                                      |
| `--repo`         | string  | Repo URL to clone into the workbench                |
| `--branch`       | string  | Branch name (worktree tier) or repo branch          |
| `--path`         | string  | Directory path override (worktree tier)             |
| `--skip-install` | boolean | Skip dependency install (worktree tier)             |
| `--cluster`      | string  | Cluster ID to deploy to (auto-selects if omitted)   |
| `--wait` / `-w`  | boolean | Wait for workbench to become active (default: true) |
| `--force`        | boolean | Skip branch validation or force deletion            |

### `list`

| Flag        | Short | Type    | Description                                   |
| ----------- | ----- | ------- | --------------------------------------------- |
| `--tier`    |       | string  | Filter by tier: `worktree`, `container`, `vm` |
| `--all`     | `-a`  | boolean | Include stopped/destroyed workbenches         |
| `--status`  | `-s`  | string  | Filter by status                              |
| `--runtime` |       | string  | Filter by provisioner: `container`, `vm`      |
| `--sort`    |       | string  | Sort by: `name`, `status`, `created`          |
| `--limit`   | `-n`  | number  | Limit results (default: 50)                   |
| `--project` | `-p`  | string  | Filter worktrees by project                   |

## Examples

```bash
# List all workbenches (local worktrees + remote)
dx workbench list

# List only local worktrees
dx workbench list --tier worktree

# Create a local worktree workbench
dx workbench create my-feature --tier worktree --branch my-feature

# Create a remote container workbench (interactive)
dx workbench create my-env

# Create a medium-sized remote workbench
dx workbench create dev-env --size medium --repo https://github.com/org/repo

# Show workbench details
dx workbench show my-env

# Delete a workbench
dx workbench delete my-env

# Machine-readable output
dx workbench list --json
```

## Related Commands

- [`dx open`](/cli/open) — Open a workbench in your editor or terminal
- [`dx exec`](/cli/exec) — Run a command inside a workbench
- [`dx ssh`](/cli/ssh) — SSH into a workbench interactively
- [`dx cluster`](/cli/cluster) — Manage the clusters that host workbenches
