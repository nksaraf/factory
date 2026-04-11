# Core Workflow

Factory development revolves around two loops: the **inner loop** (minute-to-minute) and the **ship loop** (hour-to-hour).

## The Inner Loop

The inner loop is code → test → debug → repeat. Stay fast.

### Start Your Environment

```bash
dx up                      # Bring up docker-compose stack (all services + infra)
dx dev                     # Start local dev servers (hot reload)
dx dev api                 # Start only a specific component
dx up infra                # Start only infrastructure resources
```

`dx up` reads your `docker-compose.yaml`, allocates ports, generates `.dx/ports.env`, and brings everything up. `dx dev` runs a pre-flight sync (hooks, deps, codegen) then starts native dev servers for components that have a `dx.dev.command` label.

### Check Health

```bash
dx status                  # API reachable? Git clean? Services running?
```

Run this before debugging anything. It's your "am I in a good state?" command.

### Run Tests

```bash
dx test                    # Auto-detects runner: vitest, jest, pytest, go test
dx test api                # Test a specific component
dx test --watch            # Watch mode
dx test --coverage         # With coverage
dx test --changed          # Only test changed files
dx test --integration      # Run integration tests
```

`dx test` checks `package.json` scripts first, then auto-detects from config files.

### Quality Checks

```bash
dx check                   # All checks: lint + typecheck + test + format
dx check --fix             # Auto-fix lint and format issues
dx lint                    # Run auto-detected linter
dx lint --fix              # Auto-fix
dx typecheck               # Run type checker (tsc, pyright, mypy)
dx format                  # Run formatter (prettier, biome, ruff, gofmt)
dx generate                # Run code generators (drizzle, prisma, sqlc)
```

### Database

```bash
dx db connect              # Interactive psql/mysql shell
dx db query --sql "SELECT * FROM users LIMIT 5"
dx db migrate status       # Check pending migrations
dx db migrate up           # Apply migrations
dx db migrate down         # Rollback
```

### Debugging

```bash
dx logs api                # Tail container logs
dx logs --follow           # Follow all logs
dx exec api sh             # Shell into container
```

### Reset

```bash
dx down                    # Stop (data persists)
dx down --volumes          # Stop + delete volumes (clean slate)
dx sync                    # Heal local state: hooks, deps, codegen, env
```

## The Ship Loop

The ship loop is commit → push → review → deploy. Git commands are used directly — dx enforces conventions via git hooks.

### Commit

```bash
git commit -m "feat: add user search endpoint"
```

Git hooks validate automatically:

- **commit-msg** — conventional commit format required
- **pre-commit** — runs lint-staged on changed files
- **pre-push** — runs `dx check` (all quality checks)

### Push and PR

```bash
git push                   # Pre-push hook runs dx check first
gh pr create               # Create a PR (use GitHub CLI directly)
```

### Preview

```bash
dx preview deploy          # Deploy preview from current branch
dx preview list            # Show active previews
dx preview open            # Open in browser
```

### Release and Deploy

```bash
dx release create 1.0.0           # Tag a release
dx deploy create <release-id> --target prod   # Deploy to target
dx deploy status <id>              # Check deployment status
```

## Environment Maintenance

```bash
dx sync                    # Heal local state (hooks, deps, docker images, codegen, db)
dx self-update             # Update dx binary
dx doctor                  # Diagnose environment issues
```

`dx sync` runs automatically via git hooks after merge/checkout and as a pre-flight step in `dx dev`.

## Anti-Patterns

| Doing This                      | Do This Instead     | Why                                                        |
| ------------------------------- | ------------------- | ---------------------------------------------------------- |
| `docker compose up` directly    | `dx up`             | dx manages ports, generates env vars, reads catalog labels |
| `npm run dev` / `bun run dev`   | `dx dev`            | dx handles port allocation, env injection, pre-flight sync |
| Managing database URLs manually | `dx db connect`     | dx reads connection info from compose definitions          |
| `dx down` to reset              | `dx down --volumes` | Without `--volumes`, stale data persists                   |
| Debugging without checking      | `dx status` first   | Tells you if services are running and API is healthy       |

## Next Steps

- [Project Structure](/getting-started/project-structure) — Understand conventions and configuration
- [Local Development](/guides/local-development) — Deep dive into `dx up` and `dx dev`
- [Testing](/guides/testing) — Test runner auto-detection
