# Shared Platform Foundation — Factory + Traffic + Smart Market

## Context

Three products — **Factory** (DevOps/deployment platform), **Traffic** (traffic analytics), and **Smart Market** (marketplace) — are built by the same team using overlapping but drifting technology stacks. All three share the `@rio.js/*` ecosystem, the same Better Auth service image, React 19 + Vinxi frontends, PostgreSQL 16, and Redis 7. However, significant drift has accumulated at two levels:

1. **Infrastructure plumbing** — auth, gateways, observability, build tooling
2. **Application modules** — semantic layer, ontology, notifications, workflows, tiling, document storage, data versioning, AI systems

The goal is to define shared layers at both levels, make canonical decisions where things are drifting, and create a migration path so all three products move together on common foundations while keeping product-specific logic where justified. The Factory is itself a product, but it also manages deployment of Traffic and Smart Market — so the shared modules it provides become the platform that all three stand on.

---

## Current State — What Each Product Uses

| Layer                 | Factory                                 | Traffic                             | Smart Market                                                           |
| --------------------- | --------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| **Runtime**           | Bun (API/CLI)                           | Java 21 (Spring Boot 3.3.5)         | Java 21 (Spring Boot 3.2.1), Python 3.11 (FastAPI), Bun (Elysia)       |
| **API framework**     | Elysia 1.4.27                           | Spring Boot + PostgREST             | Elysia (workspace), Spring Boot (Java), FastAPI (Python)               |
| **Frontend**          | React 19 + Vinxi + RR7                  | React 19 + Vinxi + RR7              | React 19 + Vinxi + RR7                                                 |
| **Database**          | Postgres 16, Drizzle ORM                | Postgres 16 + PostGIS, JPA + Flyway | Postgres 16 + TimescaleDB + PostGIS, Drizzle (TS), JPA + Flyway (Java) |
| **Events**            | NATS JetStream                          | Kafka + Debezium CDC                | BullMQ (Redis)                                                         |
| **Cache**             | Redis 7                                 | Redis 7.2                           | Redis 7, Caffeine (Java)                                               |
| **Auth**              | Better Auth + SpiceDB                   | SpiceDB (enterprise-auth)           | Better Auth only                                                       |
| **Gateway**           | APISIX 3.11 + Traefik 3.6               | Traefik only                        | APISIX 3.11 + Traefik 3.6                                              |
| **Observability**     | OTel Collector → Loki                   | Spring Actuator + SLF4J (minimal)   | OTel Collector → ClickHouse (HyperDX)                                  |
| **Workflow**          | @workflow (Postgres world)              | Airflow 2.10                        | Temporal 1.25 (declared but TS code uses @workflow)                    |
| **AI/LLM**            | Anthropic SDK, Google AI, Vercel AI SDK | None                                | Anthropic SDK, Google AI, Vercel AI SDK                                |
| **Lint/Format**       | oxlint + oxfmt                          | N/A (Java)                          | Prettier (TS), Ruff (Python)                                           |
| **Type check**        | tsgo                                    | N/A                                 | tsc                                                                    |
| **Testing**           | bun test, Playwright                    | JUnit 5, Mockito                    | Vitest, Playwright                                                     |
| **Component lib**     | @rio.js/ui (shadcn-style)               | @rio.js/\* packages                 | @rio.js/ui-next (Radix, 80+ components)                                |
| **DX CLI**            | lepton-dx (full CLI)                    | Shell scripts                       | Taskfile.yml                                                           |
| **Docker naming**     | `infra-*` prefix, `dx.*` labels         | Bare names, no labels               | `infra-*` prefix (partial), no labels                                  |
| **Compose structure** | Single docker-compose.yaml              | Single docker-compose.yml           | Split: infra / services / apps / dev overlays                          |

---

## Current State — Application Modules

| Module               | Factory                                                                                                                                                                                                                      | Traffic                                                                                                                     | Smart Market                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semantic Layer**   | None                                                                                                                                                                                                                         | Trino + Superset (query Iceberg)                                                                                            | Cube.js Core (SQL API port 15432, REST API port 4000)                                                                                              |
| **Ontology / Graph** | YAML `ontology/_meta.yaml` + OntologyRegistry in TS (6 namespaces, ~55 entities, JSONB-first)                                                                                                                                | Rio ObjectType YAML (`RoadSegment.yaml` with properties, time-series backing, forecasts)                                    | Graph Service (Spring Boot, port 8086): SemanticEntity, SemanticAttribute, SemanticRelationship, MetricDefinition, BusinessTerm, LineageLink       |
| **Notifications**    | Adapter pattern: `send-notification.ts` → `notification-router.ts` → delivery adapters (Slack via HTTP, Email stub). Event delivery tracking in `event_delivery` table                                                       | None (Airflow DAG triggers only)                                                                                            | Hardcoded MVP: Resend (email) + Twilio (WhatsApp). No abstraction layer. TODO comment says "Phase 3 - database-driven recipients"                  |
| **Workflow Engine**  | @workflow/\* SDK: `registerWorkflow()`, SWC plugin, Postgres world. God Workflow (Jira → branch → agent → PR → preview). Composable steps: agent, git, work-tracker, workbench, notify                                       | Airflow 2.10: Python DAGs for data ETL (BigQuery → Postgres sync)                                                           | BullMQ: Redis job queue for PDF generation. Cron scheduler (daily/weekly/monthly). Temporal 1.25 declared in compose but TS code uses @workflow/ai |
| **Map Tiling**       | None                                                                                                                                                                                                                         | pg_tileserv (port 7808) + Martin (configured but commented). PostGIS vector tiles via Traefik at `/api/v1/tiles`            | Consumes tiles via @rio.js/gis + @rio.js/maps-ui + deck.gl MVTLayer. No tile server — reads from Traffic's pg_tileserv                             |
| **Document Storage** | Filesystem (`/data/documents` volume). `storage.ts` with `writeDocument`/`readDocument`. Path traversal protection. S3 swap point prepared                                                                                   | MinIO (S3-compatible, port 9000/9001). Used for Iceberg warehouse data                                                      | No explicit document service. Vercel serverless for uploads                                                                                        |
| **Data Versioning**  | Soft deletes only (`deleted_at`). No snapshots or time-travel                                                                                                                                                                | Full Iceberg + Nessie: table snapshots, time-travel queries, branching, CDC-based lineage (bronze/silver/gold Kafka topics) | DatasetVersion entity (id, datasetId, versionNumber, recordCount, note). LineageLink for dataset→column→attribute tracking                         |
| **AI / Agents**      | DurableAgent (@workflow/ai) + Chat Agent (Gemini 2.5 Flash) with tools (executeQuery, listTables, requestWork). Full DB model: org.agent, org.job, org.memory, org.role_preset. @chat-adapter/slack + @chat-adapter/state-pg | None (UI bindings for @rio.js/agents only)                                                                                  | UI components only (@rio.js/agents, @rio.js/agents-ui). AgentSessionSummary interface. No custom LLM logic                                         |

---

## Part A: Infrastructure Layers (1-13)

### Layer 1: Infrastructure Services (Docker Compose)

**Canonical pattern:** Factory's approach — `infra-*` prefix, `dx.*` labels, health checks on every service.

**Common base services (all 3 products get):**
| Service | Image | Purpose |
|---|---|---|
| `infra-postgres` | postgres:16-alpine | Primary relational DB |
| `infra-redis` | redis:7-alpine | Cache, pub/sub, state |
| `infra-auth` | enterprise-auth:semver | Better Auth authentication |
| `infra-reverse-proxy` | traefik:v3.6 | Edge routing, TLS |
| `infra-otel-collector` | otel-collector-contrib | Telemetry ingestion (OTLP) |

**Opt-in services (product enables as needed):**
| Service | Used by | Purpose |
|---|---|---|
| `infra-spicedb` | Factory, Traffic | ReBAC authorization |
| `infra-gateway` (APISIX) | Factory, Smart Market → Traffic | API gateway with auth/CORS/OTEL |
| `infra-clickstack-*` | Smart Market → Factory, Traffic | ClickHouse + HyperDX observability |
| `infra-nats` | Factory → Smart Market | Event streaming |
| `infra-minio` | Smart Market, Traffic | S3-compatible object storage |

**Product-specific (stays local):**

- Factory: PowerSync + MongoDB, Metabase
- Traffic: Kafka + Schema Registry + Debezium, Iceberg/Nessie/Trino, PgBouncer, Airflow
- Smart Market: TimescaleDB, Temporal (pending removal), Cube.js

**Changes needed:**

- Traffic: Rename services to `infra-*`, add `dx.*` labels, add health checks
- Smart Market: Add `dx.*` labels to all services
- All: Standardize auth image to `enterprise-auth:x.y.z` (semver tags, not `:latest`/`:next`)

---

### Layer 2: Auth & Authorization

**Canonical stack:** Better Auth (identity) + SpiceDB (authorization, opt-in)

All three already use the same auth-service Docker image from `asia-south2-docker.pkg.dev/rio-platform/docker/`. The service supports `AUTH_SPICEDB_ENABLED` as a toggle.

**Decision:** SpiceDB is opt-in. Products needing fine-grained ReBAC (Factory, Traffic) enable it. Smart Market uses Better Auth's built-in organization plugin for simpler role-based access.

**Shared artifacts:**

