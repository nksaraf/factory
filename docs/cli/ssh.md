# dx ssh

## Synopsis

```
dx ssh [target] [flags]
dx ssh [target] -- <remote command>
dx ssh <subcommand> [args] [flags]
```

## Description

`dx ssh` resolves a machine by slug (workspace, host, or VM) and opens an SSH session. If no target is given, it presents an interactive picker. Targets can be workspaces, registered hosts, or any entity in the Factory infra catalog.

`dx ssh` also handles kubectl-based transport for Kubernetes workspaces — it uses `kubectl exec` instead of SSH when the entity's transport is `kubectl`.

The `config sync` subcommand writes `~/.ssh/config` entries for all accessible machines, enabling plain `ssh <slug>` without going through `dx`.

## Subcommands

| Subcommand         | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `config sync`      | Generate `~/.ssh/config` entries for all accessible machines |
| `keys list`        | List registered SSH keys                                     |
| `keys add`         | Register an SSH public key                                   |
| `keys revoke <id>` | Revoke an SSH key                                            |
| `keys remove <id>` | Remove an SSH key                                            |
| `keys init`        | Generate a new SSH keypair and register it                   |

## Flags

### `dx ssh <target>`

| Flag                | Short | Description               |
| ------------------- | ----- | ------------------------- |
| `--user <name>`     | `-l`  | Override the SSH username |
| `--port <n>`        | `-p`  | Override the SSH port     |
| `--identity <path>` | `-i`  | Path to private key file  |

### `config sync`

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--dry-run`     | Print generated config to stdout instead of writing |
| `--file <path>` | Target SSH config file (default: `~/.ssh/config`)   |

### `keys add`

| Flag                  | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `--name <name>`       | Key name, e.g. `laptop` or `workstation` (required)        |
| `--file <path>`       | Path to public key file (default: `~/.ssh/id_ed25519.pub`) |
| `--principal-id <id>` | Principal ID (auto-detected from current user if omitted)  |

### `keys init`

| Flag                  | Description                                   |
| --------------------- | --------------------------------------------- |
| `--name <name>`       | Key name (default: hostname)                  |
| `--type <type>`       | Key type: `ed25519` (default), `rsa`, `ecdsa` |
| `--principal-id <id>` | Principal ID (auto-detected if omitted)       |

## Examples

```bash
# SSH into a machine by slug
dx ssh my-workspace

# SSH with a custom user
dx ssh build-host-3 --user ubuntu

# Run a remote command without an interactive shell
dx ssh dev-vm -- systemctl status factory-api

# Interactive picker (when no target is given)
dx ssh

# Generate ~/.ssh/config for all accessible machines
dx ssh config sync

# Preview the config without writing it
dx ssh config sync --dry-run

# List registered SSH keys
dx ssh keys list

# Register your default public key
dx ssh keys add --name laptop

# Generate a new keypair and register it
dx ssh keys init

# Register a specific public key file
dx ssh keys add --name workstation --file ~/.ssh/id_ed25519.pub

# Revoke a key by ID
dx ssh keys revoke key_abc123
```

## Related Commands

- [`dx db`](./db.md) — Database operations (uses SSH tunnels for remote targets)
- [`dx logs`](./logs.md) — View service logs
- [`dx status`](./status.md) — Check environment health
