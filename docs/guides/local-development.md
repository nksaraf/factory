# Local Development

Deep dive into the `dx up` and `dx dev` workflow.

## Starting Infrastructure

```bash
dx up                      # Bring up all docker-compose services
dx up infra                # Bring up only infrastructure (postgres, redis, etc.)
dx up postgres redis       # Bring up specific services
dx up --no-build           # Skip building local services
```

### What `dx up` Does

1. Reads your `docker-compose.yaml` (or `compose/` directory)
2. Classifies services as Components (have `build:`) or Resources (just `image:`)
3. Allocates ports via the port manager (avoids conflicts)
4. Generates `.dx/ports.env` with port environment variables
5. Runs `docker compose up` with the right flags

### Port Management

dx allocates ports automatically to avoid conflicts between projects. Port assignments are stored in `.dx/ports.json` and exported as environment variables in `.dx/ports.env`.

```bash
# Generated .dx/ports.env
API_PORT=8080
POSTGRES_PORT=5432
REDIS_PORT=6379
```

## Starting Dev Servers

```bash
dx dev                     # Start all component dev servers
dx dev api                 # Start specific components
dx dev --connect-to prod   # Connect to production dependencies
dx dev --profile staging   # Use a saved connection profile
dx dev stop                # Stop all dev servers
dx dev ps                  # Show running dev servers
```

### What `dx dev` Does

1. **Pre-flight sync**: installs git hooks, checks deps, runs codegen
2. **Reads catalog**: finds components with `dx.dev.command` labels
3. **Resolves connections**: builds connection strings for databases and services
4. **Starts dev servers**: runs each component's dev command with injected env vars

### Connection Profiles

By default, `dx dev` connects to local Docker resources. You can override this:

```bash
# Connect to remote dependencies
dx dev --connect-to production

# Use a saved profile
dx dev --profile staging
```

Connection profiles are stored in the project and define which databases/services to connect to.

## Health Checks

```bash
dx status                  # Quick health check
dx status --json           # Structured output for agents
```

Checks: API reachability, running services, git state, port allocations.

## Debugging

```bash
dx logs api                # Tail container logs for API
dx logs --follow           # Follow all container logs
dx exec api sh             # Shell into a container
```

## Resetting

```bash
dx down                    # Stop services (data persists in volumes)
dx down --volumes          # Stop + delete volumes (clean slate)
dx sync                    # Re-heal local state (hooks, deps, codegen)
```

::: warning
Use `dx down --volumes` (not just `dx down`) when you need a clean reset. Without `--volumes`, database data persists and can cause stale state issues.
:::

## Related

- [Core Workflow](/getting-started/core-workflow)
- [Testing](/guides/testing)
- [Database Workflows](/guides/database-workflows)
