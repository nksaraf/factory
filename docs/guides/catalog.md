# Software Catalog

The catalog is the system of record for all software in your organization.

## Browsing

```bash
dx catalog list            # Browse all systems, components, resources
dx catalog show auth-api   # Detailed view of a component
dx catalog doctor          # Check catalog health
```

## How It Works

The catalog is derived from `docker-compose.yaml` labels — there is no separate catalog file.

```yaml
services:
  api:
    build: ./services/api
    labels:
      dx.type: service
      dx.owner: platform-eng
      dx.description: "User Authentication API"
      dx.tags: "auth,api,core"
      dx.lifecycle: production
      dx.api.provides: "auth-api"
      dx.api.consumes: "user-api"
```

## Entity Kinds

Aligned with [Backstage](https://backstage.io) conventions:

| Kind      | Description                |
| --------- | -------------------------- |
| System    | Top-level product grouping |
| Component | Deployable software unit   |
| Resource  | Infrastructure dependency  |
| API       | Declared interface         |

## Classification Rules

- **Component**: has a `build:` block (source code)
- **Resource**: has just an `image:` (infrastructure)

## Related

- [Project Structure](/getting-started/project-structure)
- [software domain](/concepts/software)
- [Architecture: Catalog System](/architecture/catalog-system)
