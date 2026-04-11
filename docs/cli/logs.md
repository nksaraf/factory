# dx logs

## Synopsis

```
dx logs [module] [component] [flags]
```

## Description

`dx logs` streams or fetches logs from local Docker Compose services or from remote Factory-managed environments. When running inside a project directory, it defaults to local Docker logs. When remote flags (`--site`, `--workspace`, `--build`, `--rollout`) are provided, or when a named service is not running locally, it falls back to the Factory observability API.

In follow mode (`--follow`), local logs are streamed via the Docker daemon and remote logs are polled using a cursor.

## Flags

| Flag                  | Short | Description                                                         |
| --------------------- | ----- | ------------------------------------------------------------------- |
| `--follow`            | `-f`  | Stream logs in real time                                            |
| `--since <time>`      |       | Start time: ISO-8601 timestamp or duration (`5m`, `1h`)             |
| `--until <time>`      |       | End time: ISO-8601 or duration                                      |
| `--around <time>`     |       | Center timestamp for a windowed query                               |
| `--window <duration>` |       | Window size around `--around` (default: `5m`)                       |
| `--level <levels>`    |       | Filter by level: `error`, `warn`, `info`, `debug` (comma-separated) |
| `--grep <text>`       |       | Text search filter                                                  |
| `--site <name>`       |       | Fetch logs from a specific site                                     |
| `--workspace <slug>`  |       | Fetch logs from a specific workspace                                |
| `--build <id>`        |       | Fetch logs for a specific build                                     |
| `--rollout <id>`      |       | Fetch logs for a specific deployment rollout                        |
| `--unit <name>`       |       | Filter by systemd unit (for infra/host logs)                        |
| `--limit <n>`         |       | Maximum number of entries to return                                 |
| `--tail <n>`          |       | Show only the last N lines (local Docker only)                      |
| `--json`              |       | Emit log entries as newline-delimited JSON                          |

## Examples

```bash
# Stream live logs from all local services
dx logs --follow

# Show only error logs from the last hour
dx logs --level error --since 1h

# Search logs for a specific string
dx logs --grep "connection refused"

# Tail logs from a specific service
dx logs api --follow

# Show logs around a specific timestamp (5-minute window)
dx logs --around "2026-04-11T14:30:00Z"

# Fetch logs for a specific build
dx logs --build bld_abc123

# Fetch logs for a rollout
dx logs --rollout rol_xyz789

# Fetch logs from a site
dx logs --site my-site --level error

# Machine-readable JSON output
dx logs --follow --json
```

## Related Commands

- [`dx dev logs`](./dev.md) — View dev server (native process) logs
- [`dx status`](./status.md) — Check environment health
- [`dx up`](./up.md) — Start the Docker Compose stack
- [`dx preview logs`](./preview.md) — View preview deployment logs
