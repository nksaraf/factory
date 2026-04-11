# dx exec

## Synopsis

```
dx exec <target> [flags] -- <command> [args...]
```

## Description

Run a command on a remote machine — a workspace, VM, or registered host. The target is resolved by slug through the entity registry, and the appropriate transport (SSH or `kubectl exec`) is selected automatically.

If no command is provided after `--`, an interactive shell (`/bin/bash`) is opened. For Kubernetes targets, `dx exec` uses `kubectl exec` directly; for SSH-based targets, it opens an SSH session.

## Flags

| Flag          | Short | Type    | Description                                           |
| ------------- | ----- | ------- | ----------------------------------------------------- |
| `--container` | `-c`  | string  | Container name for k8s targets (default: `workspace`) |
| `--context`   |       | string  | kubectl context override (k8s targets only)           |
| `--dir`       |       | string  | Working directory on the remote machine               |
| `--sudo`      |       | boolean | Run command with sudo                                 |
| `--user`      | `-l`  | string  | Override SSH user                                     |

## Examples

```bash
# Open an interactive shell in a workspace
dx exec my-workspace -- /bin/bash

# Run a one-off command on a VM
dx exec my-vm -- docker ps

# Run a build in a specific directory
dx exec my-vm --dir /app -- make build

# Run with sudo
dx exec staging-host --sudo -- systemctl restart nginx

# Target a specific k8s container
dx exec my-workspace --container workspace -- ls /home
```

## Related Commands

- [`dx ssh`](/cli/ssh) — Interactive SSH picker with fuzzy search
- [`dx forward`](/cli/forward) — Port forward from a remote host to localhost
- [`dx run`](/cli/run) — Run scripts and recipes on remote machines
- [`dx workbench`](/cli/workbench) — Manage workbenches
