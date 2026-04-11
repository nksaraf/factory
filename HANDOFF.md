# Factory API & data layer — current state

**Last verified against the tree:** 2026-04-11

This document replaces the old “v1→v2 migration handoff.” The ontology migration is **done in code**: there is **no** parallel v1 Drizzle schema and **no** `X-Factory-V2` header switch. Drizzle modules and factory controllers use **domain names** (`org`, `infra`, `software`, `build`, `commerce`, `ops`), not `*-v2` / `*V2` suffixes.

---

## Glossary (read this before grep-driven “v1” cleanup)

| Term                                                                               | Meaning                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/api/v1/factory`, `/api/v1/auth`**                                              | **HTTP API versioning** on the wire. Not legacy DB. Eden clients expose this as `api.v1.factory.*`. Do **not** remove or rename for “schema v1” work. |
| **`api/src/db/schema/org.ts`, `…/software.ts`, …**                                 | **Current** Drizzle table definitions (Postgres schemas `org`, `infra`, `build`, `software`, `commerce`, `ops`).                                        |
| **Kubernetes `apiVersion: apps/v1`, `cert-manager.io/v1`, Loki `…/loki/api/v1/…`** | **External** APIs. Out of scope for Factory schema cleanup.                                                                                         |

---

## How the API is assembled

**Production / full DB:** `api/src/factory.api.ts`

- Plane prefix: **`/api/v1/factory`** (`mountFactoryControllers`).
- **Ontology controllers** (from `modules/*/index.ts`, e.g. `productController`, `buildController`, `opsController`):
  - Batch 1: `product`, `build`, `commerce`, **`ops`** (operational entities: sites, workbenches, rollouts, previews, etc.).
  - Batch 2: `infra`, `agent`, `identity` (+ `secret`, `config-var`), `messaging`, `observability`, `operations`, `workflow`, `ide-hooks`, `threads`, `thread-surfaces`, `documents`, `catalog`.
- **Not** using a separate `fleet` module: fleet-shaped REST paths are served via **`opsController`** (and related ops services), consistent with `db/schema/ops.ts`.
- **Messaging:** ontology routes live in `messaging-ontology.controller.ts`; `index.ts` also exports `messagingWebhookController`.
- **Additional mounts** (same app): `health`, `install`, `presence`, build/messaging/jira **webhooks**, preview/deploy **CI** controllers, **site** agent routes under `/api/v1/site`, OpenAPI at `/api/v1/factory/openapi`.
- **Plugins:** `auth.plugin.ts`, `error-handler.plugin.ts` only — **`v2-switch.plugin.ts` does not exist** (removed).

**Local daemon / PGlite:** `api/src/factory-core.ts`

- `createLocalApp()` mounts the same **`/api/v1/factory`** prefix with **`opsController`** and the same ontology controllers as production (subset vs full `factory.api.ts` where noted in code).

---

## Drizzle schema layout (single source)

All active table definitions live under `api/src/db/schema/`:

| File                                                         | Role                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `ops.ts`                                                     | Operational / fleet-adjacent entities (sites, workbenches, rollouts, previews, …) |
| `infra.ts`, `org.ts`, `software.ts`, `build.ts`, `commerce.ts` | Domain ontology tables                                                          |
| `helpers.ts`                                                 | Shared column helpers                                                             |
| `index.ts`                                                   | Barrel; re-exports namespaces `software`, `org`, `infra`, `ops`, `build`, `commerce` |

**Shared Zod** (request/response shapes): `shared/src/schemas/*.ts` — names like `org.ts` / `build.ts` here are the current contract layer (separate from Drizzle file names).

---

## Services layer

`api/src/services/` is a **small** set of focused services (preview, pipeline-run, infra access/dns/scan/ipam, etc.). The large deleted tree from the old plan (`services/sandbox/*`, `services/catalog/catalog-sync.service.ts`, many `services/infra/*.service.ts`) is **not present** in the current tree.

---

## Snapshots & historical artifacts

- `snapshots/v1-api-routes.txt` — route list snapshot; **“v1” in the filename is historical**, not “current API is v1-only.”
- `.context/plans/*` — planning notes; may still describe steps already completed in `main`.

---

## Follow-up work (optional, separate PRs)

1. **CLI / docs terminology** — align commands and docs with ontology names (see `MIGRATION.md` terminology map); many items were “pending” in the old manifest but product decisions may have changed.
2. **Snapshot filenames** — e.g. `v1-api-routes.txt` → `api-routes-snapshot.txt` for clarity.

---

## Design notes worth keeping

1. **Spec JSONB** — Domain fields live in `spec` JSONB on ontology tables; read/write via typed specs from `@smp/factory-shared/schemas/*` where possible.
2. **`ontologyRoutes()`** — Declarative CRUD + actions + relations; see ontology controllers under `modules/*`.
3. **ESM / Drizzle** — `factory-core.ts` documents PGlite migration quirks; production uses standard `migrate()` in `factory.api.ts`.

---

## Related doc

- **`MIGRATION.md`** — Terminology map (old → new entity names), intentionally removed tables/features, and a **completed** migration summary. Use it for naming refactors and docs, not as a step-by-step todo for v1 removal.
