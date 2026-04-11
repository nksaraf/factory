# Factory API & data layer — current state

**Last verified against the tree:** 2026-04-11

This document replaces the old “v1→v2 migration handoff.” The ontology migration is **done in code**: there is **no** parallel v1 Drizzle schema and **no** `X-Factory-V2` header switch. Remaining work is mostly **naming cleanup** (`*V2`, `index.v2.ts`, `*-v2.ts` files), **docs/CLI terminology**, and optional **snapshot renames**.

---

## Glossary (read this before grep-driven “v1” cleanup)

| Term                                                                               | Meaning                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/api/v1/factory`, `/api/v1/auth`**                                              | **HTTP API versioning** on the wire. Not legacy DB. Eden clients expose this as `api.v1.factory.*`. Do **not** remove or rename for “schema v1” work. |
| **`index.v2.ts`, `*ControllerV2`, `build-v2.ts`, export `softwareV2`**             | **Migration scar tissue**: the _only_ implementation today. “v2” here means “post-ontology,” not “second runtime beside v1.”                          |
| **Kubernetes `apiVersion: apps/v1`, `cert-manager.io/v1`, Loki `…/loki/api/v1/…`** | **External** APIs. Out of scope for Factory schema cleanup.                                                                                           |

---

## How the API is assembled

**Production / full DB:** `api/src/factory.api.ts`

- Plane prefix: **`/api/v1/factory`** (`mountFactoryControllers`).
- **Ontology controllers** (all `*ControllerV2` from `modules/*/index.v2.ts`):
  - Batch 1: `product`, `build`, `commerce`, **`ops`** (operational entities: sites, workbenches, rollouts, previews, etc.).
  - Batch 2: `infra`, `agent`, `identity` (+ `secret`, `config-var`), `messaging`, `observability`, `operations`, `workflow`, `ide-hooks`, `threads`, `thread-surfaces`, `documents`, `catalog`.
- **Not** using a separate `fleetControllerV2` module: fleet-shaped REST paths are served via **`opsControllerV2`** (and related ops services), consistent with `db/schema/ops.ts`.
- **Additional mounts** (same app): `health`, `install`, `presence`, build/messaging/jira **webhooks**, preview/deploy **CI** controllers, **site** agent routes under `/api/v1/site`, OpenAPI at `/api/v1/factory/openapi`.
- **Plugins:** `auth.plugin.ts`, `error-handler.plugin.ts` only — **`v2-switch.plugin.ts` does not exist** (removed).

**Local daemon / PGlite:** `api/src/factory-core.ts`

- `createLocalApp()` mounts the same **`/api/v1/factory`** prefix with **`opsControllerV2`** + other v2 controllers (subset vs full `factory.api.ts`); **no** v1 controller path.

---

## Drizzle schema layout (single source)

All active table definitions live under `api/src/db/schema/`:

| File                                                                          | Role                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ops.ts`                                                                      | Operational / fleet-adjacent entities (sites, workbenches, rollouts, previews, …) |
| `infra-v2.ts`, `org-v2.ts`, `software-v2.ts`, `build-v2.ts`, `commerce-v2.ts` | Domain ontology tables                                                            |
| `helpers.ts`                                                                  | Shared column helpers                                                             |
| `index.ts`                                                                    | Barrel; exports e.g. `softwareV2`, `orgV2`, …                                     |

There are **no** legacy `db/schema/org.ts`, `db/schema/fleet.ts`, etc., without the `-v2` / `ops` split — those files from the old migration plan are **gone**.

**Shared Zod** (request/response shapes): `shared/src/schemas/*.ts` — names like `org.ts` / `build.ts` here are **not** “v1”; they are the current contract layer (separate from Drizzle file names).

---

## Services layer

`api/src/services/` is a **small** set of focused services (preview, pipeline-run, infra access/dns/scan/ipam, etc.). The large deleted tree from the old plan (`services/sandbox/*`, `services/catalog/catalog-sync.service.ts`, many `services/infra/*.service.ts`) is **not present** in the current tree.

---

## Snapshots & historical artifacts

- `snapshots/v1-api-routes.txt` — route list snapshot; **“v1” in the filename is historical**, not “current API is v1-only.”
- `.context/plans/*` — planning notes; may still describe steps already completed in `main`.

---

## Follow-up work (optional, separate PRs)

1. **Rename drops “v2”** — `index.v2.ts` → `index.ts`, `*ControllerV2` → `*Controller`, `*-v2.ts` → domain name (coordinate with `shared` schema filenames to avoid confusion). Large mechanical diff.
2. **CLI / docs terminology** — align commands and docs with ontology names (see `MIGRATION.md` terminology map); many items were “pending” in the old manifest but product decisions may have changed.
3. **Snapshot filenames** — e.g. `v1-api-routes.txt` → `api-routes-snapshot.txt` for clarity.

---

## Design notes worth keeping

1. **Spec JSONB** — Domain fields live in `spec` JSONB on v2 tables; read/write via typed specs from `@smp/factory-shared/schemas/*` where possible.
2. **`ontologyRoutes()`** — Declarative CRUD + actions + relations; see any `modules/*/index.v2.ts`.
3. **ESM / Drizzle** — `factory-core.ts` documents PGlite migration quirks; production uses standard `migrate()` in `factory.api.ts`.

---

## Related doc

- **`MIGRATION.md`** — Terminology map (old → new entity names), intentionally removed tables/features, and a **completed** migration summary. Use it for naming refactors and docs, not as a step-by-step todo for v1 removal.
