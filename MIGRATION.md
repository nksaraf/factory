# Ontology migration — reference

**Purpose:** Preserve the **terminology map** (old names → current ontology) and the **intentionally removed** v1-era tables/features.

**Status:** The migration **described in older versions of this file is complete** in the current codebase: there is no dual v1/v2 controller stack, no `X-Factory-V2` plugin, and no legacy pre-ontology `db/schema/{org,fleet,infra,...}.ts` tree — live Drizzle modules are `org.ts`, `infra.ts`, `software.ts`, `build.ts`, `commerce.ts`, and `ops.ts`.

For **how the app is wired today**, see **`HANDOFF.md`** (assembly, glossary, schema layout).

---

## Glossary pointer

- **`/api/v1/...` in URLs** = HTTP versioning, **not** “v1 schema.”
- **Drizzle filenames** (`org.ts`, `infra.ts`, …) are the current ontology layout, distinct from HTTP `/api/v1/...`.

---

## Migration completion summary (verified)

| Area                                                                    | State                                                                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Drizzle v1 schema files (`db/schema/org.ts`, `fleet.ts`, …)             | **Removed** — replaced by ontology `org.ts`, `infra.ts`, `software.ts`, `build.ts`, `commerce.ts`, and `ops.ts` |
| `plugins/v2-switch.plugin.ts`                                           | **Removed**                                                                                                     |
| `factory.api.ts` / `factory-core.ts`                                    | Mount **`opsController`** + other ontology `*Controller`; prefix **`/api/v1/factory`**                          |
| `modules/fleet/` as a directory                                         | **Absent** — fleet-shaped HTTP surface lives under **ops** controller + `ops` schema                            |
| Large v1 `services/*` tree (sandbox, catalog-sync, many infra services) | **Absent** from current `api/src/services/`                                                                     |

Legacy **per-file** checklists in older commits listed many `pending` rows; those files either **no longer exist** or **already import** the current `db/schema/*` modules. Do not treat the old tables below as current work queues without re-auditing the path.

---

## Controllers — historical mapping (for blame / archaeology)

The **v1** entry in the left column referred to **deleted** monolith routers. **Live** ontology controllers are `modules/*/index.ts` (plus focused files like `health/index.ts`, `webhook.controller.ts`, `site/index.ts`, `documents/index.ts`, and `messaging/messaging-ontology.controller.ts` + webhook exports from `messaging/index.ts`).

`secret.controller.ts` remains under **identity** (not infra) in current `factory.api.ts`.

---

## Terminology map

| Old               | New                           | ID prefix notes              |
| ----------------- | ----------------------------- | ---------------------------- |
| module            | system                        | `mod_` → `sys_`              |
| sandbox           | workspace                     | `sbx_` → `wksp_`             |
| cluster           | runtime                       | `cls_` → `rtm_`              |
| deployment_target | system_deployment             | `dt_` → `sdpl_`              |
| provider (infra)  | substrate                     | `prv_` → `sub_`              |
| subnet            | (removed as top-level entity) | folded into substrate `spec` |
| entitlement       | subscription                  | —                            |
| module_version    | release                       | `mvr_` → `rel_`              |
| component_spec    | component                     | `cmp_` (often retained)      |
| workload          | component_deployment          | `wl_` → `cdpl_`              |

---

## Intentionally removed

| v1 feature / entity                         | Reason                                      |
| ------------------------------------------- | ------------------------------------------- |
| `/infra/subnets`                            | Folded into substrate `spec.subnets` JSONB  |
| `db/schema/gateway.ts` (as separate schema) | Routes and domains in infra domain          |
| `deployment_target` (name)                  | `system_deployment`                         |
| `module_version` (name)                     | `release` (build domain)                    |
| `component_spec` (name)                     | `component` (software domain)               |
| `workload` (name)                           | `component_deployment` (ops domain)         |
| `agent_execution` (table)                   | Folded into `job` spec JSONB                |
| `channel_mapping` (table)                   | Folded into `messaging_provider` spec JSONB |
| `customer_account` (table)                  | `customer` (commerce)                       |
| `datacenter` (table)                        | Folded into substrate spec                  |
| `dependency_workload` (table)               | Folded into `component_deployment` spec     |
| `domain` (gateway table)                    | `dns_domain` (infra)                        |
| `entity_link` (catalog)                     | `entity_relationship` (software)            |
| `kube_node` (table)                         | Folded into `runtime` spec                  |
| `message_thread` (table)                    | Folded into `messaging_provider` spec       |
| `pipeline_step_run` (table)                 | `pipeline_step` (build)                     |
| `principal_team_membership` (table)         | `membership` (org)                          |
| `region` (table)                            | Folded into substrate spec                  |
| `release_bundle` (table)                    | Folded into `release` spec                  |
| `release_module_pin` (table)                | `release_artifact_pin` (software)           |
| `resource` (catalog)                        | Folded into `component` spec                |
| `sandbox_template` (table)                  | Folded into `workspace` spec                |
| `subnet` (table)                            | Folded into substrate spec                  |
| `vm` / `vm_cluster` (tables)                | External to Factory DB where applicable     |
| `workload_override` (table)                 | Folded into `component_deployment` spec     |

**Pattern:** Many v1 flat columns moved into ontology **`spec` JSONB** to reduce migration churn.

---

## Snapshots

Historical comparison artifacts may live under `snapshots/` (e.g. `v1-api-routes.txt`, `v1-openapi.json`). Filenames reflect **capture era**, not “supported API version.”
