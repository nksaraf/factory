# dx build

## Synopsis

```
dx build [components...] [flags]
```

## Description

`dx build` builds Docker images for your project's components. It reads each component's build context and Dockerfile path from the catalog (sourced from `docker-compose.yaml` labels), then runs `docker build` with a deterministic tag of the form `<project>-<component>:latest`.

If no component names are given, all components with a build context are built. Components without a `build` spec are skipped with an error if explicitly named.

## Flags

| Flag        | Description                                             |
| ----------- | ------------------------------------------------------- |
| `--verbose` | Print the full `docker build` command before running it |
| `--json`    | Emit machine-readable success/failure output            |

## Examples

```bash
# Build all components
dx build

# Build a specific component
dx build api

# Build multiple components
dx build api worker

# See the exact docker build command being run
dx build --verbose
```

## Related Commands

- [`dx up`](./up.md) — Start the stack (also builds by default)
- [`dx deploy`](./deploy.md) — Deploy a release to a target
- [`dx release`](./release.md) — Manage versioned releases
