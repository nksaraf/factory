# dx scan

## Synopsis

```
dx scan [target] [flags]
```

## Description

Scan IDE sessions and infrastructure hosts, syncing the results to Factory. Without a target, `dx scan` runs all enabled scanners: the IDE scanner (Claude Code, Conductor, Cursor sessions) and the local infra scanner.

Pass a specific target to narrow the scan — either an IDE source name (`claude-code`, `conductor`, `cursor`) or a host slug registered in Factory for an infra scan. Use `--deep` to spider-crawl: after scanning the named host, Factory auto-discovers backend hosts referenced by that host's services and scans them too.

## Flags

| Flag               | Type    | Description                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------- |
| `--scanner <type>` | string  | Scanner to run: `ide`, `infra`, or `all` (default: `all`)                       |
| `--since <date>`   | string  | Only sync IDE sessions after this date (ISO format, e.g. `2026-04-01`)          |
| `--dry-run`        | boolean | Print scan results to stdout instead of sending to Factory                      |
| `--limit <n>`      | string  | Maximum number of events to send (IDE scanner only)                             |
| `--deep`           | boolean | Spider-crawl: auto-register discovered backend hosts and submit their scan data |

## Examples

```bash
# Scan everything (IDE sessions + local infra)
dx scan

# Scan IDE sources only
dx scan --scanner ide

# Scan local infra only
dx scan --scanner infra

# Scan a specific remote host
dx scan web01

# Scan a remote host and all its discovered backends
dx scan web01 --deep

# Sync only Claude Code sessions
dx scan claude-code

# Preview what would be sent (dry run)
dx scan --dry-run

# Only sync sessions from after a date
dx scan claude-code --since 2026-04-01

# Machine-readable output
dx scan --json
```

## Related Commands

- [`dx fleet`](/cli/fleet) — Discover and import Compose stacks from hosts
- [`dx infra`](/cli/infra) — Manage registered infrastructure entities
- [`dx status`](/cli/status) — Check environment and connection health
