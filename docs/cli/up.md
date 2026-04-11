# dx up

## Synopsis

```
dx up [targets...] [flags]
```

## Description

`dx up` starts the Docker Compose stack for the current project. It resolves all service ports through the port manager, writes a `.dx/ports.env` file, and launches containers in detached mode by default.

If no targets are provided, all profiles defined in the project catalog are started. You can pass profile names or individual service names as targets — `dx` distinguishes between them automatically.

## Flags

| Flag                       | Default | Description                                                                          |
| -------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `--build` / `--no-build`   | `true`  | Build local service images before starting. Use `--no-build` to skip the build step. |
| `--detach` / `--no-detach` | `true`  | Run containers in the background. Pass `--no-detach` to attach to stdout.            |
| `--verbose`                | `false` | Print resolved profiles, services, and compose file paths.                           |
| `--json`                   | `false` | Emit machine-readable JSON output.                                                   |
| `--quiet`                  | `false` | Suppress informational output including the port table.                              |

## Examples

```bash
# Bring up all services (all profiles)
dx up

# Bring up a specific profile
dx up infra

# Bring up specific services by name
dx up postgres redis

# Skip building images (faster when code hasn't changed)
dx up --no-build

# Start with verbose output to see resolved ports and compose files
dx up --verbose
```

## Related Commands

- [`dx down`](./down.md) — Stop the stack
- [`dx dev`](./dev.md) — Start dev servers with hot reload
- [`dx status`](./status.md) — Check environment health
- [`dx logs`](./logs.md) — View service logs
