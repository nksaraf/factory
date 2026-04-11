# Linting & Quality

dx provides a unified quality check that combines linting, type checking, testing, and formatting.

## All-In-One

```bash
dx check                   # Run ALL checks: lint + typecheck + test + format
dx check --fix             # Auto-fix lint and format issues
dx check --ci              # CI mode (strict exit codes)
```

## Individual Commands

```bash
dx lint                    # Run auto-detected linter
dx lint --fix              # Auto-fix lint issues
dx typecheck               # Run type checker
dx format                  # Run formatter
dx format --check          # Check without writing
dx generate                # Run code generators
```

## Auto-Detection

| Command        | Detects                                                        |
| -------------- | -------------------------------------------------------------- |
| `dx lint`      | eslint, biome, oxlint, ruff, golangci-lint                     |
| `dx typecheck` | tsc, pyright, mypy                                             |
| `dx format`    | prettier, biome, ruff, gofmt                                   |
| `dx generate`  | drizzle-kit, prisma, sqlc, graphql-codegen, openapi-typescript |

## Git Hook Enforcement

Quality is enforced automatically via git hooks:

| Hook         | Runs                               |
| ------------ | ---------------------------------- |
| `pre-commit` | `lint-staged` (lint changed files) |
| `pre-push`   | `dx check` (all quality checks)    |

Hooks are installed by `dx sync` and managed in `.dx/hooks/`.

## Related

- [Testing](/guides/testing)
- [Core Workflow](/getting-started/core-workflow)
