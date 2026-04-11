# dx catalog

## Synopsis

```
dx catalog [flags]
dx catalog info <name>
dx catalog tree [flags]
dx catalog status
dx catalog sync [flags]
dx catalog doctor [flags]
```

## Description

Browse, inspect, and manage the software catalog for the current project. The catalog is automatically detected from `docker-compose.yaml` labels, `catalog-info.yaml` (Backstage format), or `Chart.yaml` (Helm). The detection priority is: docker-compose > backstage > helm.

The catalog models every service, resource (database, cache, queue), and API as a typed entity with lifecycle, ownership, and dependency metadata. Use `dx catalog tree` to visualize the full dependency graph, or `dx catalog doctor` to diagnose and fix missing labels in your `docker-compose.yaml`.

## Subcommands

| Subcommand    | Description                                             |
| ------------- | ------------------------------------------------------- |
| _(root)_      | List all catalog entries (components, resources, APIs)  |
| `info <name>` | Show full details for a component or resource           |
| `tree`        | Show the dependency tree with optional filters          |
| `status`      | Show active catalog source, detected formats, and drift |
| `sync`        | Push the local catalog to Factory                       |
| `doctor`      | Diagnose and interactively fix missing catalog labels   |

## Flags

### `tree`

| Flag                  | Type    | Description                                           |
| --------------------- | ------- | ----------------------------------------------------- |
| `--reverse <service>` | string  | Show what depends on a service (blast radius)         |
| `--focus <service>`   | string  | Show only a service and its dependency chain          |
| `--layers`            | boolean | Group by topological level (startup parallelism)      |
| `--startup-order`     | boolean | Flat numbered list in dependency-first startup order  |
| `--mermaid`           | boolean | Output Mermaid graph syntax                           |
| `--open`              | boolean | Render Mermaid diagram and open in browser            |
| `--show-init`         | boolean | Show init/migration containers (collapsed by default) |

### `doctor`

| Flag        | Short | Type    | Description                                            |
| ----------- | ----- | ------- | ------------------------------------------------------ |
| `--fix`     |       | boolean | Interactively add missing labels                       |
| `--yes`     | `-y`  | boolean | Accept all defaults without prompting                  |
| `--file`    | `-f`  | string  | Path to docker-compose file (auto-detected if omitted) |
| `--service` | `-s`  | string  | Only diagnose/fix a specific service                   |

### `sync`

| Flag        | Short | Type    | Description                                         |
| ----------- | ----- | ------- | --------------------------------------------------- |
| `--dry-run` | `-d`  | boolean | Preview what would be synced without making changes |

## Examples

```bash
# List all catalog entries
dx catalog

# Show details for a specific service
dx catalog info api

# Show the full dependency tree
dx catalog tree

# What breaks if postgres goes down?
dx catalog tree --reverse infra-postgres

# Show startup parallelism layers
dx catalog tree --layers

# Focus on a single service and its chain
dx catalog tree --focus infra-factory

# Generate a Mermaid diagram and open in browser
dx catalog tree --mermaid --open

# Check catalog health
dx catalog status

# Diagnose missing labels
dx catalog doctor

# Auto-fix with defaults (no prompts)
dx catalog doctor --fix --yes

# Sync local catalog to Factory
dx catalog sync

# Preview sync without changes
dx catalog sync --dry-run
```

## Related Commands

- [`dx fleet`](/cli/fleet) — Discover Compose stacks and import them as catalog entities
- [`dx route`](/cli/route) — Manage gateway routes for catalog services
- [`dx env`](/cli/env) — Resolve environment variables using catalog metadata
