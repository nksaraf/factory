# Database Workflows

dx manages database connections, queries, and migrations automatically.

## Connecting

```bash
dx db connect              # Open interactive psql/mysql shell
dx db connect --resource postgres  # Connect to a specific resource
```

dx reads connection info from docker-compose resource definitions — no manual URL management.

## Quick Queries

```bash
dx db query --sql "SELECT * FROM users LIMIT 5"
dx db query --sql "SELECT count(*) FROM orders" --json
```

## Migrations

```bash
dx db migrate status       # Check pending migrations
dx db migrate up           # Apply pending migrations
dx db migrate down         # Rollback last migration
```

::: warning
Never write migration SQL by hand. Use `drizzle-kit generate` (via `pnpm db:generate` in the api workspace) to produce migrations from schema changes in `api/src/db/schema/*.ts`.
:::

### Migration Workflow

1. Edit schema in `api/src/db/schema/*.ts`
2. Run `pnpm db:generate` in `api/` to generate migration SQL
3. Run `dx db migrate up` to apply
4. Commit the migration file with your schema changes

Migration files live in `api/drizzle/`, tracked by `api/drizzle/meta/_journal.json`. Never edit journal or snapshot files directly.

## Connection Resolution

dx resolves database connections through this chain:

1. Docker-compose resource labels and environment variables
2. `.env` files in the project
3. Connection profiles (for remote databases)
4. System environment variables

## Related

- [Local Development](/guides/local-development)
- [Architecture: Connection Contexts](/architecture/connection-contexts)
