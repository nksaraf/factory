# dx dev

## Synopsis

```
dx dev [components...] [flags]
dx dev <subcommand> [args] [flags]
```

## Description

`dx dev` starts native dev servers (with hot reload) for your project's components. It reads the `dx.dev.command` label from each service in `docker-compose.yaml` to know how to start each component, stops the corresponding Docker container to free the port, and launches the native process instead.

`dx dev` also supports **hybrid dev mode**: you can connect local dev servers to remote or staging dependencies using `--connect-to` or `--connect`. This stops the remote dependency containers, rewrites their connection env vars to point to the remote target, and runs a TCP health check before starting dev servers.

## Subcommands

| Subcommand            | Description                                  |
| --------------------- | -------------------------------------------- |
| `start <component>`   | Start a single component's dev server        |
| `stop [component]`    | Stop one or all dev servers                  |
| `restart <component>` | Restart a dev server                         |
| `ps`                  | List running dev servers with ports and PIDs |
| `logs <component>`    | Show dev server log output                   |

## Flags

| Flag                     | Short | Description                                                                                  |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------- |
| `--connect-to <target>`  |       | Connect all service dependencies to a named deployment target (e.g. `production`, `staging`) |
| `--connect <dep:target>` | `-c`  | Connect a specific dependency to a target. Repeatable.                                       |
| `--profile <name>`       | `-p`  | Load a saved connection profile from `.dx/profiles/`                                         |
| `--env <KEY=VALUE>`      | `-e`  | Override an env var. Repeatable. Wins over all other sources.                                |

### `dev logs` flags

| Flag       | Short | Description                                      |
| ---------- | ----- | ------------------------------------------------ |
| `--follow` | `-f`  | Stream log output in real time (`tail -f` style) |

### `dev start` flags

| Flag         | Description                          |
| ------------ | ------------------------------------ |
| `--port <n>` | Override the port for this component |

## Examples

```bash
# Start all dev servers
dx dev

# Start only the API component
dx dev factory-api

# Start with all deps connected to the production environment
dx dev --connect-to production

# Start with a saved connection profile
dx dev --profile staging

# Connect just the database to staging, everything else local
dx dev --connect postgres:staging

# Stop all running dev servers
dx dev stop

# Check what's running
dx dev ps

# Tail logs for a component
dx dev logs factory-api --follow
```

## Related Commands

- [`dx up`](./up.md) — Start the full Docker Compose stack
- [`dx down`](./down.md) — Stop the stack
- [`dx logs`](./logs.md) — View Docker service logs
- [`dx status`](./status.md) — Check environment health
