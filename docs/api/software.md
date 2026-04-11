# Software API

The `software` domain is the catalog of what your organization builds and ships. It models software in Backstage-aligned vocabulary: **Systems** (product boundaries), **Components** (deployable units), **APIs** (service contracts), **Artifacts** (built outputs like container images), **Releases** (versioned bundles), and **Templates** (scaffold blueprints).

**Base prefix:** `/api/v1/factory/software`

## Endpoints

| Method   | Path                | Description                   |
| -------- | ------------------- | ----------------------------- |
| `GET`    | `/systems`          | List all systems              |
| `GET`    | `/systems/:slug`    | Get a system by slug          |
| `POST`   | `/systems`          | Create a system               |
| `PATCH`  | `/systems/:slug`    | Update a system               |
| `DELETE` | `/systems/:slug`    | Delete a system               |
| `GET`    | `/components`       | List all components           |
| `GET`    | `/components/:slug` | Get a component by slug       |
| `POST`   | `/components`       | Create a component            |
| `PATCH`  | `/components/:slug` | Update a component            |
| `DELETE` | `/components/:slug` | Delete a component            |
| `GET`    | `/apis`             | List all API definitions      |
| `GET`    | `/apis/:slug`       | Get an API definition by slug |
| `POST`   | `/apis`             | Create an API definition      |
| `PATCH`  | `/apis/:slug`       | Update an API definition      |
| `DELETE` | `/apis/:slug`       | Delete an API definition      |
| `GET`    | `/artifacts`        | List all artifacts            |
| `GET`    | `/artifacts/:slug`  | Get an artifact by slug       |
| `POST`   | `/artifacts`        | Register an artifact          |
| `PATCH`  | `/artifacts/:slug`  | Update artifact metadata      |
| `DELETE` | `/artifacts/:slug`  | Delete an artifact record     |
| `GET`    | `/releases`         | List all releases             |
| `GET`    | `/releases/:slug`   | Get a release by slug         |
| `POST`   | `/releases`         | Create a release              |
| `PATCH`  | `/releases/:slug`   | Update a release              |
| `DELETE` | `/releases/:slug`   | Delete a release              |
| `GET`    | `/templates`        | List all scaffold templates   |
| `GET`    | `/templates/:slug`  | Get a template by slug        |
| `POST`   | `/templates`        | Register a template           |
| `PATCH`  | `/templates/:slug`  | Update a template             |
| `DELETE` | `/templates/:slug`  | Delete a template             |

## Query Parameters

All list endpoints accept:

| Parameter   | Type   | Description                                               |
| ----------- | ------ | --------------------------------------------------------- |
| `search`    | string | Full-text search across name, slug, spec, and tags        |
| `limit`     | number | Max results (default: 50, max: 500)                       |
| `offset`    | number | Pagination offset                                         |
| `lifecycle` | string | `experimental`, `development`, `production`, `deprecated` |

Additional per-resource filters:

| Endpoint      | Extra Parameters                                           |
| ------------- | ---------------------------------------------------------- |
| `/systems`    | `teamId` — filter by owning team                           |
| `/components` | `systemId`, `type` (e.g., `service`, `library`, `website`) |
| `/apis`       | `componentId`, `type` (e.g., `openapi`, `grpc`, `graphql`) |
| `/artifacts`  | `componentId`, `type` (e.g., `container`, `npm`, `binary`) |
| `/releases`   | `systemId`, `status`                                       |
| `/templates`  | `type` (e.g., `service`, `library`, `workflow`)            |

## Examples

