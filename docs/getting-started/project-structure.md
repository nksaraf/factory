# Project Structure

Factory uses convention over configuration. Two files define your project; everything else is auto-detected.

## Source of Truth

| File                  | Purpose                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `docker-compose.yaml` | Service catalog — defines components, resources, and relationships via labels |
| `package.json#dx`     | Project config — team, conventions, deploy settings                           |

There is no separate `catalog.yaml` or `dx.yaml`. The catalog is derived from docker-compose labels.

## Docker Compose Labels

### Catalog Labels (`catalog.*`)

These describe what a service **is** in the software catalog:

```yaml
services:
  api:
    build:
      context: ./services/api
    labels:
      catalog.type: service # service, worker, website, database, cache, queue
      catalog.owner: platform-eng # Team that owns this component
      catalog.description: "User API"
      catalog.tags: "auth,api"
      catalog.lifecycle: production # experimental, development, production, deprecated

      # Port metadata
      catalog.port.8080.name: http
      catalog.port.8080.protocol: http

      # API declarations
      catalog.api.provides: "user-api"
      catalog.api.consumes: "auth-api"

      # Connection references
      catalog.connection.auth.module: auth
      catalog.connection.auth.component: auth-service
      catalog.connection.auth.env_var: AUTH_URL
```

### Development Labels (`dx.*`)

These tell dx **how to develop** the component:

```yaml
labels:
  dx.runtime: node # node, java, python
  dx.dev.command: "pnpm dev" # Command to start dev server
  dx.dev.sync: "./src,./shared" # Paths to watch for hot reload
  dx.test: "pnpm test" # Test command
  dx.lint: "pnpm lint" # Lint command
```

### Component vs Resource

dx classifies services automatically:

- **Component** — has a `build:` block (source code to build)
- **Resource** — has just an `image:` like `postgres:16-alpine` (infrastructure)

## The `package.json#dx` Key

Project-level configuration:

```json
{
  "dx": {
    "version": "1.0.0",
    "type": "monorepo",
    "team": "platform-eng",
    "conventions": {
      "commits": "conventional",
      "branching": "trunk"
    },
    "deploy": {
      "preview": { "trigger": "pull-request", "ttl": "72h" },
      "production": { "trigger": "release-tag", "approval": true }
    }
  }
}
```

## The `.dx/` Directory

Runtime state and hooks — not project definition:

```
.dx/
  hooks/                   # Git hooks (committed to repo)
    commit-msg             # Validates conventional commits
    pre-commit             # Runs lint-staged
    pre-push               # Runs dx check
    post-merge             # Runs dx sync --quiet
    post-checkout          # Runs dx sync --quiet
  ports.json               # Port allocation state
  config.json              # User config (factory URL, role)
  conventions.yaml         # Branch naming, quality rules
  ports.env                # Generated port env vars (gitignored)
  dev/                     # Dev server state (gitignored)
  generated/               # Generated files (gitignored)
```

## Convention Engine

dx auto-detects your project's tools from config files. No manual configuration needed.

| Category            | Detected From                                                                        |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Runtime**         | `package.json` (node), `pyproject.toml` (python), `go.mod` (go), `Cargo.toml` (rust) |
| **Package manager** | `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`                      |
| **Test runner**     | `vitest.config.ts`, `jest.config.ts`, `pyproject.toml [tool.pytest]`                 |
| **Linter**          | `eslint.config.js`, `biome.json`, `oxlint.config.*`, `.golangci-lint.yaml`           |
| **Formatter**       | `.prettierrc`, `biome.json`, `pyproject.toml [tool.ruff]`                            |
| **Type checker**    | `tsconfig.json`, `pyproject.toml [tool.pyright]`                                     |
| **Migration**       | `drizzle.config.ts`, `prisma/schema.prisma`, `alembic.ini`                           |
| **Codegen**         | `drizzle-kit`, `prisma generate`, `openapi-typescript`, `graphql-codegen`            |

### Resolution Order

1. **`package.json` scripts** — if a `test`, `lint`, or `format` script exists, it wins
2. **Config file detection** — auto-detect from config files
3. **Clear error** — if nothing found, dx tells you what to add

### Script Pass-Through

If `dx <name>` isn't a built-in command, dx falls back to `package.json#scripts`:

```bash
dx storybook              # Runs scripts.storybook
dx codegen                # Runs scripts.codegen
```

## Full Example

```yaml
# docker-compose.yaml
services:
  api:
    build:
      context: ./services/api
    ports:
      - "8080:8080"
    labels:
      catalog.type: service
      catalog.owner: platform-eng
      dx.runtime: node
      dx.dev.command: "pnpm dev"
      dx.test: "pnpm test"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
    depends_on:
      postgres:
        condition: service_healthy

  worker:
    build:
      context: ./services/worker
    labels:
      catalog.type: worker
      catalog.owner: platform-eng

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## Next Steps

- [Local Development](/guides/local-development) — Deep dive into `dx up` and `dx dev`
- [Software Catalog](/guides/catalog) — How the catalog works
- [Mental Model](/concepts/) — The full 6-domain platform model
