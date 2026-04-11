# dx db

## Synopsis

```
dx db <subcommand> [args] [flags]
```

## Description

`dx db` provides database tooling for your project. It auto-detects the database from the catalog (sourced from `docker-compose.yaml` labels) and supports interactive shells, ad-hoc queries, schema inspection, migration management, backups, and restores.

When `--target` is a remote environment, `dx db` automatically creates an SSH tunnel to forward the database port to localhost so you can use the same commands against any environment.

## Subcommands

| Subcommand              | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `connect`               | Open an interactive database shell (psql, etc.)     |
| `query`                 | Execute a SQL query                                 |
| `table`                 | List tables with row counts and sizes               |
| `schema`                | Describe table columns, types, and defaults         |
| `index`                 | List indexes with usage statistics                  |
| `constraint`            | List foreign keys, checks, and unique constraints   |
| `sequence`              | List sequences and their current values             |
| `extension`             | List installed database extensions                  |
| `activity`              | Show active connections and running queries         |
| `lock`                  | Show lock contention between queries                |
| `long-queries`          | Show queries running longer than a threshold        |
| `migrate status`        | Show applied and pending migrations                 |
| `migrate up`            | Run pending migrations                              |
| `migrate create <name>` | Create a new migration                              |
| `migrate plan`          | Show SQL that would run without applying            |
| `reset`                 | Drop and recreate the database, then run migrations |
| `seed`                  | Load seed data from the `seeds/` directory          |
| `backup create`         | Create a database backup                            |
| `backup list`           | List available backups                              |
| `backup delete <name>`  | Delete a backup                                     |
| `restore`               | Restore the database from a backup                  |

## Shared Flags

These flags are accepted by most `dx db` subcommands:

| Flag             | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `--db <name>`    | Database dependency name (when the project has multiple databases)     |
| `--target <env>` | Target environment: `local`, `staging`, `production`, or any host slug |

## Subcommand Flags

### `db query`

| Flag              | Short | Description                        |
| ----------------- | ----- | ---------------------------------- |
| `--sql <query>`   | `-s`  | SQL to execute inline              |
| `--file <path>`   | `-f`  | Read SQL from a file               |
| `--readonly`      |       | Execute in a read-only transaction |
| `--tenant <name>` |       | Set RLS tenant context             |

### `db table` / `db schema`

| Flag              | Short | Description                                 |
| ----------------- | ----- | ------------------------------------------- |
| `--filter <glob>` |       | Glob filter for table names (e.g. `order*`) |
| `--table <name>`  | `-t`  | Specific table for `db schema`              |

### `db index`

| Flag       | Description                                       |
| ---------- | ------------------------------------------------- |
| `--unused` | Show only unused indexes (candidates for removal) |

### `db long-queries`

| Flag                    | Description                            |
| ----------------------- | -------------------------------------- |
| `--threshold <seconds>` | Minimum duration to show (default: 5s) |
| `--kill <pid>`          | Kill a query by PID                    |

### `db reset`

| Flag                   | Description                          |
| ---------------------- | ------------------------------------ |
| `--seed` / `--no-seed` | Run seed after reset (default: true) |
| `--force`              | Confirm the destructive operation    |

### `db seed`

| Flag               | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `--fixture <name>` | Named fixture from `seeds/` directory (default: `default`) |

### `db backup create`

| Flag            | Short | Description                               |
| --------------- | ----- | ----------------------------------------- |
| `--name <name>` | `-n`  | Backup name (default: `<db>-<timestamp>`) |

### `db restore`

| Flag            | Short | Description                         |
| --------------- | ----- | ----------------------------------- |
| `--name <name>` | `-n`  | Backup name to restore              |
| `--file <path>` | `-f`  | Restore from an arbitrary dump file |
| `--clean`       |       | Drop all schemas before restoring   |
| `--force`       |       | Confirm the destructive operation   |

## Examples

```bash
# Open an interactive psql shell
dx db connect

# Connect to staging via SSH tunnel
dx db connect --target staging

# Run a quick query
dx db query --sql "SELECT count(*) FROM users"

# Run SQL from a file
dx db query --file ./scripts/report.sql

# Inspect table sizes
dx db table

# Describe a specific table's columns
dx db schema --table users

# Check for unused indexes
dx db index --unused

# View active connections
dx db activity

# Check migration status
dx db migrate status

# Apply pending migrations
dx db migrate up

# Create a new named migration
dx db migrate create add-user-roles

# Reset the database and run migrations
dx db reset --force

# Load default seed data
dx db seed

# Load a specific fixture
dx db seed --fixture demo-data

# Create a named backup before a risky operation
dx db backup create --name before-migration

# List available backups
dx db backup list

# Restore from a backup
dx db restore --name before-migration --force

# Restore with a clean slate (drops all schemas first)
dx db restore --name before-migration --clean --force
```

## Related Commands

- [`dx ssh`](./ssh.md) — SSH into a machine (used for remote DB tunnels)
- [`dx up`](./up.md) — Start the database container
- [`dx down`](./down.md) — Stop the stack (`--volumes` to wipe database data)
