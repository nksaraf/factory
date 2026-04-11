# API Reference

The Factory API provides programmatic access to all platform entities across the six domains.

## Base URL

```
https://factory.yourdomain.com/api/v1/factory
```

## Authentication

All API requests require a Bearer JWT token:

```bash
curl -H "Authorization: Bearer $FACTORY_TOKEN" \
  https://factory.yourdomain.com/api/v1/factory/org/teams
```

## Response Format

All list responses follow a consistent envelope:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 142
  }
}
```

Single-entity responses return the entity directly:

```json
{
  "data": {
    "id": "team_abc123",
    "slug": "platform-eng",
    "name": "Platform Engineering",
    "type": "team",
    "spec": { ... },
    "metadata": { ... }
  }
}
```

## Error Format

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Team 'platform' not found"
  }
}
```

## Common Query Parameters

| Parameter  | Type   | Description                  |
| ---------- | ------ | ---------------------------- |
| `page`     | number | Page number (default: 1)     |
| `pageSize` | number | Items per page (default: 50) |
| `search`   | string | Full-text search             |
| `type`     | string | Filter by entity type        |
| `status`   | string | Filter by status             |

## Entity Conventions

All entities share these patterns:

- **id** — Prefixed unique identifier (e.g., `team_abc123`, `host_xyz789`)
- **slug** — Human-readable unique identifier, used in URLs and cross-references
- **name** — Display name
- **spec** — JSONB object with type-specific configuration
- **metadata** — JSONB object with labels, annotations, tags, and links
- **createdAt / updatedAt** — Timestamps with timezone

## Domains

| Domain                    | Description                           | Endpoint Prefix             |
| ------------------------- | ------------------------------------- | --------------------------- |
| [org](/api/org)           | Teams, principals, agents, threads    | `/api/v1/factory/org/`      |
| [software](/api/software) | Systems, components, artifacts        | `/api/v1/factory/software/` |
| [infra](/api/infra)       | Estate, hosts, realms, services       | `/api/v1/factory/infra/`    |
| [ops](/api/ops)           | Sites, tenants, deployments, previews | `/api/v1/factory/ops/`      |
| [build](/api/build)       | Repos, pipelines, versions            | `/api/v1/factory/build/`    |
| [commerce](/api/commerce) | Customers, plans, subscriptions       | `/api/v1/factory/commerce/` |
