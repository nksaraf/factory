# dx route

## Synopsis

```
dx route list [flags]
dx route create --domain <domain> --target <service> [flags]
dx route delete <id>
dx route trace <domain>
```

## Description

Manage gateway routes in Factory. Routes map external domains (or path prefixes) to internal services. Factory's gateway (Traefik/APISIX) reads these routes to route inbound traffic to the correct service.

Use `dx route trace` to follow a domain through the gateway and visualize each hop in the routing chain — useful for diagnosing 404s or misrouted traffic.

## Subcommands

| Subcommand       | Description                                         |
| ---------------- | --------------------------------------------------- |
| `list`           | List all routes with optional filters               |
| `create`         | Create a new route                                  |
| `delete <id>`    | Delete a route by ID                                |
| `trace <domain>` | Trace network path for a domain through the gateway |

## Flags

### `list`

| Flag       | Short | Type   | Description                                                                  |
| ---------- | ----- | ------ | ---------------------------------------------------------------------------- |
| `--kind`   |       | string | Filter by kind: `workspace`, `tunnel`, `preview`, `ingress`, `custom_domain` |
| `--site`   |       | string | Filter by site ID                                                            |
| `--status` | `-s`  | string | Filter by status                                                             |
| `--sort`   |       | string | Sort by: `domain`, `kind`, `status` (default: `domain`)                      |
| `--limit`  | `-n`  | number | Limit results (default: 50)                                                  |

### `create`

| Flag         | Type   | Description                              |
| ------------ | ------ | ---------------------------------------- |
| `--domain`   | string | Route domain (required)                  |
| `--target`   | string | Target service name (required)           |
| `--port`     | number | Target port                              |
| `--kind`     | string | Route kind: `ingress`, `workspace`, etc. |
| `--site`     | string | Site ID                                  |
| `--path`     | string | Path prefix                              |
| `--protocol` | string | Protocol: `http`, `grpc`, `tcp`          |

## Examples

```bash
# List all routes
dx route list

# Filter by kind
dx route list --kind workspace

# Create a route for a service
dx route create --domain api.example.com --target my-api --port 8080

# Create with a path prefix
dx route create --domain example.com --target my-api --port 8080 --path /api

# Trace a domain to diagnose routing
dx route trace factory.lepton.software

# Delete a route
dx route delete <route-id>

# Machine-readable output
dx route list --json
```

## Related Commands

- [`dx tunnel`](/cli/tunnel) — Expose a local port via a Factory tunnel
- [`dx infra`](/cli/infra) — Manage the infrastructure backing your routes
- [`dx catalog`](/cli/catalog) — View service catalog metadata
