# Secrets & Configuration

## Environment Variables

```bash
dx env list                # Show env vars for a component
dx env set KEY=value       # Set an env var
dx env unset KEY           # Remove an env var
```

## Connection Contexts

dx resolves database URLs and service endpoints automatically from compose definitions. No manual URL management needed.

Resolution order:

1. Docker-compose labels and environment
2. `.env` files
3. Connection profiles
4. System environment variables

## Connection Profiles

Named configs for different environments:

```bash
dx dev --connect-to production   # Use production deps
dx dev --profile staging         # Use saved profile
```

## For AI Agents

```bash
export DX_TOKEN=your-jwt-token   # API authentication
```

## Related

- [Local Development](/guides/local-development)
- [Database Workflows](/guides/database-workflows)
- [Architecture: Connection Contexts](/architecture/connection-contexts)
