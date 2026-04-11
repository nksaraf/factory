# dx preview

## Synopsis

```
dx preview <subcommand> [args] [flags]
```

## Description

`dx preview` manages ephemeral preview environments for branches and pull requests. Each preview gets a unique slug and a public URL (`https://<slug>.preview.<domain>`). Previews are created from the current git branch by default and can be set to expire automatically.

Previews support three auth modes: `public` (open), `team` (factory org required), and `private` (explicit access list).

## Subcommands

| Subcommand       | Description                                        |
| ---------------- | -------------------------------------------------- |
| `deploy`         | Deploy a preview from the current branch           |
| `list`           | List active previews                               |
| `show <slug>`    | Show detailed info for a preview                   |
| `status`         | Show previews for the current git branch           |
| `wait <slug>`    | Wait (with polling) for a preview to become active |
| `extend <slug>`  | Extend the TTL of a preview                        |
| `destroy <slug>` | Tear down a preview environment                    |
| `open <slug>`    | Open a preview URL in the browser                  |
| `logs <slug>`    | Show deployment logs for a preview                 |

## Flags

### `preview deploy`

| Flag                   | Short | Description                                                 |
| ---------------------- | ----- | ----------------------------------------------------------- |
| `--branch <name>`      | `-b`  | Source branch (default: current branch)                     |
| `--repo <url>`         |       | Repository URL (default: auto-detected from git remote)     |
| `--pr <number>`        |       | Associate with a PR number                                  |
| `--site <name>`        |       | Site name for the preview                                   |
| `--site-id <id>`       |       | Site ID                                                     |
| `--cluster-id <id>`    |       | Target cluster ID                                           |
| `--owner-id <id>`      |       | Owner ID                                                    |
| `--image <ref>`        | `-i`  | Pre-built container image (skips the build step)            |
| `--auth <mode>`        |       | Auth mode: `public`, `team`, or `private` (default: `team`) |
| `--ttl <duration>`     |       | Expiry duration, e.g. `7d`, `24h`                           |
| `--wait` / `--no-wait` | `-w`  | Wait for the preview to become active (default: true)       |

### `preview list`

| Flag                | Short | Description                           |
| ------------------- | ----- | ------------------------------------- |
| `--all`             | `-a`  | Include expired and inactive previews |
| `--status <status>` | `-s`  | Filter by status                      |
| `--branch <name>`   |       | Filter by source branch               |
| `--repo <url>`      |       | Filter by repository                  |
| `--site-id <id>`    |       | Filter by site                        |

### `preview extend`

| Flag         | Short | Description                           |
| ------------ | ----- | ------------------------------------- |
| `--days <n>` | `-d`  | Number of days to extend (default: 7) |

### `preview wait`

| Flag                  | Short | Description                             |
| --------------------- | ----- | --------------------------------------- |
| `--timeout <seconds>` | `-t`  | Max wait time in seconds (default: 300) |

## Examples

```bash
# Deploy a preview from the current branch (waits until active)
dx preview deploy

# Deploy from a specific branch, don't wait
dx preview deploy --branch feature/my-thing --no-wait

# Deploy a pre-built image (no build step)
dx preview deploy --image ghcr.io/my-org/my-app:sha-abc1234

# List all active previews
dx preview list

# List all previews including expired ones
dx preview list --all

# Show previews for the current git branch
dx preview status

# Show full details for a preview
dx preview show preview-feature-my-thing

# Open a preview in the browser
dx preview open preview-feature-my-thing

# Extend a preview's expiry by 14 days
dx preview extend preview-feature-my-thing --days 14

# Tear down a preview
dx preview destroy preview-feature-my-thing
```

## Related Commands

- [`dx deploy`](./deploy.md) — Production deployment rollouts
- [`dx release`](./release.md) — Versioned releases
- [`dx logs`](./logs.md) — View logs from a preview
