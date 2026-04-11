# Factory (Accra)

## Backlog

When ideas, features, or deferred work come up in conversation that won't be implemented right now, use `/backlog` to capture them in `BACKLOG.md` before ending the session. This prevents ideas from being lost across conversations.

At the end of any session where work was discussed but not completed, prompt the user: "Want me to run `/backlog` to capture deferred items?"

## Code Style

- **No deprecated aliases or backward-compat shims.** When renaming something, remove the old name entirely. Don't add `@deprecated` re-exports, redirect routes, or compatibility aliases. Just use the new name everywhere.
- **No "was X" comments.** Don't leave comments explaining what something used to be called (e.g. "was runtime", "formerly substrate"). The current name is the only name. Historical context belongs in git history, not in comments.
- **No `v2:` prefixes in comments.** Everything is the current version. Don't annotate transitions.

## Type Checking

- **Use `tsgo` for type checking, not `tsc`.** This project uses the native Go port of the TypeScript compiler. Always use `tsgo --noEmit` instead of `tsc --noEmit`. All `typecheck` scripts in `package.json` should invoke `tsgo`.

## Testing

- Never assert broken behavior in tests. Tests should always assert the correct/expected behavior. If the code doesn't match yet, leave the test failing — that's fine. A failing test is a signal to fix the code, not to weaken the test.

## Database Migrations

- **Never write migration SQL by hand.** Always use `drizzle-kit generate` (via `pnpm db:generate` in `api/`) to produce migrations from schema changes in `api/src/db/schema/*.ts`.
- If a migration is missing for schema changes someone else made, run `pnpm db:generate` — it will diff the schema against the last snapshot and produce the correct migration.
- Migration files live in `api/drizzle/`, tracked by `api/drizzle/meta/_journal.json`. Never edit the journal or snapshot files directly.
- Custom SQL that drizzle-kit can't generate (views, materialized views, PL/pgSQL functions) goes in a dedicated `NNNN_custom-*.sql` migration file. Generate the base migration first, then create the custom file.

## DX CLI Rules

- Use `dx up` to start infrastructure, `dx dev` to start dev servers
- Use `dx db connect` / `dx db query` for database access, not manual psql
- Use standard git commands (`git commit`, `git push`) — dx enforces conventions via git hooks in `.dx/hooks/`
- Use `dx test`, `dx lint`, `dx format`, `dx typecheck`, `dx check` for quality — they auto-detect your tools
- Use `dx status` to check if the environment is healthy before debugging
- Use `dx sync` to heal local state (hooks, deps, codegen, env)
- Use `--json` flag when parsing dx output programmatically
- Two source-of-truth files: `docker-compose.yaml` (catalog via labels) + `package.json#dx` (project config) — there is no `catalog.yaml` or `dx.yaml`
- Use `dx down --volumes` (not just `dx down`) when you need a clean reset
- See `docs/guides/dx-developer-guide.md` for the full developer guide

## Production

- **Server:** `lepton@192.168.2.88` (VM 115, factory-prod on Proxmox)
- **Path:** `/home/lepton/workspace/factory`
- **Database:** `postgresql://postgres:factory-prod-2026@192.168.2.88:54111/postgres` (Docker-mapped port)
- **Deploy:** Same `docker-compose.yaml` + `dx up` as local. Migrations auto-apply on API startup via `setupDb()`
- **CLI on prod:** Build with `pnpm --filter lepton-dx run build:crust:local`, or run directly via `bun run cli/src/cli.ts`

To deploy new version of CLI:
Bump version (usually patch) in cli/package.json
Build cross-platform binaries: pnpm build:crust (in cli/)
Publish: pnpm release:publish (in cli/)