- `@rio.js/auth-client` + `@rio.js/auth-ui` — TypeScript client (all frontends)
- `software.lepton.lib:auth-utils` — Java JWT/JWKS verification (Traffic should adopt from Smart Market's existing library)
- Auth service config: `auth.settings.yaml` pattern with per-product overrides

**Changes needed:**

- Traffic: Adopt `auth-utils` Java library instead of custom JWT handling
- All: Pin auth image to semver (e.g., `enterprise-auth:1.2.0`)
- Deprecate `@rio.js/auth` (Supabase-based legacy package)

---

### Layer 3: API Gateway & Routing

**Canonical stack:** Traefik (edge/TLS) → APISIX (API gateway with per-route auth, CORS, OTEL, rate limiting)

Factory already has DX CLI tooling that generates APISIX config from Docker Compose labels. This is the pattern to replicate.

**Changes needed:**

- Smart Market: Already has APISIX — just needs `dx.*` labels for config generation
- Traffic: Add APISIX between Traefik and backend services (currently Traefik routes directly to services via `traefik-dynamic.yml`)

---

### Layer 4: Database & ORM

**Canonical choices:**

- TypeScript services: **Drizzle ORM + drizzle-kit** (Factory + Smart Market already converged)
- Java services: **Spring Data JPA + Flyway** (Traffic + Smart Market Java already converged)
- Schema namespacing: Each service owns its own Postgres schema (already happening)
- Init pattern: `infra-postgres-init` one-shot container for DB/schema creation (Factory pattern)

**Product-specific extensions stay local:**

- PostGIS (Traffic, Smart Market) — via init scripts or custom image
- TimescaleDB (Smart Market only)
- PostgREST (Traffic only)

**Changes needed:**

- Traffic: Adopt init-script pattern for schema creation
- Smart Market: Upgrade Spring Boot from 3.2.1 → 3.3.x (align with Traffic)

---

### Layer 5: Event/Messaging

**Decision: Don't force convergence.** This layer has the worst cost/benefit ratio for unification because the three products have fundamentally different event patterns.

| Pattern                       | Tool                             | Used by                             |
| ----------------------------- | -------------------------------- | ----------------------------------- |
| Cross-service domain events   | NATS JetStream + Postgres outbox | Factory (now), Smart Market (adopt) |
| CDC → data warehouse pipeline | Kafka + Debezium                 | Traffic only                        |
| Background job queues         | BullMQ (Redis)                   | Smart Market (keep)                 |

**Changes needed:**

- Smart Market: Add NATS for cross-service events as it grows beyond single-service BullMQ jobs
- Extract outbox relay pattern as a shared library (Factory already has `outbox-relay.ts`)

---

### Layer 6: Observability

**Canonical stack:** OpenTelemetry SDK → OTel Collector → ClickStack (ClickHouse + HyperDX)

Smart Market already runs this full stack. It handles logs, traces, AND metrics in one system — superior to Factory's Loki (logs only) and Traffic's Spring Actuator (metrics only, no centralized traces).

**Shared config:** Base OTel Collector config with OTLP receivers + batch processors. Exporters point to ClickStack by default.

**Changes needed:**

- Factory: Add ClickStack containers, reconfigure OTel Collector exporters (replace Loki)
- Traffic: Add OTel Collector + ClickStack, configure Java OTel Agent auto-instrumentation on Spring Boot services

---

### Layer 7: Workflow/Orchestration

**Canonical choices:**

- TypeScript workflows: **@workflow/\* (Postgres world)** — Factory and Smart Market both use it
- Data pipeline orchestration: **Airflow** — Traffic only (scheduled DAGs, Python operators)

**Changes needed:**

- Smart Market: Remove `infra-temporal` from docker-compose (TS code already uses `@workflow/ai`, not Temporal SDK)

---

### Layer 8: Frontend Stack

**Already the most converged layer.** All three use React 19 + Vinxi 0.5.11 + React Router 7 + Tailwind 3 + @rio.js/\* ecosystem.

**Decisions:**
| Concern | Choice |
|---|---|
| Component library | @rio.js/ui (current) — unify ui and ui-next into one |
| Tailwind version | Migrate to Tailwind 4 together via @rio.js/vinxi update |
| Build tool | rolldown-vite (Factory + Smart Market already override) |
| State management | @tanstack/react-query + @rio.js/client atoms |
| Testing | Vitest (unit) + Playwright (E2E) |

**Product-specific UI stays local:**

- Factory: PowerSync, XYFlow, @react-three/fiber
- Smart Market: GIS packages, deck.gl, TipTap editor, Cube.js dashboards
- Traffic: Tile server viewers, Superset dashboards

---

### Layer 9: AI/LLM Integration

**Canonical stack:** Vercel AI SDK (`ai@^6`) + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@workflow/ai`

Already converged between Factory and Smart Market. Traffic adopts when it adds AI features.

**Shared artifacts:**

- `@rio.js/agents` + `@rio.js/agents-ui` — user-facing AI agent components

---

### Layer 10: Shared TypeScript Packages (@rio.js/\*)

**Package tiers:**

| Tier                           | Packages                                                                                                                                              | Consumed by           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Platform** (everyone)        | ui, app-ui, client, env, vinxi, tunnel, tailwindcss3, table-ui, auth-client, auth-ui, auth.core                                                       | All 3                 |
| **Enterprise** (auth products) | enterprise-ui, enterprise.core, enterprise-auth                                                                                                       | Factory, Smart Market |
| **Domain** (specific products) | gis, gis-ui, maps-ui, gdal, geo (Traffic, SMP); agents, agents-ui (Factory, SMP); datalake, datalake-ui (SMP); workflows, workflows-ui (Factory, SMP) | Per product           |
| **Deprecated**                 | @rio.js/auth (Supabase-based), @rio.js/postgrest                                                                                                      | Migrate off           |

**Convention:** All products pin @rio.js/\* versions via pnpm overrides. Use changesets for publishing. Products run `rio:update` script to stay current.

---

### Layer 11: Java Shared Libraries

**Create `lepton-java-bom`** (Bill of Materials POM) that pins:

- Spring Boot 3.3.x
- PostgreSQL driver, Flyway, Caffeine, Jackson, Lombok
- OTel Java Agent version
- `software.lepton.lib:auth-utils`, `common-utils`, `s3-utils`

**Starting point:** Smart Market's existing `packages/java/lepton-bom/pom.xml`

**Changes needed:**

- Traffic: Consume `lepton-java-bom` + `auth-utils` + `common-utils` from GCP Artifact Registry
- Smart Market: Upgrade Spring Boot to 3.3.x via BOM
- Extract `security-config` library (Spring Security filter chain with Better Auth JWT verification)

---

### Layer 12: Build Tooling

**Canonical choices:**

| Concern           | Tool              | Rationale                                             |
| ----------------- | ----------------- | ----------------------------------------------------- |
| Package manager   | pnpm 9.x          | Already universal                                     |
| Linting (TS)      | oxlint            | 50-100x faster than eslint, Factory already uses      |
| Formatting (TS)   | oxfmt             | Prettier-compatible, 30x faster, Factory already uses |
| Type checking     | tsgo              | Go port of tsc, faster, Factory already uses          |
| Unit testing (TS) | Vitest            | Best ecosystem (coverage, browser mode, MSW)          |
| E2E testing       | Playwright        | Already used by Factory + Smart Market                |
| Java build        | Maven 3.x         | Already standard                                      |
| Java testing      | JUnit 5 + Mockito | Already standard                                      |
| Python linting    | Ruff              | Smart Market already uses                             |

**Changes needed:**

- Smart Market TS apps: Adopt oxlint + oxfmt, drop eslint + prettier
- Traffic frontend: Adopt oxlint + oxfmt
- All: Standardize git hooks (lint-staged + simple-git-hooks running oxlint/oxfmt)

---

### Layer 13: DX CLI (lepton-dx)

**Canonical tool:** `lepton-dx` — the Factory CLI that reads Docker Compose labels, manages infrastructure, generates gateway configs.

Each product adds `package.json#dx` config:

```json
{ "dx": { "project": "factory" } }
{ "dx": { "project": "traffic-platform" } }
{ "dx": { "project": "smart-market" } }
```

Core commands available to all: `dx up`, `dx down`, `dx dev`, `dx status`, `dx db connect/query`, `dx logs`, `dx catalog`

**Changes needed:**

- Smart Market: Add `package.json#dx` config, adopt `dx up`/`dx dev`
- Traffic: Add `dx.*` labels to compose services, add `package.json#dx`, adopt CLI

---

---

## Part B: Shared Application Modules (14-21)

These are the real leverage layers — product capabilities that sit above infrastructure and below product-specific business logic. Each module should be extractable as either a **shared service** (Docker container) or a **shared library** (npm/maven package), or both.

### Module 14: Ontology & Entity Graph

**The problem:** All three products define domain entities, but the model is different everywhere. Factory uses YAML + Drizzle schemas + OntologyRegistry. Traffic uses Rio ObjectType YAML. Smart Market has a full Graph Service with SemanticEntity/Attribute/Relationship/Metric/LineageLink. These are all describing the same thing — "what entities exist, what properties they have, how they relate" — in three incompatible ways.

**Canonical design:** Smart Market's Graph Service has the most complete data model. Extract it as the shared ontology service.

**Shared entity model:**

```
Entity          → name, slug, description, primaryDataset, primaryKeyColumn, spec (JSONB)
Attribute       → entity, name, type, column, description
Relationship    → fromEntity, toEntity, type (1:1, 1:N, N:M), joinColumn/joinTable
MetricDefinition → entity, name, expression, format, aggregation
BusinessTerm    → name, definition, synonyms, ownerEntity
LineageLink     → source (dataset.column) → target (attribute|metric), consumerType
```

**How each product uses it:**

- **Factory:** Its ~55 entities across 6 schemas (software, org, infra, ops, build, commerce) register into this model. The existing OntologyRegistry (`api/src/lib/ontology-registry.ts`) becomes a client that reads from the shared model.
- **Traffic:** RoadSegment and its properties (speed, travelTime, congestionIndex, forecasts) register as entities with time-series-backed attributes.
- **Smart Market:** Already uses this model natively. Graph Service becomes the reference implementation.

**Artifact:** `service-graph` (Java Spring Boot) → shared Docker service, deployed per-product. Each product provides its own entity definitions at startup (YAML seed files or API registration).

**Key files:**

- Smart Market graph service: `services/graph/model/src/main/java/software/lepton/service/graph/model/`
- Factory ontology registry: `api/src/lib/ontology-registry.ts`
- Traffic ObjectType: `trafficure/ontology/object-types/RoadSegment.yaml`

---

### Module 15: Semantic Layer

**The problem:** Traffic queries analytical data through Trino (raw SQL against Iceberg). Smart Market uses Cube.js (semantic SQL + REST + caching + pre-aggregations). Factory has no analytical query layer at all. Metabase in Factory runs raw SQL.

**Canonical choice:** **Cube.js** as the universal semantic layer.

**Why Cube.js over raw Trino:**

- Provides SQL-compatible wire protocol (port 15432) — any SQL client works
- REST API with pre-aggregations and caching — dashboards are fast
- Data model definitions in YAML/JS — business logic lives outside queries
- Supports multiple data sources (Postgres, Trino, ClickHouse) via drivers
- Already running in Smart Market

**How each product uses it:**

- **Smart Market:** Already uses Cube.js. No change. Data models in `infra/cube/`.
- **Traffic:** Add Cube.js in front of Trino. Cube.js connects to Trino as its data source. Superset queries go through Cube.js instead of raw Trino. Gain: caching, pre-aggregations, business-level metric definitions.
- **Factory:** Add Cube.js connected to Factory Postgres. Replace Metabase's raw SQL with Cube.js-backed dashboards. Gain: a proper analytical API for deployment metrics, build stats, agent performance.

**Artifact:** `infra-cube` Docker service (cubejs/cube:latest). Each product provides its own data model directory.

**Key files:**

- Smart Market Cube config: `infra/cube/`
- Traffic Trino config: `infra/trino/etc/`

---

### Module 16: Notification Service

**The problem:** Factory has a clean adapter pattern but it's embedded in the Factory API. Smart Market has hardcoded Resend + Twilio calls. Traffic has no notification system.

**Canonical design:** Extract Factory's notification architecture as a shared library.

**Shared notification model:**

```
NotificationEvent → type, target (entity), recipients, channels[], payload
DeliveryAdapter   → interface: send(recipient, renderedContent) → DeliveryResult
DeliveryResult    → status (delivered|failed), error?, externalId?
EventDelivery     → tracks each attempt (recipient, channel, status, rendered output, timestamps)
```

**Delivery adapters (pluggable):**
| Adapter | SDK | Used by |
|---|---|---|
| Slack | Direct HTTP (Factory pattern) or @slack/web-api | Factory, Smart Market |
| Email | Resend SDK | Smart Market → all |
| WhatsApp | Twilio SDK | Smart Market |
| In-app | Event stream (Postgres/NATS) | All |
| Webhook | HTTP POST | All |

**How each product uses it:**

- **Factory:** Already has this pattern. Extract `send-notification.ts`, `notification-router.ts`, delivery adapters into a shared package. Replace email stub with Resend adapter.
- **Smart Market:** Replace hardcoded `notification-service.ts` with shared library + adapter registration. Gain: event delivery tracking, retry logic, recipient management from DB.
- **Traffic:** Add notification library. Start with Slack + email for alerting (traffic incidents, threshold breaches).

**Artifact:** `@lepton/notifications` (TypeScript library). Products register adapters and define notification types.

**Key files:**

- Factory notification: `api/src/modules/events/send-notification.ts`, `notification-router.ts`, `delivery-adapter-email.ts`
- Factory Slack adapter: `api/src/adapters/messaging-adapter-slack.ts`
- Smart Market notifications: `apps/smart-market-app/src/lib/notification-service.ts`

---

### Module 17: Workflow Engine

**The problem:** Three different workflow engines for what are essentially the same patterns — durable multi-step execution with triggers, steps, and state.

**Canonical choice:** **@workflow/\* SDK** (Postgres world) for all TypeScript workflows.

This is already a library, not product-specific code. The shared layer is the SDK itself plus a set of reusable workflow steps.

**Shared workflow primitives (already in @workflow/\*):**

- `registerWorkflow()` — declarative workflow registration with Zod input schema
- `"use step"` / `"use workflow"` — SWC-compiled durability directives
- `sleep()`, `createWebhook()`, `start()`, `getRun()` — SDK primitives
- `@workflow/world-postgres` — durable state in Postgres
- `@workflow/ai` — DurableAgent for AI-enhanced workflows

**Shared reusable steps to extract from Factory:**
| Step | What it does | Who needs it |
|---|---|---|
| `notify` | Send notification via adapter pattern | All |
| `git` | Create branch, post PR, push commits | Factory, Smart Market |
| `work-tracker` | Fetch/update Jira/Linear issues | Factory, Smart Market |
| `agent` | Dispatch AI agent job, wait for completion | All |
| `webhook-wait` | Park workflow, resume on external webhook | All |

**What stays product-specific:**

- Factory: God Workflow (Jira → branch → agent → PR → preview), workbench provisioning step
- Traffic: Airflow DAGs (Python data pipelines — fundamentally different runtime)
- Smart Market: BullMQ PDF generation jobs (simple enough, doesn't need @workflow overhead)

**Changes needed:**

- Smart Market: Remove Temporal from compose. Use @workflow/\* for any new TS workflows.
- Extract reusable steps from Factory into `@lepton/workflow-steps` package.
- Traffic: Add @workflow/\* when it needs TypeScript workflows (e.g., alert escalation chains). Airflow stays for data ETL.

**Key files:**

- Factory workflow engine: `api/src/lib/workflow-engine.ts`
- Factory steps: `api/src/modules/workflow/steps/{agent,git,work-tracker,workbench,notify}.ts`
- Factory God Workflow: `api/src/modules/workflow/workflows/god-workflow.ts`
- Smart Market BullMQ: `apps/smart-market-app/src/lib/pdf-queue.ts`
- Traffic Airflow: `traffic-airflow/dags/`

---

### Module 18: Map Tiling & GIS

**The problem:** Traffic has pg_tileserv serving vector tiles from PostGIS. Smart Market consumes those tiles via @rio.js/gis + deck.gl but has no tile server of its own. Factory has no geospatial capability.

**Canonical stack:**

- **Backend:** pg_tileserv (or Martin) + PostGIS — serves MVT vector tiles from any PostGIS table
- **Frontend:** @rio.js/gis + @rio.js/maps-ui + deck.gl — renders tiles with interaction (hover, click, selection)

**This is already mostly shared** via the @rio.js/gis ecosystem. The gap is infrastructure.

**Shared infra service:** `infra-tileserv` — pg_tileserv connected to any PostGIS-enabled Postgres.

**How each product uses it:**

- **Traffic:** Already runs pg_tileserv. Rename to `infra-tileserv`, add `dx.*` labels.
- **Smart Market:** Currently reads from Traffic's tileserv. For standalone deployment, add its own `infra-tileserv` pointing at `infra-postgres-userdata` (PostGIS + TimescaleDB).
- **Factory:** Doesn't need tiling. Optional — could visualize infrastructure topology on a map if desired.

**Frontend packages (already shared via @rio.js/\*):**

- `@rio.js/gis` — core GIS runtime
- `@rio.js/gis-ui` — map UI components
- `@rio.js/maps-ui` — map interface + deck.gl layers (MVTLayer, GeoJsonLayer)
- `@rio.js/gis.core` — coordinate systems, projections
- `@rio.js/gis.flows` — data flow layer for GIS
- `@rio.js/gis.raster` — GeoTIFF/raster support
- `@rio.js/deckgl-geotiff` — deck.gl GeoTIFF rendering

**Key files:**

- Traffic tileserv: `docker-compose.yml` (traffic-tiler service)
- Traffic Martin config: `martin.yaml`
- Smart Market tile consumption: `apps/smart-market-app/src/modules/trafficure.core/traffic-layer.tsx`, `roads-layer.tsx`

---

### Module 19: Document Storage

**The problem:** Factory stores files on local filesystem with an S3 swap point prepared. Traffic uses MinIO for Iceberg data. Smart Market has no explicit document service.

**Canonical stack:** **MinIO** (S3-compatible object storage) as shared infra + **@lepton/storage** TypeScript library wrapping S3 SDK.

**Shared infra service:** `infra-minio` — MinIO with console. Already runs in Smart Market and Traffic.

**Shared library interface:**

```typescript
interface DocumentStorage {
  put(
    bucket: string,
    key: string,
    content: Buffer,
    metadata?: Record<string, string>
  ): Promise<void>
  get(
    bucket: string,
    key: string
  ): Promise<{ content: Buffer; metadata: Record<string, string> }>
  exists(bucket: string, key: string): Promise<boolean>
  list(bucket: string, prefix: string): Promise<string[]>
  presignedUrl(bucket: string, key: string, expiresIn: number): Promise<string>
  delete(bucket: string, key: string): Promise<void>
}
```

**How each product uses it:**

- **Factory:** Replace filesystem storage (`api/src/modules/documents/storage.ts`) with S3 client pointing at MinIO. Gain: presigned URLs, metadata, versioning.
- **Traffic:** Already uses MinIO for Iceberg. Add `@lepton/storage` for non-Iceberg document needs (report exports, config snapshots).
- **Smart Market:** Add MinIO for PDF reports (currently generated by Puppeteer but no persistent storage), dataset uploads, export files.

**Key files:**

- Factory document storage: `api/src/modules/documents/storage.ts`
- Smart Market s3-utils (Java): `packages/java/s3-utils/`

---

### Module 20: Data Versioning & Lineage

**The problem:** Traffic has full Iceberg + Nessie (table-level versioning, time-travel, branching). Smart Market has DatasetVersion (row-level version tracking) + LineageLink (column-level lineage). Factory has nothing.

**Canonical design:** Two tiers, because the use cases are genuinely different.

**Tier 1: Metadata versioning (lightweight, all products)**
Smart Market's DatasetVersion model — simple version counter per dataset with record count, notes, timestamps. Any product can track "version 3 of this dataset had 50,000 rows and was created on Tuesday."

**Shared model:**

```
Dataset        → id, slug, name, description, sourceType, connectionInfo, schema
DatasetVersion → datasetId, versionNumber, recordCount, note, createdBy, createdAt
LineageLink    → sourceDataset, sourceColumn → targetEntity, targetAttribute, consumerType
```

This lives in the **Graph Service** (Module 14) — lineage is part of the ontology.

**Tier 2: Analytical data versioning (heavy, opt-in)**
Traffic's Iceberg + Nessie stack — table-level snapshots with time-travel queries, branching, ACID transactions on data lake tables. This is for products that need a data warehouse.

**Product adoption:**

- **Smart Market:** Already has Tier 1 (DatasetVersion, LineageLink). No change.
- **Factory:** Adopt Tier 1 for tracking deployment artifacts, build outputs, config snapshots. Add Dataset/DatasetVersion tables to Factory schema.
- **Traffic:** Already has Tier 2 (Iceberg + Nessie). Adopt Tier 1's LineageLink model for explicit column-level lineage tracking (currently implicit in Kafka topic progression).

**Key files:**

- Smart Market DatasetVersion: `services/data/datasets/src/main/java/software/lepton/service/data/datasets/domain/DatasetVersion.java`
- Smart Market LineageLink: `services/graph/model/src/main/java/software/lepton/service/graph/model/LineageLink.java`
- Traffic Iceberg config: `common-libs/datamgmt-libs/src/main/java/com/libs/data/config/IcebergConfiguration.java`

---

### Module 21: AI Agent Platform

**The problem:** Factory has a full agent system (DurableAgent, tools, jobs, memory, chat adapters). Smart Market and Traffic have UI bindings only (@rio.js/agents-ui) but no agent logic. Every product will eventually need AI agents — for querying data, generating reports, monitoring systems, answering user questions.

**Canonical stack:**

```
@workflow/ai (DurableAgent)     → durable, tool-using agent execution
@chat-adapter/state-pg          → conversation persistence in Postgres
@chat-adapter/slack             → Slack channel integration
@rio.js/agents + agents-ui      → frontend components (session list, chat view, tool call display)
Vercel AI SDK (ai@^6)           → model provider abstraction (Anthropic, Google, OpenAI)
```

**Shared agent data model (extract from Factory):**

```
agent         → slug, name, type, principalId, reportsToAgent, status, spec (JSONB)
job           → agentId, delegatedBy, parentJob, workflowRunId, entityKind/Id, status, mode, trigger, spec
memory        → type, layer (session|user|org), status (proposed|approved|superseded), sourceAgent, spec
role_preset   → name, orgId (null=system), spec (capabilities, tools, system prompt template)
principal     → slug, name, type (human|agent|service), primaryTeam, spec
```

**Shared agent tools (extract from Factory, make generic):**
| Tool | What it does | Generic? |
|---|---|---|
| `executeQuery` | Read-only SQL against Postgres (SELECT only, schema allowlist) | Yes — any product's Postgres |
| `listTables` | Discover tables and columns from information_schema | Yes — any product's Postgres |
| `requestWork` | Capture task/bug/feature requests for routing | Yes — generic work intake |

**How each product uses it:**

- **Factory:** Already has this. Extract agent data model + generic tools into `@lepton/agents` package. Keep Factory-specific tools (git operations, workbench provisioning, deployment commands) in Factory.
- **Smart Market:** Add agents for: data exploration ("show me sales by region"), report generation ("create a weekly briefing"), anomaly detection ("what changed in this dataset?"). Use shared executeQuery tool against Smart Market's Postgres.
- **Traffic:** Add agents for: traffic monitoring ("what's the congestion on Highway 4?"), incident investigation ("why is speed dropping in Zone 3?"), report generation. Use shared executeQuery tool against Traffic's PostGIS database.

**Artifact:**

- `@lepton/agents` — TypeScript library: agent data model, generic tools, job lifecycle
- `@lepton/chat-adapters` — re-export of @chat-adapter/\* with product-agnostic config
- `@rio.js/agents` + `@rio.js/agents-ui` — frontend (already shared)

**Key files:**

- Factory agent module: `api/src/modules/agent/index.ts`
- Factory chat agent: `api/src/modules/chat/agent.ts`
- Factory agent DB schema: `api/src/db/schema/org.ts` (agent, job, memory, role_preset, principal tables)
- Factory workflow agent step: `api/src/modules/workflow/steps/agent.ts`

---

## Part B Summary: Shared Module Catalog

| #   | Module                    | Artifact Type                              | Artifact Name                            | Source of Truth                          |
| --- | ------------------------- | ------------------------------------------ | ---------------------------------------- | ---------------------------------------- |
| 14  | Ontology & Entity Graph   | Docker service + Java library              | `service-graph`                          | Smart Market's Graph Service             |
| 15  | Semantic Layer            | Docker service                             | `infra-cube` (Cube.js)                   | Smart Market's Cube config               |
| 16  | Notification Service      | TypeScript library                         | `@lepton/notifications`                  | Factory's adapter pattern                |
| 17  | Workflow Engine           | TypeScript library                         | `@workflow/*` + `@lepton/workflow-steps` | Factory's workflow module                |
| 18  | Map Tiling & GIS          | Docker service + TS packages               | `infra-tileserv` + `@rio.js/gis`         | Traffic's pg_tileserv + rio-platform     |
| 19  | Document Storage          | Docker service + TS library                | `infra-minio` + `@lepton/storage`        | Traffic's MinIO + new library            |
| 20  | Data Versioning & Lineage | Java service (in Graph) + Iceberg (opt-in) | `service-graph` + Iceberg stack          | Smart Market (Tier 1) + Traffic (Tier 2) |
| 21  | AI Agent Platform         | TypeScript library                         | `@lepton/agents` + `@chat-adapter/*`     | Factory's agent module                   |

---

## Pragmatic Conventions to Enforce

### Infrastructure conventions

1. **Docker Compose is the catalog.** Every service has `dx.*` labels (description, owner, ports, APIs). No separate catalog file.
2. **`infra-*` prefix** for all infrastructure services. Product services use their own prefix (e.g., `service-data`, `app-smart-market`).
3. **Semver auth images.** No `:latest` or `:next`. Pin `enterprise-auth:x.y.z`.
4. **One ORM per language.** Drizzle for TypeScript. JPA + Flyway for Java. No mixing.
5. **Schema namespacing.** Each service owns its Postgres schema. Document ownership.
6. **OTel everywhere.** Every service emits OTLP traces. No exceptions. Use Java Agent for Spring Boot, `@opentelemetry/*` for Node/Bun.
7. **Better Auth for identity, SpiceDB for authorization.** Never roll custom auth.
8. **APISIX for API routing.** Traefik is the edge only. Service-to-service routing goes through APISIX.
9. **oxlint + oxfmt for TypeScript.** No eslint, no prettier.
10. **`lepton-dx` for local dev.** No product-specific shell scripts for infra management.

### API & codegen conventions

11. **No manual API types.** Same-repo Elysia → Eden treaty. Cross-service → @hey-api/openapi-ts. Every API call in the frontend is typed from the source API, not hand-written.
12. **Every API has an OpenAPI endpoint.** Elysia: `@elysiajs/openapi`. Spring Boot: `springdoc-openapi`. FastAPI: built-in. Go: `swaggo/swag`. No exceptions.
13. **Generated files end in `.gen.ts`, committed to git.** Never edit them. Agents and humans see types without running codegen. PRs show type change diffs.
14. **OpenAPI specs committed in `specs/` directory.** They are the contract between repos. Breaking changes are caught in PR review.
15. **`pnpm generate` runs all codegen.** Runs in CI and locally. One command, all clients regenerated.

### Application module conventions

16. **Ontology-first entity modeling.** Every product entity registers in the shared Graph Service. Entity definitions in YAML seed files, not hardcoded in application code. Properties, relationships, and metrics are declared, not discovered.
17. **Cube.js for analytical queries.** No raw SQL dashboards. Every dashboard metric goes through a Cube.js data model. Products define their own models but use the shared Cube.js service.
18. **Notification adapter pattern.** No hardcoded email/SMS/Slack calls in product code. Register delivery adapters, define notification types, let the shared library handle routing, rendering, and delivery tracking.
19. **@workflow/\* for TypeScript orchestration.** No Temporal, no custom state machines. BullMQ is fine for simple job queues (fire-and-forget with retries). Anything with multiple steps, webhooks, or human-in-the-loop uses @workflow/\*.
20. **MinIO for file storage.** No local filesystem storage in production. Every document goes through S3-compatible API. Presigned URLs for client uploads/downloads.
21. **Shared agent tools are generic.** Agent tools that query databases, list schemas, or dispatch work use the product's connection config but the same tool implementation. Product-specific tools (git operations, deployment commands) stay in the product.
22. **Data lineage is explicit.** Every dataset → column → entity attribute mapping is declared in the Graph Service via LineageLink. No implicit lineage through "we know the Kafka topic feeds this table."

---

## Migration Sequence

### Phase 1: Labels, Naming & Inventory (1-2 weeks)

- Rename Traffic services to `infra-*`, add `dx.*` labels
- Add `dx.*` labels to Smart Market services
- Standardize auth image tags to semver
- Document schema ownership table for all three products
- Document which product has which application modules (this plan's current state table)

### Phase 2: Tooling Convergence (2-4 weeks)

- Smart Market adopts oxlint + oxfmt
- Traffic frontend adopts oxlint + oxfmt
- Both adopt `lepton-dx` CLI (basic `dx up`/`dx dev`/`dx status`)
- Create `lepton-java-bom` from Smart Market's existing BOM

### Phase 3: Observability & Gateway (3-4 weeks)

- Factory: Add ClickStack, reconfigure OTel Collector, remove Loki
- Traffic: Add OTel Collector + ClickStack + Java Agent instrumentation
- Traffic: Add APISIX between Traefik and services
- Traffic Java services: Consume `auth-utils` library
- Smart Market: Upgrade Spring Boot to 3.3.x via BOM

### Phase 4: Shared Application Modules — Extract (4-6 weeks)

This is the high-leverage phase. Extract shared modules from where they exist today.

1. **Extract `@lepton/notifications`** from Factory's `send-notification.ts` + `notification-router.ts` + delivery adapters. Add Resend email adapter (from Smart Market). Publish as npm package.
2. **Extract `@lepton/storage`** — S3-compatible document storage library wrapping AWS SDK. Factory switches from filesystem to MinIO.
3. **Extract `@lepton/agents`** from Factory's agent module — agent data model (tables), generic tools (executeQuery, listTables), job lifecycle. Publish as npm package.
4. **Extract `@lepton/workflow-steps`** — reusable workflow steps (notify, webhook-wait, agent dispatch). Depends on @workflow/\*.
5. **Formalize `service-graph`** — Smart Market's Graph Service becomes the canonical ontology/lineage service. Add Docker image to shared registry. Create YAML seed format for entity definitions.
6. **Smart Market: Remove Temporal** from compose (TS code uses @workflow/ai)

### Phase 5: Shared Application Modules — Adopt (4-6 weeks)

Products adopt the extracted modules.

1. **Smart Market:** Replace hardcoded notification-service.ts with `@lepton/notifications` + Resend + Twilio adapters
2. **Smart Market:** Add `infra-minio` to compose, use `@lepton/storage` for PDF reports and dataset uploads
3. **Traffic:** Add `service-graph` for entity/lineage registration. Seed with RoadSegment ontology.
4. **Traffic:** Add Cube.js in front of Trino. Migrate Superset dashboards to use Cube.js SQL API.
5. **Factory:** Add `service-graph`. Register Factory's ~55 entities from ontology YAML. Replace OntologyRegistry with graph service client.
6. **Factory:** Add `infra-cube` connected to Factory Postgres. Replace Metabase raw SQL.
7. **Factory:** Replace filesystem document storage with `@lepton/storage` + MinIO
8. **Factory:** Adopt Tier 1 data versioning (Dataset/DatasetVersion tables)

### Phase 6: AI Agent Rollout (2-4 weeks)

- Smart Market: Add first agent (data exploration — "show me sales by region") using `@lepton/agents` + shared executeQuery tool
- Traffic: Add first agent (traffic monitoring — "what's the congestion on Highway 4?") using `@lepton/agents` + shared executeQuery tool
- Both products: Add @chat-adapter/slack for Slack channel integration
- Both products: Add `@rio.js/agents-ui` for agent session views in frontend (already have UI packages, wire up to real agent backend)

### Phase 7: Platform Repo & Agentic Development (3-4 weeks)

- Create `platform/` shared repo with `packages/{ts,java,python,go}/` structure
- Move extracted @lepton/\* packages into platform/packages/ts/
- Move lepton-java-bom + auth-utils + common-utils into platform/packages/java/
- Create platform/infra/compose-base.yml (shared Docker services)
- Create platform/schemas/openapi/ (generated specs from each service)
- Write CLAUDE.md for every service that doesn't have one (especially Traffic services)
- Write AGENTS.md for Traffic platform (currently has none)
- Set up git worktree conventions doc + port pinning for parallel agent work
- Evaluate Go rewrite of DX CLI for static binary distribution

### Phase 8: Event & Package Cleanup (2-4 weeks)

- Smart Market: Add NATS for cross-service events
- Extract outbox relay pattern as shared library
- Deprecate `@rio.js/auth` (Supabase), migrate remaining consumers
- Document @rio.js/\* package tiers
- Traffic: Add LineageLink model to Graph Service (explicit column-level lineage, replacing implicit Kafka topic progression)
- Set up OpenAPI spec generation in CI for all services
- Create event schema directory (platform/schemas/events/) with JSON Schema for NATS/Kafka payloads

---

---

## Part C: Polyglot Service Strategy & Agentic Development

### Why Four Languages

Each language earns its place by being the best tool for a specific job. No language exists "because someone wanted to use it."

| Language                  | Where it wins                                                                                                                                                                                                                                    | Services that use it                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **TypeScript (Bun)**      | API orchestration, frontend, real-time (WebSocket/SSE), AI agent tooling, workflow definitions, schema-first API design (Elysia + Zod). Fastest iteration speed — no compile step, instant reload, same language as frontend.                    | Factory API, auth service, workspace service, CLI (lepton-dx), all frontends, workflow definitions, chat agents |
| **Java 21 (Spring Boot)** | Heavy data processing, enterprise integrations, JDBC connection pooling, mature library ecosystem (Kafka Connect, Iceberg, Trino JDBC, GIS), thread-per-request with virtual threads. Battle-tested for services that talk to many data sources. | Traffic metrics engine, Smart Market data/graph/query/AI services, data management service                      |
| **Python 3.11 (FastAPI)** | ML/data science (scikit-learn, pandas, LightGBM, H3, rasterio), Airflow DAGs, rapid prototyping of data pipelines, Temporal workers. The ML ecosystem is Python-only.                                                                            | Smart Market ML engine, data processing service, Traffic Airflow DAGs                                           |
| **Go**                    | Infrastructure tooling, high-performance proxies/sidecars, CLI tools that need tiny binaries with zero runtime dependencies, anything that needs to be compiled to a static binary and distributed. Currently used via tsgo (Go port of tsc).    | DX CLI (candidate for Go rewrite), gateway/proxy sidecars, infrastructure agents, OTel collector plugins        |

**Rule: Pick language by the job, not the team.** If a service mostly orchestrates HTTP calls and renders JSON — TypeScript. If it processes millions of database rows or talks to Kafka/Iceberg — Java. If it trains models or does spatial analysis — Python. If it needs to be a 5MB static binary that runs anywhere — Go.

---

### Repo Organization — The Decision

**Given:** ~50% of work is cross-cutting (frontend + backend), small generalist team, AI agents do significant work.

**Decision: Product monorepos (Smart Market pattern) + shared platform repo + separate marketing repo.**

Splitting frontend and backend into separate repos would mean half of all features require coordinated PRs across repos. With a generalist team where the same person (or agent) builds the API endpoint and the UI that calls it, that's pure overhead. Smart Market already proves the monorepo works at scale — 14K files, 4 languages, 8 services, excellent dx CLI, git worktrees for parallel agent work.

**The repos:**

```
conductor/workspaces/
│
├── platform/                              # Shared packages + services (all languages)
│   ├── packages/                          # Organized BY CONCEPT, not by language
│   │   ├── storage/                       # All storage implementations together
│   │   │   ├── ts/                        # @lepton/storage (npm)
│   │   │   ├── java/                      # software.lepton.lib:storage-utils (Maven)
│   │   │   └── python/                    # lepton-storage (pip)
│   │   ├── auth/                          # All auth implementations
│   │   │   ├── ts/                        # @lepton/auth-utils
│   │   │   └── java/                      # software.lepton.lib:auth-utils
│   │   ├── notifications/                 # TS-only (for now)
│   │   │   └── ts/                        # @lepton/notifications
│   │   ├── agents/                        # TS-only
│   │   │   └── ts/                        # @lepton/agents
│   │   ├── workflow-steps/                # TS-only
│   │   │   └── ts/                        # @lepton/workflow-steps
│   │   ├── otel/                          # All OTel setup implementations
│   │   │   ├── ts/                        # @lepton/otel
│   │   │   ├── java/                      # software.lepton.lib:otel-utils
│   │   │   └── python/                    # lepton-otel
│   │   ├── common/                        # Cross-language utilities
│   │   │   ├── ts/                        # @lepton/common
│   │   │   ├── java/                      # software.lepton.lib:common-utils
│   │   │   └── python/                    # lepton-common
│   │   └── java-bom/                      # Java Bill of Materials (Maven version pins)
│   │       └── pom.xml
│   ├── services/                          # Shared services (Docker images)
│   │   ├── auth-service/                  # Better Auth (TypeScript/Bun)
│   │   └── graph-service/                 # Ontology + lineage (Java)
│   ├── infra/                             # Shared infra configs
│   │   ├── compose-base.yml               # Common: postgres, redis, auth, otel, traefik
│   │   ├── apisix/                        # Gateway config templates
│   │   ├── clickstack/                    # Observability config
│   │   └── otel-collector/                # Collector base config
│   ├── schemas/                           # Cross-product API contracts
│   │   ├── openapi/                       # Generated OpenAPI specs for shared services
│   │   └── events/                        # Event schemas (JSON Schema)
│   ├── CLAUDE.md
│   └── package.json                       # pnpm workspace root
│
├── factory/                               # Factory product monorepo
│   ├── api/                               # Elysia API (TypeScript)
│   ├── ui/                                # React frontend (Vinxi)
│   ├── shared/                            # Zod schemas (shared by api/ and ui/)
│   ├── cli/                               # lepton-dx CLI
│   ├── infra/                             # Product-specific infra configs
│   ├── specs/                             # Generated OpenAPI specs for THIS product's services
│   ├── docker-compose.yaml
│   ├── pnpm-workspace.yaml
│   ├── CLAUDE.md
│   └── AGENTS.md
│
├── smart-market/                          # Smart Market product monorepo (Smart Market pattern)
│   ├── apps/                              # Frontend applications
│   │   ├── smart-market-app/              # React frontend (Vinxi) — main app
│   │   ├── dev-portal/                    # Developer portal
│   │   └── slack-bot/                     # Slack integration
│   ├── services/                          # Backend services (any language)
│   │   ├── data/                          # Java (Spring Boot)
│   │   ├── graph/                         # Java → eventually moves to platform/
│   │   ├── data-query/                    # Java
│   │   ├── workspace/                     # TypeScript (Elysia)
│   │   ├── ml-engine/                     # Python (FastAPI)
│   │   └── data-processing/              # Python (FastAPI + Temporal)
│   ├── packages/                          # Product-specific shared libs
│   │   ├── npm/                           # TS packages (ui-next, lepton-cloud)
│   │   ├── java/                          # Java BOM + libs (extends platform BOM)
│   │   └── python/                        # Python packages (app-config)
│   ├── infra/                             # Product-specific infra configs
│   ├── specs/                             # Generated OpenAPI specs for THIS product's services
│   ├── docker-compose.infra.yml           # Infrastructure
│   ├── docker-compose.services.yml        # Backend services
│   ├── docker-compose.apps.yml            # Frontend apps
│   ├── docker-compose.dev.*.yml           # Dev overlays (hot reload)
│   ├── pnpm-workspace.yaml
│   ├── CLAUDE.md
│   └── AGENTS.md
│
├── traffic/                               # Traffic product monorepo
│   ├── apps/
│   │   └── trafficure/                    # React frontend (Vinxi)
│   ├── services/
│   │   ├── traffic-metrics/               # Java (Spring Boot)
│   │   ├── data-management/               # Java
│   │   └── traffic-airflow/               # Python (Airflow DAGs)
│   ├── packages/
│   │   └── java/                          # traffic-engine-libs (SPI pattern)
│   ├── infra/
│   ├── specs/
│   ├── docker-compose.yaml
│   ├── CLAUDE.md
│   └── AGENTS.md
│
└── marketing/                             # Separate repo — different team entirely
    ├── src/pages/
    ├── src/content/
    ├── astro.config.ts
    └── CLAUDE.md
```

**Why this layout works for your team:**

| Concern                           | How the monorepo handles it                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "I don't want people overwhelmed" | CLAUDE.md at each directory boundary. `dx dev apps` vs `dx dev services` targets subsections. Agent reads one CLAUDE.md and knows its scope.           |
| "50% cross-cutting work"          | One PR for full-stack features. API change + UI change in same commit. Eden treaty gives compile-time safety.                                          |
| "Agents need all the context"     | Agent working on `apps/smart-market-app/` can import types from `services/workspace/` (same TS workspace). Can read `specs/` to see Java service APIs. |
| "Don't want mistakes"             | Codegen (Eden + @hey-api) means API types are always correct. No manual fetch wrappers.                                                                |
| "Different languages coexist"     | apps/ is TypeScript, services/ has Java + Python + TS, packages/ has all languages. They communicate via HTTP only. No cross-language imports.         |
| "Parallel agent work"             | Git worktrees (Smart Market already has 7 concurrent worktrees). Each agent gets its own branch + port set.                                            |

**Why libraries are organized by concept:**

When someone changes the storage API (e.g., adds `listVersions()` to the interface), they need to update the TypeScript, Java, AND Python implementations. If those live in three different repos or three different directories, that's three PRs or three scattered file searches. With concept-first organization:

```
platform/packages/storage/
├── README.md              # What this library does, API contract
├── ts/                    # TypeScript implementation
│   ├── src/index.ts
│   ├── package.json       # @lepton/storage
│   └── CLAUDE.md          # TS-specific patterns
├── java/                  # Java implementation
│   ├── src/main/java/...
│   ├── pom.xml            # software.lepton.lib:storage-utils
│   └── CLAUDE.md
└── python/                # Python implementation
    ├── src/storage.py
    ├── pyproject.toml      # lepton-storage
    └── CLAUDE.md
```

One agent can update all three implementations in one PR. The README at the concept root defines the shared contract. Language-specific CLAUDE.md files guide implementation patterns.

**Not every concept needs every language.** Most start with one:

| Package        | ts  | java | python | go  |
| -------------- | --- | ---- | ------ | --- |
| storage        | yes | yes  | yes    | -   |
| auth           | yes | yes  | -      | -   |
| notifications  | yes | -    | -      | -   |
| agents         | yes | -    | -      | -   |
| workflow-steps | yes | -    | -      | -   |
| otel           | yes | yes  | yes    | -   |
| common         | yes | yes  | yes    | -   |
| java-bom       | -   | yes  | -      | -   |

You add a language implementation when a service in that language actually needs it. Not before.

**How products consume platform packages:**

| Language   | Registry                           | In product's dependency file                                         |
| ---------- | ---------------------------------- | -------------------------------------------------------------------- |
| TypeScript | GCP Artifact Registry (npm)        | `"@lepton/storage": "^1.0.0"` in package.json                        |
| Java       | GCP Artifact Registry (Maven)      | `<dependency>software.lepton.lib:storage-utils</dependency>` via BOM |
| Python     | GCP Artifact Registry (pip) or git | `lepton-storage>=1.0.0` in pyproject.toml                            |
| Go         | Go modules                         | `go get github.com/LeptonSoftware/platform/packages/storage/go`      |

For local development, `dx pkg link platform/packages/storage/ts` symlinks the local checkout into the product's node_modules (same as Smart Market's `.dx/pkg-repos/` pattern today).

---

### Service Template: What Every Service Looks Like

Regardless of language, every service follows the same structural contract:

```
service-<name>/
├── Dockerfile                 # Multi-stage build (builder → runtime)
├── src/                       # Source code
├── tests/                     # Tests
├── CLAUDE.md                  # Service-specific AI instructions
├── README.md                  # Human-readable service docs
└── <build-file>               # package.json | pom.xml | pyproject.toml | go.mod
```

**Docker contract (all languages):**

- `EXPOSE <port>` — single port
- `HEALTHCHECK` — HTTP health endpoint at `/health` or `/api/v1/<service>/health`
- `OTEL_SERVICE_NAME` env var — service name for traces
- `OTEL_EXPORTER_OTLP_ENDPOINT` env var — collector URL
- Labels: `dx.description`, `dx.owner`, `dx.port.*`, `dx.api.*`

**API contract (all languages):**

- Base path: `/api/v1/<service-name>/`
- Health: `GET /api/v1/<service-name>/health`
- OpenAPI: `GET /api/v1/<service-name>/openapi` (auto-generated)
- Auth: JWT in `Authorization: Bearer <token>`, verified via JWKS

**Language-specific templates:**

| Language   | Framework                | Build              | Dev command                      | Test command           |
| ---------- | ------------------------ | ------------------ | -------------------------------- | ---------------------- |
| TypeScript | Elysia 1.4 + Bun         | `bun build`        | `bun --watch src/server.ts`      | `bun test` or `vitest` |
| Java       | Spring Boot 3.3 + JDK 21 | `mvn package`      | `mvn spring-boot:run` + DevTools | `mvn test`             |
| Python     | FastAPI + uvicorn        | `pip install -e .` | `uvicorn src.main:app --reload`  | `pytest`               |
| Go         | net/http or chi          | `go build`         | `air` (live reload)              | `go test ./...`        |

---

### Cross-Language API Contracts

**Current gap:** No shared schema language across Java, Python, TypeScript, Go. Each service generates OpenAPI at runtime but doesn't version it.

**Decision: OpenAPI as the lingua franca.**

```
platform/schemas/openapi/
├── auth-service.v1.yaml       # Generated from auth-service
├── graph-service.v1.yaml      # Generated from graph-service
├── factory-api.v1.yaml        # Generated from Factory API
└── ...
```

**Workflow:**

1. Each service generates its OpenAPI spec (Elysia auto-generates, Spring Boot via springdoc, FastAPI auto-generates, Go via swag)
2. CI extracts the spec and commits to `platform/schemas/openapi/`
3. Other services can code-gen clients if needed (optional — most just use typed HTTP clients)
4. Breaking changes are caught by OpenAPI diff in CI

**Event contracts (for NATS/Kafka):**

```
platform/schemas/events/
├── build.created.v1.json      # JSON Schema for event payloads
├── deployment.completed.v1.json
└── ...
```

**Why not protobuf?** These are HTTP/JSON services, not gRPC. OpenAPI is the natural schema for REST APIs. Protobuf adds a compilation step and toolchain that doesn't pay for itself when all services speak JSON.

---

### Agentic Development: How AI Agents and Humans Work Together Fast

This is the force multiplier. The repo structure, conventions, and instruction files determine whether an AI agent can pick up a task in 30 seconds or wastes 10 minutes exploring.

#### Principle 1: Every boundary has a CLAUDE.md

```
platform/CLAUDE.md             # Platform-wide conventions
factory/CLAUDE.md              # Factory-specific rules
factory/api/CLAUDE.md          # API-specific patterns (Elysia, Drizzle, modules)
factory/ui/CLAUDE.md           # UI-specific patterns (React, Rio.js, Vinxi)
smart-market/CLAUDE.md         # Smart Market conventions
smart-market/AGENTS.md         # Comprehensive agent guide (service table, ports, build order)
traffic/CLAUDE.md              # Traffic conventions
```

**CLAUDE.md anatomy (per service):**

```markdown
# service-data

## What this service does

Data ingestion, storage, and dataset management for Smart Market.

## Quick start

dx dev service-data # Start with hot reload
dx test java service-data # Run tests
dx build service-data # Build Docker image

## Architecture

- Framework: Spring Boot 3.3, JDK 21
- Database: Postgres schema `data` (Flyway migrations)
- Dependencies: auth-utils (JWT), common-utils, s3-utils
- API: /api/v1/data/ (OpenAPI at /api/v1/data/openapi)

## Key patterns

- Datasets have versions (DatasetVersion entity)
- File uploads go through MinIO via s3-utils
- All mutations emit events to NATS subject `data.>`

## Don't

- Don't write migration SQL by hand. Use Flyway generate.
- Don't bypass auth. All endpoints require JWT.
- Don't import from other services. Use HTTP client.
```

#### Principle 2: Services are agent-sized

An AI agent (Claude Code, Copilot, Cursor) works best when it can hold the entire service context in its window. This means:

- **Small services with clear boundaries.** A service should have 20-50 source files, not 500. If it's bigger, split it.
- **No cross-service imports.** Service A never imports code from Service B. They communicate via HTTP or events. This means an agent working on Service A never needs to read Service B's code.
- **Shared code lives in packages, not services.** If two services need the same utility, it goes in `@lepton/*` or `software.lepton.lib:*`, not copied between services.
- **Each service has its own CLAUDE.md.** The agent reads one file and knows everything about the service: what it does, how to run it, how to test it, what patterns to follow.

#### Principle 3: Git worktrees for parallel agent work

Multiple AI agents (or humans) can work on the same repo simultaneously using git worktrees:

```bash
# Agent 1 works on Factory API feature
git worktree add ../factory-agent1 -b feat/agent1-notifications

# Agent 2 works on Smart Market data service
git worktree add ../smp-agent2 -b feat/agent2-dataset-versions

# Agent 3 works on platform shared library
git worktree add ../platform-agent3 -b feat/agent3-storage-lib
```

**Convention:** Each worktree gets its own `dx dev` environment (different ports via `INFRA_*_PORT` env vars). The DX CLI already supports port pinning.

**Worktree isolation rules:**

- One agent per worktree, one worktree per feature branch
- Agents don't touch files outside their service boundary
- Shared package changes require a separate worktree in the platform repo
- PR review is the sync point — agents propose, humans review

#### Principle 4: Task decomposition for agents

When a human assigns work, decompose into agent-sized tasks:

```
Human: "Add email notifications to Traffic when congestion exceeds threshold"

Decompose into:
1. Agent A (platform repo): Add Resend email adapter to @lepton/notifications
2. Agent B (traffic repo): Add notification trigger in traffic-metrics-engine
3. Agent C (traffic repo): Add notification preferences API endpoint
4. Human: Review PRs, wire up configuration, test end-to-end
```

Each agent gets:

- A specific service/package to modify
- A CLAUDE.md that explains the service
- A clear input (what to build) and output (PR with tests)
- No dependency on the other agents' work (parallel execution)

#### Principle 5: Convention over configuration

The more conventions are documented and enforced, the less an agent needs to figure out:

| Convention                                                    | Why it helps agents                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `/api/v1/<service>/` path convention                          | Agent knows where to mount new endpoints without searching      |
| `dx.*` labels on every Docker service                         | Agent can discover services by reading compose, not guessing    |
| One ORM per language (Drizzle/JPA)                            | Agent doesn't need to figure out which ORM this service uses    |
| Health check at `/health`                                     | Agent knows how to verify a service is running                  |
| NATS subject pattern: `<domain>.<entity>.<action>`            | Agent knows how to publish/subscribe without reading event docs |
| Test files colocated with source (`*.test.ts` next to `*.ts`) | Agent finds tests without searching                             |
| Kebab-case filenames, PascalCase components                   | Agent predicts file names from component names                  |

#### Principle 6: The DX CLI is the agent's hands

AI agents can't click buttons or navigate GUIs. They need CLI commands. The DX CLI should be the only tool an agent needs:

```bash
dx up                          # Start everything
dx dev service-data            # Start a service in dev mode
dx test java service-data      # Run tests for a service
dx build service-data          # Build Docker image
dx logs service-data           # Read logs
dx db connect                  # Database access
dx db query "SELECT ..."       # Run a query
dx status                      # Check environment health
dx lint                        # Run linters
dx format                      # Run formatters
dx typecheck                   # Run type checkers
dx catalog                     # List all services with ports
```

**Go rewrite consideration:** The DX CLI is currently Python (Smart Market) and TypeScript/Bun (Factory). A Go rewrite would give:

- Single static binary, no runtime dependencies
- Works on Linux, macOS, Windows without Python/Node/Bun installed
- Fast startup (important for agent loops that call `dx` repeatedly)
- Can embed as a sidecar in Docker containers

---

---

### Repo Boundary Decision: Everything Together, Scoped by Convention

**Decision: Product monorepos (Smart Market pattern). NOT separate frontend/backend repos.**

With ~50% cross-cutting work and a generalist team, splitting frontend and backend into separate repos would mean half your PRs require coordination across repos. The Smart Market monorepo already proves this works at 14K files — the key is CLAUDE.md scoping and `dx` CLI targeting, not repo separation.

**What keeps people from being overwhelmed (without splitting repos):**

| Mechanism                          | How it isolates                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `dx dev apps` vs `dx dev services` | You only start what you're working on                                            |
| CLAUDE.md per directory            | Agent reads one file and knows: what this does, how to run it, what not to touch |
| pnpm workspace scoping             | `pnpm --filter app-smart-market test` — targets one app                          |
| Git worktrees                      | 7 parallel branches (Smart Market already does this). Each agent gets its own.   |
| CI path filtering                  | Java changes don't trigger frontend CI, and vice versa                           |
| `specs/` directory                 | Frontend sees Java service APIs without reading Java code                        |
| Eden treaty                        | Frontend imports API types directly — no manual wrappers to get wrong            |

**Marketing is the exception** — different team entirely → separate repo. Astro/static, CMS-driven, deploys to Vercel edge independently. An agent writing a blog post should never see 14K application files.

**Smart Market's embedded-backend problem** (BullMQ/Puppeteer/cron in `apps/smart-market-app/scripts/`) gets solved by moving that logic to a proper `services/scheduler/` TypeScript service within the same monorepo — not by splitting repos.

**Agent context in a monorepo:**

```
Agent working on:                          Reads:
─────────────────                          ──────
Smart Market UI component                  apps/smart-market-app/CLAUDE.md → its module
Smart Market Java data service             services/data/CLAUDE.md → its package
Smart Market Python ML model               services/ml-engine/CLAUDE.md → its package
Full-stack feature (API + UI)              services/workspace/CLAUDE.md + apps/smart-market-app/CLAUDE.md
Shared storage library (all languages)     platform/packages/storage/README.md + {ts,java,python}/CLAUDE.md
Marketing landing page                     marketing/CLAUDE.md (separate repo)
```

Each CLAUDE.md scopes the agent to ~20-50 files. The monorepo has 14K files total but the agent never sees more than its slice.

---

### Canonical Directory Structures

Every repo type has a standard layout. An agent (or new developer) clones a repo and knows where everything is.

---

#### Template 1: Product Monorepo (Smart Market pattern — the standard for all products)

Frontend, backend services, and shared packages all live together. TypeScript services share types via Eden treaty. Cross-language services share types via codegen from `specs/`.

```
<product>/
├── apps/                              # Frontend applications (TypeScript/React)
│   ├── <product>-app/                 # Main React frontend (Vinxi SSR)
│   │   ├── src/
│   │   │   ├── routes/                # File-based routing (Vinxi/React Router)
│   │   │   ├── modules/
│   │   │   │   └── <domain>/
│   │   │   │       ├── components/    # React components
│   │   │   │       ├── data/          # React Query hooks + API calls
│   │   │   │       └── utils/
│   │   │   └── lib/
│   │   │       └── api/
│   │   │           ├── main.ts        # ← Eden treaty client (same-repo TS API)
│   │   │           └── data-service/  # ← Generated client (cross-language, Java)
│   │   │               ├── client.gen.ts
│   │   │               ├── types.gen.ts
│   │   │               └── hooks.gen.ts
│   │   ├── openapi-ts.config.ts       # @hey-api/openapi-ts config for cross-service clients
│   │   ├── app.settings.ts            # Env vars (Zod-validated)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── CLAUDE.md
│   ├── dev-portal/                    # Optional: developer tools UI
│   └── slack-bot/                     # Optional: Slack integration
│
├── services/                          # Backend services (ANY language)
│   ├── api/                           # Main Elysia API (TypeScript/Bun)
│   │   ├── src/
│   │   │   ├── server.ts              # Elysia app + OpenAPI plugin
│   │   │   ├── app-type.ts            # ← EXPORTS: `type AppType = typeof app`
│   │   │   ├── db/schema/             # Drizzle schemas
│   │   │   ├── modules/<domain>/      # Route groups + business logic
│   │   │   └── lib/                   # Internal utilities
│   │   ├── drizzle/                   # Generated migrations (never hand-edit)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── CLAUDE.md
│   ├── data/                          # Java (Spring Boot)
│   │   ├── src/main/java/software/lepton/service/data/
│   │   │   ├── Application.java
│   │   │   ├── config/
│   │   │   ├── controller/
│   │   │   ├── service/
│   │   │   ├── domain/
│   │   │   └── repository/
│   │   ├── src/main/resources/
│   │   │   ├── application.yml
│   │   │   └── db/migration/          # Flyway migrations
│   │   ├── pom.xml
│   │   ├── Dockerfile
│   │   └── CLAUDE.md
│   ├── ml-engine/                     # Python (FastAPI)
│   │   ├── src/
│   │   │   ├── main.py
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── models/                # Pydantic models
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   └── CLAUDE.md
│   └── <name>/                        # Go (if needed)
│       ├── cmd/server/main.go
│       ├── internal/{handler,service,model,db}/
│       ├── go.mod
│       ├── Dockerfile
│       └── CLAUDE.md
│
├── packages/                          # Product-specific shared libraries
│   ├── shared/                        # Zod schemas (consumed by apps/ AND services/api/)
│   │   ├── src/schemas/               # Domain types, API payloads
│   │   └── package.json               # @<product>/shared
│   ├── java/                          # Product-specific Java libs (extends platform BOM)
│   │   └── pom.xml
│   └── python/                        # Product-specific Python libs
│       └── pyproject.toml
│
├── specs/                             # ← GENERATED OpenAPI specs (committed to git)
│   ├── api.v1.yaml                    # From services/api/ (Elysia auto-gen)
│   ├── data-service.v1.yaml           # From services/data/ (Spring Boot)
│   ├── ml-engine.v1.yaml              # From services/ml-engine/ (FastAPI)
│   └── ...
│
├── infra/                             # Product-specific infra configs
│   ├── apisix/                        # Gateway routes
│   ├── postgres/                      # Init scripts
│   └── traefik/                       # Reverse proxy config
│
├── docker-compose.infra.yml           # Infrastructure (postgres, redis, auth, otel)
├── docker-compose.services.yml        # Backend services
├── docker-compose.apps.yml            # Frontend apps
├── docker-compose.dev.services.yml    # Dev overlays (hot reload)
├── docker-compose.dev.apps.yml        # Dev overlays
├── pnpm-workspace.yaml                # workspaces: [apps/*, services/*, packages/*]
├── package.json                       # Root: dx integration scripts
├── CLAUDE.md                          # Product-level conventions
└── AGENTS.md                          # Full agent guide: services, ports, build order, pitfalls
```

**The two API client patterns in a single frontend app:**

```typescript
// 1. SAME-REPO ELYSIA API (Eden treaty — direct type import, zero codegen)
//    apps/smart-market-app/src/lib/api/main.ts
import { treaty } from "@elysiajs/eden"
import type { AppType } from "../../services/api/src/app-type" // same workspace

export const api = treaty<AppType>("http://localhost:4100")
const { data } = await api.api.v1.workspace.datasets.get() // ← fully typed

// 2. CROSS-LANGUAGE SERVICE (generated from specs/data-service.v1.yaml)
//    apps/smart-market-app/src/lib/api/data-service/hooks.gen.ts
import { useGetDatasets } from "./data-service/hooks.gen"
const { data: datasets } = useGetDatasets({ query: { orgId } }) // ← typed from OpenAPI
```

Already proven: Factory CLI uses Eden treaty (`cli/src/client.ts`). Smart Market uses @hey-api/openapi-ts (`openapi-ts.config.ts`).

---

#### Template 2: Platform Repo (shared packages organized by concept)

```
platform/
├── packages/                          # Organized BY CONCEPT — all languages for one idea together
│   ├── storage/                       # "Storage" concept
│   │   ├── README.md                  # Contract: what this library provides (all languages)
│   │   ├── ts/                        # @lepton/storage (npm)
│   │   │   ├── src/index.ts
│   │   │   ├── package.json
│   │   │   └── CLAUDE.md
│   │   ├── java/                      # software.lepton.lib:storage-utils (Maven)
│   │   │   ├── src/main/java/...
│   │   │   ├── pom.xml
│   │   │   └── CLAUDE.md
│   │   └── python/                    # lepton-storage (pip)
│   │       ├── src/storage.py
│   │       ├── pyproject.toml
│   │       └── CLAUDE.md
│   ├── auth/                          # ts/ + java/ (no python yet)
│   ├── notifications/                 # ts/ only
│   ├── agents/                        # ts/ only
│   ├── otel/                          # ts/ + java/ + python/
│   ├── common/                        # ts/ + java/ + python/
│   └── java-bom/                      # Java BOM only (pom.xml)
│
├── services/                          # Shared services
│   ├── auth-service/                  # Better Auth (TypeScript)
│   └── graph-service/                 # Ontology + lineage (Java)
│
├── infra/                             # Shared infra configs
│   ├── compose-base.yml
│   ├── apisix/
│   ├── clickstack/
│   └── otel-collector/
│
├── schemas/                           # Cross-product contracts
│   ├── openapi/
│   └── events/
│
└── CLAUDE.md
```

---

#### Template 3: Marketing Site (separate repo — different team)

```
marketing/
├── src/
│   ├── pages/
│   ├── content/
│   └── components/
├── astro.config.ts
├── CLAUDE.md
└── vercel.json
```

---

### API Codegen Pipeline

**The core rule: No manual type definitions for API calls. Ever.**

Today all three products use plain `fetch()` with hand-typed responses. This means:

- Types drift from the actual API (silent bugs)
- Agents can't discover what APIs exist by reading types
- Renaming an API field doesn't cause a compile error in the frontend
- Every developer re-invents the fetch wrapper

**The codegen pipeline eliminates all of this.**

#### Two paths, one rule

| Situation                                                                        | Tool                    | How it works                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Same-repo, same-language** (Elysia API + React UI in one TypeScript workspace) | **Elysia Eden treaty**  | Frontend imports the API's type directly. Zero codegen — TypeScript inference handles everything. Compile-time error if API changes.       |
| **Cross-repo or cross-language** (React UI → Java/Python/Go service)             | **@hey-api/openapi-ts** | Service generates OpenAPI spec → spec committed to `specs/` dir → frontend runs `openapi-ts` → generates typed client + React Query hooks. |

#### How Eden treaty works (same-repo)

Already proven in Factory CLI (`cli/src/client.ts`):

```
api/src/server.ts          → Elysia app with routes
api/src/app-type.ts        → exports `type AppType = typeof app`
                                    ↓ (TypeScript type import, no runtime)
ui/src/lib/api/factory.ts  → `treaty<AppType>(baseUrl)` → fully typed client
```

**What the agent sees:** It can inspect `AppType` and see every route, every parameter, every response type. The type IS the documentation.

**What changes:** Factory UI switches from plain fetch to Eden treaty (the CLI already does this). Smart Market and Traffic do the same for their Elysia APIs.

#### How @hey-api/openapi-ts works (cross-service)

Already proven in Smart Market (`openapi-ts.config.ts`):

```
Java service (Spring Boot)
  → springdoc generates /v3/api-docs (OpenAPI spec)
  → CI extracts to specs/data-service.v1.yaml

Frontend repo
  → openapi-ts.config.ts points at specs/data-service.v1.yaml
  → `pnpm generate` creates:
      ui/src/lib/api/data-service/
      ├── client.gen.ts    # Typed fetch functions
      ├── types.gen.ts     # Request/response TypeScript types
      └── hooks.gen.ts     # React Query hooks (useGetDatasets, useCreateDataset, ...)
```

**What the agent sees:** Generated types in the codebase. It knows every endpoint, every parameter, every response shape. It can write `useGetDatasets({ query: { orgId } })` and TypeScript catches errors.

**The `openapi-ts.config.ts` file per frontend:**

```typescript
// ui/openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig([
  // Cross-service: Java data service
  {
    input: "../smart-market-services/specs/data-service.v1.yaml", // or URL
    output: "src/lib/api/data-service",
    plugins: [
      { name: "@hey-api/client-fetch" },
      {
        name: "@tanstack/react-query",
        queryOptions: true,
        queryKeys: true,
        mutationOptions: true,
      },
    ],
  },
  // Cross-service: Java graph service
  {
    input: "../platform/schemas/openapi/graph-service.v1.yaml",
    output: "src/lib/api/graph-service",
    plugins: [
      { name: "@hey-api/client-fetch" },
      { name: "@tanstack/react-query" },
    ],
  },
])
```

#### CI pipeline for spec extraction

```yaml
# .github/workflows/ci-openapi.yml
# Runs when Java/Python/Go service code changes

steps:
  - name: Start service
    run: dx up service-data

  - name: Extract OpenAPI spec
    run: |
      curl -s http://localhost:8084/v3/api-docs.yaml > specs/data-service.v1.yaml

  - name: Check for breaking changes
    run: |
      npx @hey-api/openapi-ts diff \
        --old specs/data-service.v1.yaml \
        --new /tmp/new-spec.yaml

  - name: Commit updated spec
    run: |
      git add specs/
      git diff --cached --quiet || git commit -m "chore: update data-service OpenAPI spec"
```

#### What this means for agents

Before (today):

```
Agent: "I need to call the data service from the frontend"
→ Searches for fetch calls, finds 5 different manual wrappers
→ Guesses the response type from usage
→ Writes a new fetch call with hand-typed response
→ Types might be wrong, discovered at runtime
```

After (with codegen):

```
Agent: "I need to call the data service from the frontend"
→ Reads ui/src/lib/api/data-service/types.gen.ts
→ Sees every endpoint, parameter, and response type
→ Imports useGetDatasets from hooks.gen.ts
→ TypeScript validates everything at compile time
→ Zero chance of type mismatch
```

#### Codegen conventions

1. **Generated files end in `.gen.ts`.** Never edit them. They have a header comment: `// This file is auto-generated. Do not edit.`
2. **`pnpm generate`** runs all codegen (openapi-ts + any other generators). Runs in CI and locally.
3. **Generated files ARE committed to git.** This way agents and humans see the types without running codegen first. PRs show type changes as diffs.
4. **OpenAPI specs ARE committed to git** (in `specs/` or `platform/schemas/openapi/`). They are the contract. Breaking changes are visible in PR diffs.
5. **Eden treaty requires no codegen** for same-repo Elysia APIs. The type import is enough. But the API still generates an OpenAPI spec (for documentation, cross-repo consumers, and Scalar UI).
6. **Every API has an OpenAPI endpoint.** Elysia: `@elysiajs/openapi`. Spring Boot: `springdoc-openapi`. FastAPI: built-in. Go: `swaggo/swag`. No exceptions.

---

## What Stays Product-Specific (Not Worth Converging)

| Product      | Stays Local                                                                                                                                                                                                                                                                                 | Reason                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Factory      | PowerSync + MongoDB (realtime sync), NATS subject hierarchy, God Workflow + deployment-specific steps (workbench, K8s, Proxmox), Factory-specific agent tools (git operations, deploy commands), Proxmox/K8s/SNMP clients                                                                   | Core to Factory's infrastructure orchestration domain |
| Traffic      | Kafka + Debezium CDC pipeline (bronze/silver/gold), Iceberg + Nessie (Tier 2 data versioning), Airflow DAGs (Python ETL), PostgREST (auto-generated REST from Postgres), PgBouncer (connection pooling), traffic-specific metrics engine (Spring Boot), baseline/forecast computation       | Domain-specific data pipeline and real-time analytics |
| Smart Market | TimescaleDB hypertables, ML Engine (Python: scikit-learn, LightGBM, H3, rasterio), BullMQ PDF generation queue, Puppeteer headless rendering, Twilio WhatsApp (as notification adapter, not hardcoded), data-processing Temporal workflows (Python), Cube.js data models (product-specific) | Domain-specific ML, geospatial analytics, reporting   |

---

## Verification

### Infrastructure phases (1-3)

1. `dx up` starts all infrastructure services with health checks passing
2. `dx status` shows green for all services
3. `dx dev` starts all dev servers
4. Product test suites pass (`pnpm test` / `mvn test`)
5. OTel traces appear in HyperDX for all services
6. Auth flow works end-to-end: login → JWT → API call → authorized response

### Application module phases (4-7)

7. `@lepton/notifications` — send a test notification via each adapter (Slack, email, in-app). Verify delivery tracking in `event_delivery` table
8. `@lepton/storage` — upload a file via presigned URL, download it, verify content matches
9. `service-graph` — register an entity via API, query it back with attributes and relationships
10. `infra-cube` — query a metric via Cube.js SQL API (port 15432), verify result matches raw Postgres query
11. `@lepton/agents` — start an agent session, ask it to list tables, verify it returns correct schema
12. `@lepton/workflow-steps` — run a workflow with the `notify` step, verify notification was delivered
13. Each product's frontend shows agent sessions via @rio.js/agents-ui connected to real backend

### Repo & agentic phases (7-8)

14. Platform repo builds cleanly: `pnpm install && pnpm build` (TS), `mvn install` (Java)
15. Products consume platform packages from registry, not local paths
16. Every service has a CLAUDE.md that an agent can read and immediately start working
17. Two git worktrees of the same product repo can run `dx dev` simultaneously on different ports
18. OpenAPI specs are committed and diffed in CI — breaking changes are caught

### Cross-product validation

19. A developer can `dx up && dx dev` in any of the three products and have all shared services running
20. Ontology changes in the Graph Service are visible from all three products' dashboards
21. A notification type defined in one product uses the same adapter infrastructure as all others
22. An AI agent given only a service's CLAUDE.md can: start the service, run tests, add an endpoint, and create a PR
