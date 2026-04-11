# dx status

## Synopsis

```
dx status [flags]
```

## Description

`dx status` reports the health of the current `dx` context. It checks API connectivity, git hook installation, project configuration, and running service state — giving you a quick overview before you start debugging.

Run `dx status` first whenever the environment seems broken or you're onboarding to a new workstation. It surfaces missing dependencies, misconfigured connections, and stale state.

## Flags

| Flag        | Description                       |
| ----------- | --------------------------------- |
| `--json`    | Emit machine-readable JSON output |
| `--verbose` | Show additional detail            |
| `--quiet`   | Suppress non-error output         |

## Examples

```bash
# Check environment health
dx status

# Machine-readable output (useful in scripts and CI)
dx status --json
```

## Related Commands

- [`dx up`](./up.md) — Start the Docker Compose stack
- [`dx dev`](./dev.md) — Start dev servers
- [`dx logs`](./logs.md) — View service logs
- [`dx sync`](./index.md) — Heal local state (hooks, deps, codegen, env)
