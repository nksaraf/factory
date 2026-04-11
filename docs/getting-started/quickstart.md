# Quickstart

Go from zero to a running project in 5 minutes.

## 1. Scaffold a Project

```bash
dx init my-product
```

Interactive prompts ask for:

- **Type**: project (monorepo), service, website, or library
- **Runtime**: node, java, python
- **Framework**: Elysia, Spring Boot, FastAPI, React + Vinxi
- **Owner**: Your team slug

This generates:

```
my-product/
  docker-compose.yaml          # Service catalog (via labels)
  compose/
    postgres.yml               # PostgreSQL resource
    auth.yml                   # Auth service
    my-product-api.yml         # Backend service
    my-product-app.yml         # Frontend app
  services/my-product-api/     # Backend source code
  apps/my-product-app/         # Frontend source code
  package.json                 # Monorepo root with dx config
  .dx/
    hooks/                     # Git hooks (committed)
    ports.json                 # Port allocation
```

## 2. Start Developing

```bash
cd my-product

# Start infrastructure (postgres, redis, auth, gateway)
dx up

# Start dev servers with hot reload
dx dev
```

`dx up` reads your `docker-compose.yaml`, allocates ports, and brings up services. `dx dev` runs a pre-flight sync (hooks, deps, codegen) then starts native dev servers.

## 3. Check Health

```bash
dx status
```

Confirms: API reachable, services running, git clean.

## 4. Make a Change

```bash
# Create a branch
git checkout -b feat/user-search

# ... write some code ...

# Commit (hooks validate conventional format)
git commit -m "feat: add user search endpoint"

# Push (pre-push hook runs dx check)
git push
```

Git hooks are installed automatically by dx:

- **commit-msg** — validates conventional commit format
- **pre-commit** — runs lint-staged
- **pre-push** — runs `dx check` (lint + typecheck + test + format)

## 5. Get a Preview URL

```bash
# Create a PR
gh pr create

# Deploy a preview
dx preview deploy
# → https://my-product-feat-user-search.preview.factory.rio.software
```

Previews are ephemeral — they auto-expire after 72 hours by default.

## 6. Ship to Production

```bash
# Merge your PR
gh pr merge

# Cut a release
dx release create 0.1.0

# Deploy
dx deploy create <release-id> --target prod
# → https://my-product.factory.rio.software
```

## What Just Happened?

In 5 minutes, you:

1. Scaffolded a full-stack project with CI/CD and quality tooling
2. Started local development with managed infrastructure
3. Made a change with automatic quality enforcement
4. Got a preview URL for stakeholder review
5. Shipped to production with a tagged release

## Next Steps

- [Core Workflow](/getting-started/core-workflow) — Deep dive into the development loops
- [Project Structure](/getting-started/project-structure) — Understand conventions and configuration
- [Mental Model](/concepts/) — Learn the 6-domain platform model
