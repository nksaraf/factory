# dx deploy

## Synopsis

```
dx deploy <subcommand> [args] [flags]
```

## Description

`dx deploy` manages deployment rollouts — the process of delivering a release to a deployment target. A rollout ties a release ID to a system deployment target and tracks progress through the deployment pipeline.

Use `dx release` to create and promote releases, then `dx deploy create` to roll them out to specific targets.

## Subcommands

| Subcommand            | Description                     |
| --------------------- | ------------------------------- |
| `create <release-id>` | Create a new deployment rollout |
| `status <id>`         | Show the status of a rollout    |
| `list`                | List all rollouts               |

## Flags

### `deploy create`

| Flag            | Short | Description                     |
| --------------- | ----- | ------------------------------- |
| `--target <id>` | `-t`  | Deployment target ID (required) |
| `--json`        |       | Emit machine-readable output    |

### `deploy list`

| Flag                | Short | Description                               |
| ------------------- | ----- | ----------------------------------------- |
| `--status <status>` | `-s`  | Filter rollouts by status                 |
| `--limit <n>`       | `-n`  | Limit the number of results (default: 50) |
| `--json`            |       | Emit machine-readable output              |

## Examples

```bash
# List all deployments
dx deploy list

# List only active deployments
dx deploy list --status active

# Create a rollout for a release to a specific target
dx deploy create rel_abc123 --target tgt_xyz789

# Check the status of a rollout
dx deploy status rol_def456

# Machine-readable output for scripting
dx deploy list --json
```

## Related Commands

- [`dx release`](./release.md) — Create and promote releases
- [`dx preview`](./preview.md) — PR preview environments
- [`dx build`](./build.md) — Build Docker images
