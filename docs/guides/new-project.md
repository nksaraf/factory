# Starting a New Project

From zero to a production URL.

## The Perfect Flow

```bash
# 1. Scaffold
dx init my-product --type project

# 2. Create repo and push
cd my-product
gh repo create my-org/my-product --private
git remote add origin git@github.com:my-org/my-product.git
git push -u origin main

# 3. Develop locally
dx up && dx dev

# 4. Ship a change
git checkout -b feat/user-search
# ... code ...
git commit -m "feat: add user search endpoint"
git push
gh pr create

# 5. Preview
dx preview deploy
# → https://my-product-feat-xyz.preview.factory.rio.software

# 6. Production
gh pr merge
dx release create 0.1.0
dx deploy create --release <id> --target prod
```

**Total time: ~5 minutes.**

## What `dx init` Creates

Interactive prompts ask for type, runtime, framework, and owner team.

For a full-stack project:

```
my-product/
  docker-compose.yaml          # Root compose with includes
  compose/
    postgres.yml               # PostgreSQL resource
    auth.yml                   # Auth service
    gateway.yml                # API gateway
    my-product-api.yml         # Backend service
    my-product-app.yml         # Frontend app
  services/my-product-api/     # Backend source code
  apps/my-product-app/         # Frontend source code
  packages/                    # Shared libraries
  package.json                 # Monorepo root with dx config
  .dx/hooks/                   # Git hooks (committed)
  .github/workflows/dx.yaml   # CI: dx check on PR, deploy on tags
```

The project catalog is defined entirely by docker-compose labels. There is no separate `catalog.yaml`.

## Related

- [Quickstart](/getting-started/quickstart)
- [Project Structure](/getting-started/project-structure)
- [Existing Project](/guides/existing-project)
