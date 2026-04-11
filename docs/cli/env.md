# dx env

## Synopsis

```
dx env resolve [flags]
```

## Description

Resolve and display environment variables for the current project. `dx env resolve` reads the project catalog, applies connection overrides (pointing a dependency at a different deployment target), merges tier/profile overlays, and prints the resolved set of variables.

This is the source of truth for what environment variables a service would receive at runtime. Use `--export` to get shell-eval compatible output for sourcing into your terminal. Use `--scope` to fetch org-, team-, or project-level secrets from Factory's secret store.

## Subcommands

| Subcommand | Description                               |
| ---------- | ----------------------------------------- |
| `resolve`  | Resolve and display environment variables |

## Flags (resolve)

| Flag                     | Short | Type    | Description                                                      |
| ------------------------ | ----- | ------- | ---------------------------------------------------------------- |
| `--connect-to <target>`  |       | string  | Point all dependencies at a single deployment target             |
| `--connect <dep:target>` | `-c`  | string  | Selective connection override (repeatable, format: `dep:target`) |
| `--profile`              | `-p`  | string  | Named connection profile to load                                 |
| `--env <KEY=VALUE>`      | `-e`  | string  | Ad-hoc env var override (repeatable)                             |
| `--export`               |       | boolean | Output in `export KEY=VALUE` format (shell-eval compatible)      |
| `--scope`                |       | string  | Fetch vars from Factory: `org`, `team`, `project`, `system`      |
| `--team`                 |       | string  | Team slug (used with `--scope team`)                             |
| `--project`              |       | string  | Project slug (used with `--scope project`)                       |

## Examples

```bash
# Show resolved env vars for the current project
dx env resolve

# Export as shell vars (eval-safe)
dx env resolve --export

# Point all deps at a staging target
dx env resolve --connect-to staging

# Override a single dependency
dx env resolve --connect postgres:staging-db

# Load a named connection profile
dx env resolve --profile staging

# Source into the current shell
eval "$(dx env resolve --export)"

# Fetch org-level secrets
dx env resolve --scope org

# Fetch team secrets
dx env resolve --scope team --team platform

# Machine-readable JSON output
dx env resolve --json
```

## Related Commands

- [`dx catalog`](/cli/catalog) — View the catalog that drives env var resolution
- [`dx dev`](/cli/dev) — Start dev servers with env vars auto-injected
- [`dx up`](/cli/up) — Start infrastructure with environment applied