### List systems

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://factory.example.com/api/v1/factory/software/systems?lifecycle=production"
```

```json
{
  "data": [
    {
      "id": "sys_01hx4k9p2m",
      "slug": "factory-api",
      "name": "Factory API",
      "spec": {
        "lifecycle": "production",
        "description": "Core platform API — org, infra, ops, build, commerce domains",
        "ownerTeamId": "team_01hx4k9p00",
        "tags": ["platform", "api"],
        "links": [
          {
            "url": "https://docs.factory.example.com",
            "title": "Docs",
            "type": "documentation"
          }
        ]
      },
      "metadata": {
        "labels": { "backstage.io/domain": "platform" },
        "annotations": { "github.com/project-slug": "example/factory" }
      },
      "createdAt": "2025-01-10T08:00:00Z",
      "updatedAt": "2026-04-01T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 7 }
}
```

### Create a system

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-platform",
    "name": "Payments Platform",
    "spec": {
      "lifecycle": "production",
      "description": "Handles billing, subscriptions, and payment processing",
      "ownerTeamId": "team_01hxcommerce",
      "tags": ["payments", "billing"],
      "links": [
        { "url": "https://internal.example.com/payments-runbook", "title": "Runbook", "type": "runbook" }
      ]
    }
  }' \
  "https://factory.example.com/api/v1/factory/software/systems"
```

### Create a component

Components are the individual deployable units that belong to a system. The `spec` follows the catalog component spec — the same JSONB fields that drive `docker-compose` generation and Helm chart rendering.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-api",
    "name": "Payments API",
    "type": "service",
    "systemId": "sys_01hxpayments",
    "spec": {
      "lifecycle": "production",
      "description": "REST API for payment processing",
      "image": "ghcr.io/example/payments-api",
      "ports": [
        { "name": "http", "port": 3000, "protocol": "http", "exposure": "internal" }
      ],
      "healthchecks": {
        "live": { "http": { "path": "/healthz", "port": "http" } },
        "ready": { "http": { "path": "/ready", "port": "http" } }
      },
      "compute": {
        "min": { "cpu": "100m", "memory": "256Mi" },
        "max": { "cpu": "500m", "memory": "512Mi" }
      },
      "routes": [
        { "host": "payments.example.com", "path": "/api/payments", "pathMatch": "prefix" }
      ]
    }
  }' \
  "https://factory.example.com/api/v1/factory/software/components"
```

### Register an artifact (container image)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-api-v1.4.2",
    "name": "payments-api:v1.4.2",
    "type": "container",
    "componentId": "comp_01hxpayapi",
    "spec": {
      "image": "ghcr.io/example/payments-api:v1.4.2",
      "digest": "sha256:abc123def456",
      "builtAt": "2026-04-10T12:00:00Z",
      "gitSha": "a1b2c3d4",
      "gitRef": "refs/tags/v1.4.2",
      "labels": {
        "org.opencontainers.image.source": "https://github.com/example/payments-api"
      }
    }
  }' \
  "https://factory.example.com/api/v1/factory/software/artifacts"
```

### Create a release

Releases bundle multiple artifact versions together for coordinated deployment across a system.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "payments-platform-v2.1.0",
    "name": "Payments Platform v2.1.0",
    "systemId": "sys_01hxpayments",
    "spec": {
      "version": "2.1.0",
      "status": "stable",
      "changelog": "Add recurring billing support, fix webhook retry logic",
      "artifacts": [
        { "componentId": "comp_01hxpayapi", "artifactId": "art_01hxpayapiv142" },
        { "componentId": "comp_01hxpayworker", "artifactId": "art_01hxpayworkv112" }
      ],
      "releasedAt": "2026-04-10T16:00:00Z"
    }
  }' \
  "https://factory.example.com/api/v1/factory/software/releases"
```

### Create a template

Templates are scaffold blueprints used by `dx new` to bootstrap new services.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "typescript-service",
    "name": "TypeScript Service",
    "type": "service",
    "spec": {
      "description": "Batteries-included TypeScript + Express service with Docker, dx config, and CI",
      "repoUrl": "https://github.com/example/template-typescript-service",
      "lifecycle": "production",
      "tags": ["typescript", "express", "service"],
      "parameters": [
        { "name": "serviceName", "description": "Name of the new service", "required": true },
        { "name": "port", "description": "HTTP port", "default": "3000" }
      ]
    }
  }' \
  "https://factory.example.com/api/v1/factory/software/templates"
```

## CLI equivalent

```bash
dx catalog systems list --json
dx catalog components list --system payments-platform --json
dx catalog artifacts list --component payments-api --json
dx catalog releases get payments-platform-v2.1.0 --json
```
