# dx cluster

## Synopsis

```
dx cluster list [flags]
dx cluster create [name] [flags]
dx cluster delete <name> [flags]
dx cluster status <name> [flags]
```

## Description

Manage Kubernetes clusters registered in Factory. Clusters are modeled as realms — execution environments that can host workspaces and deployments.

For local development, `dx cluster create --local` spins up a [k3d](https://k3d.io) cluster and registers it in Factory automatically. Remote cluster management goes through the Factory API.

## Subcommands

| Subcommand      | Description                                     |
| --------------- | ----------------------------------------------- |
| `list`          | List all clusters (local k3d or remote via API) |
| `create [name]` | Create a cluster                                |
| `delete <name>` | Delete a cluster                                |
| `status <name>` | Show cluster status and node details            |

## Flags

### `create`

| Flag      | Type    | Description                                           |
| --------- | ------- | ----------------------------------------------------- |
| `--local` | boolean | Create a local k3d cluster (default name: `dx-local`) |

### `delete`

| Flag      | Type    | Description                  |
| --------- | ------- | ---------------------------- |
| `--local` | boolean | Delete the local k3d cluster |

### `status`

| Flag      | Type    | Description                         |
| --------- | ------- | ----------------------------------- |
| `--local` | boolean | Show status for a local k3d cluster |
| `--json`  | boolean | Output as JSON                      |

### `list`

| Flag      | Type    | Description                  |
| --------- | ------- | ---------------------------- |
| `--local` | boolean | List local k3d clusters only |
| `--json`  | boolean | Output as JSON               |

## Examples

```bash
# List all clusters
dx cluster list

# List local k3d clusters only
dx cluster list --local

# Create a local k3d cluster (named dx-local)
dx cluster create --local

# Create a named local cluster
dx cluster create my-cluster --local

# Check cluster status
dx cluster status dx-local --local

# Delete a local cluster
dx cluster delete dx-local --local

# Machine-readable output
dx cluster list --json
```

## Related Commands

- [`dx infra`](/cli/infra) — Manage estates, realms, and hosts
- [`dx workbench`](/cli/workbench) — Deploy workbenches to a cluster
- [`dx infra realm`](/cli/infra) — Realms are the underlying model for clusters
