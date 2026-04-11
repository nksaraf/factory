# dx forward

## Synopsis

```
dx forward <host>:<port> [<host>:<port> ...] [flags]
dx forward list
dx forward close [<id>] [--all]
```

## Description

Forward remote ports to localhost via SSH tunneling. Given a target in `host:port` format, `dx forward` resolves the host slug against Factory's entity registry (workspaces, VMs, registered hosts), establishes an SSH tunnel, and binds the remote port on a local port.

Multiple targets can be forwarded in a single invocation. If the requested local port is already in use, `dx forward` automatically selects the next available port. Use `--bg` to start the forward in the background — the CLI exits but the SSH process continues running.

## Subcommands

| Subcommand    | Description                                  |
| ------------- | -------------------------------------------- |
| `list`        | List all active port forwards and their PIDs |
| `close [id]`  | Close a specific forward by ID               |
| `close --all` | Close all active forwards                    |

## Flags (open)

| Flag          | Short | Type    | Description                                             |
| ------------- | ----- | ------- | ------------------------------------------------------- |
| `--as <port>` |       | number  | Bind to a specific local port (applies to first target) |
| `--user`      | `-l`  | string  | SSH user override                                       |
| `--identity`  | `-i`  | string  | Path to SSH identity file                               |
| `--bg`        |       | boolean | Run in background (CLI exits, forward stays open)       |

## Examples

```bash
# Forward a remote Postgres to localhost:5432
dx forward staging:5432

# Forward to a different local port
dx forward staging:5432 --as 15432

# Forward multiple ports in one command
dx forward staging:5432 staging:6379

# Forward in the background
dx forward staging:5432 --bg

# List active forwards
dx forward list

# Close a specific forward
dx forward close abc123

# Close all active forwards
dx forward close --all
```

## Related Commands

- [`dx tunnel`](/cli/tunnel) — Expose a local port to the internet (outbound)
- [`dx ssh`](/cli/ssh) — Open an interactive SSH session
- [`dx exec`](/cli/exec) — Run a command on a remote machine
