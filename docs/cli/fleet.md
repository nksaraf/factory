# dx fleet

## Synopsis

```
dx fleet discover --on <host> [flags]
dx fleet import --on <host> [flags]
dx fleet sync --on <host> [flags]
```

## Description

Discover, import, and sync Docker Compose stacks across hosts. `dx fleet` connects to a remote machine via SSH, discovers all running Compose projects, and can import them into Factory as fully modeled entities (sites, systems, deployments, components).

The typical workflow is: `discover` to see what's running, `import --dry-run` to preview the entity plan, then `import` to create everything in Factory. After the initial import, run `sync` periodically to detect drift — stacks that have been added, removed, or changed on the host without corresponding Factory updates.

## Subcommands

| Subcommand | Description                                                               |
| ---------- | ------------------------------------------------------------------------- |
| `discover` | SSH into a host and list all Compose projects and their containers        |
| `import`   | Build an entity plan and create sites, systems, and components in Factory |
| `sync`     | Compare live Compose state against Factory records and report drift       |

## Flags

### `discover` / `sync`

| Flag          | Type   | Description                    |
| ------------- | ------ | ------------------------------ |
| `--on <host>` | string | Target machine slug (required) |
| `--user`      | string | Override SSH user              |

### `import`

| Flag          | Type    | Description                                       |
| ------------- | ------- | ------------------------------------------------- |
| `--on <host>` | string  | Target machine slug (required)                    |
| `--user`      | string  | Override SSH user                                 |
| `--dry-run`   | boolean | Preview the entity plan without creating anything |
| `--site`      | string  | Site name prefix to use when creating sites       |

## Examples

```bash
# Discover all Compose stacks on a host
dx fleet discover --on lepton-59

# Preview what would be imported
dx fleet import --on lepton-59 --dry-run

# Import all stacks into Factory
dx fleet import --on lepton-59

# Import with a custom site prefix
dx fleet import --on lepton-59 --site acme-prod

# Check for drift after making changes on the host
dx fleet sync --on lepton-59

# Machine-readable output for any subcommand
dx fleet discover --on lepton-59 --json
```

## Related Commands

- [`dx infra`](/cli/infra) — Manage hosts, estates, and realms
- [`dx scan`](/cli/scan) — Scan infrastructure and sync IDE sessions to Factory
- [`dx workspace`](/cli/workspace) — Manage developer workspaces
