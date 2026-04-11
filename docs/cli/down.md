# dx down

## Synopsis

```
dx down [flags]
```

## Description

`dx down` stops the Docker Compose stack for the current project. By default it stops and removes containers and networks but preserves named volumes (database data, cache state, etc.).

To do a full clean reset — removing all volumes so the next `dx up` starts from a blank slate — use `--volumes`. This is the standard approach when you need to wipe the database and re-run migrations and seeds.

## Flags

| Flag        | Short | Description                                            |
| ----------- | ----- | ------------------------------------------------------ |
| `--volumes` | `-v`  | Also remove named volumes declared in the compose file |
| `--verbose` |       | Print resolved profiles and compose file paths         |
| `--json`    |       | Emit machine-readable JSON output                      |

## Examples

```bash
# Stop all services (preserves volumes)
dx down

# Stop all services and remove all volumes (clean reset)
dx down --volumes

# See what compose files and profiles are being used
dx down --verbose
```

::: warning
`dx down --volumes` is destructive — it deletes all database data and any other named volume contents. Use it when you want a clean environment, not just a quick restart.
:::

## Related Commands

- [`dx up`](./up.md) — Start the stack back up
- [`dx dev`](./dev.md) — Start dev servers after `dx up`
- [`dx db`](./db.md) — Manage databases (migrate, seed, backup)
- [`dx status`](./status.md) — Check environment health
