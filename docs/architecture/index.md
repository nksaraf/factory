# Architecture

Technical documentation for Factory contributors and advanced users.

## Tech Stack

| Layer      | Technology                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Runtime    | [Bun](https://bun.sh)                                                                                               |
| API Server | [Elysia](https://elysiajs.com)                                                                                      |
| Database   | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team)                                                                |
| CLI        | [Ink](https://github.com/vadimdemedes/ink) (React for terminals) + [Crust](https://github.com/nicholasgasior/crust) |
| Frontend   | [Vinxi](https://vinxi.vercel.app) + React 19                                                                        |
| Schemas    | [Zod](https://zod.dev) (shared validation)                                                                          |
| Docs       | [VitePress](https://vitepress.dev)                                                                                  |

## Monorepo Layout

```
factory/
  api/        @smp/factory-api        Elysia server, Drizzle schemas, reconciler
  cli/        lepton-dx               Published CLI tool (npm)
  shared/     @smp/factory-shared     Zod schemas, format adapters, utilities
  ui/         @rio.js/factory.ui      Vinxi + React 19 frontend
  docs/       VitePress               This documentation site
```

## Key Design Decisions

- **Zod-first schemas** — Entity definitions live in `shared/src/schemas/*.ts`. Database tables mirror them. Types are derived via `z.infer<>`.
- **JSONB-first** — Foreign keys and type discriminators are columns. Everything else is in `spec` (JSONB) or `metadata` (JSONB). Add new entity types without migrations.
- **Plain text types** — All type/kind columns are `text` in Postgres, validated by Zod enums in TypeScript. No ALTER TABLE needed for new types.
- **Slug-based lookups** — Entities reference each other by slug, not ID. Human-readable and URL-safe.
- **Convention over configuration** — The CLI auto-detects tools from config files. The catalog is derived from docker-compose labels. No separate config files.

## Deep Dives

- [Ontology Framework](/architecture/ontology-framework) — Prescriptive patterns for entities, actions, connectors, reconcilers, and worlds
- [Schema Design](/architecture/schemas) — Zod-first, JSONB, bitemporal patterns
- [Catalog System](/architecture/catalog-system) — How compose labels become catalog entries
- [Reconciler](/architecture/reconciler) — Spec/status convergence loop
- [Connection Contexts](/architecture/connection-contexts) — How `dx` resolves service endpoints
- [Deployment Model](/architecture/deployment-model) — Sites, tenants, isolation tiers
