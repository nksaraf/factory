# v1 to v2 Migration Handoff

**Date:** 2026-04-04
**Branch:** `nksaraf/dx-cli-project-init-v1`
**Current state:** 79 TS errors, 62 core tests passing, v1+v2 coexist via `X-Factory-V2` header

---

## What's Done (Phases 0-6)

| Phase | Status | Summary                                                                                                                                                    |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-4   | Done   | 6 v2 Drizzle schemas (~55 tables), CRUD factory (`ontologyRoutes()`), v2 controllers for all 8 domains, Zod schemas, action body schemas                   |
| 5-pre | Done   | Snapshots captured: `snapshots/v1-openapi.json`, `snapshots/v1-entities.json`, `snapshots/v1-cli-commands.txt`, `snapshots/v2-entities.json`               |
| 5     | Done   | Tests updated to v2 vocabulary (4 core suites pass: fleet, gateway x2, infra)                                                                              |
| 6a-6f | Done   | Services migrated: gateway, access, git-host, build, fleet/workspace/snapshot/workbench, install-manifest, reconciler, agent executor, kubernetes strategy |

---

## What Remains

### Phase 7A: Remove v1 Controllers (~2-3 hours)

**Goal:** Make v2 the default path. Remove the v2 header switch.

#### Step 1: Update `factory.api.ts` assembly

File: `api/src/factory.api.ts`

1. Remove `v2Switch()` and `v2Proxy(v2App)` imports and usage
2. Remove `buildV2App()` private method
3. In `mountFactoryControllers()`, replace v1 controller mounts with v2:

| Remove (v1)                    | Replace with (v2)                                |
| ------------------------------ | ------------------------------------------------ |
| `productController(db)`        | `productControllerV2(db)`                        |
| `buildController(db)`          | `buildControllerV2(db)`                          |
| `agentController(db)`          | `agentControllerV2(db)`                          |
| `memoryController(db)`         | (fold into `agentControllerV2` or keep separate) |
| `commerceController(db)`       | `commerceControllerV2(db)`                       |
| `fleetController(db)`          | `fleetControllerV2(db)`                          |
| `identityController(db)`       | `identityControllerV2(db)`                       |
| `messagingController(db)`      | `messagingControllerV2(db)`                      |
| `infraController(db)`          | `infraControllerV2(db)`                          |
| `sandboxController(db, ...)`   | (covered by fleet workspaces in v2)              |
| `gatewayController(db)`        | (covered by infra v2)                            |
| `accessController(db)`         | (covered by infra v2)                            |
| `previewController(db)`        | (covered by infra v2)                            |
| `releaseContentController(db)` | (no v2 yet -- see Step 4)                        |

4. Keep these mounted as-is (no v2 equivalent needed):
   - `healthController` (stateless)
   - `observabilityController` (adapter-based, minimal schema dependency)
   - `presenceController` (WebSocket, no schema dependency)
   - `webhookController` (build webhooks -- already migrated to v2 tables)
   - `messagingWebhookController` (already works with v2)
   - `siteController` (site-mode only, separate concern)

#### Step 2: Create missing v2 controllers

These v1 controllers have no `index.v2.ts` yet:

| Module                             | Action needed                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/memory/index.ts`          | Create `index.v2.ts` using `ontologyRoutes()` against `org-v2.memory` table. Actions: approve, supersede, promote (schemas already in `shared/src/schemas/actions.ts`) |
| `modules/release-content/index.ts` | Create `index.v2.ts` using `ontologyRoutes()` against `software-v2.release` + `software-v2.component` tables                                                           |
| `modules/observability/index.ts`   | Low priority -- adapter-based, minimal schema coupling. Can stay as-is for now                                                                                         |
| `modules/presence/index.ts`        | No migration needed -- WebSocket, no schema dependency                                                                                                                 |
| `modules/health/index.ts`          | No migration needed -- stateless                                                                                                                                       |
| `modules/site/index.ts`            | No migration needed -- site-mode only                                                                                                                                  |

#### Step 3: Rename v2 files

After v1 controllers are removed:

```
modules/product/index.v2.ts   → modules/product/index.ts
modules/build/index.v2.ts     → modules/build/index.ts
modules/commerce/index.v2.ts  → modules/commerce/index.ts
modules/fleet/index.v2.ts     → modules/fleet/index.ts
modules/infra/index.v2.ts     → modules/infra/index.ts
modules/agent/index.v2.ts     → modules/agent/index.ts
modules/identity/index.v2.ts  → modules/identity/index.ts
modules/messaging/index.v2.ts → modules/messaging/index.ts
```

#### Step 4: Delete v1 controller files

```
DELETE modules/product/index.ts          (after rename above)
DELETE modules/build/index.ts            (after rename above)
DELETE modules/commerce/index.ts         (after rename above)
DELETE modules/fleet/index.ts            (after rename above -- current v1)
DELETE modules/infra/index.ts            (after rename above)
DELETE modules/infra/gateway.controller.ts
DELETE modules/infra/access.controller.ts
DELETE modules/infra/sandbox.controller.ts
DELETE modules/infra/preview.controller.ts
DELETE modules/identity/index.ts         (after rename above)
DELETE modules/identity/identity.controller.ts  (if separate)
DELETE modules/messaging/index.ts        (after rename above)
DELETE modules/memory/index.ts           (after v2 created + rename)
DELETE plugins/v2-switch.plugin.ts
```

#### Step 5: Delete v1 service files (after verifying no remaining callers)

```
DELETE services/sandbox/sandbox.service.ts         (replaced by fleet/workspace.service.ts)
DELETE services/sandbox/sandbox-template.service.ts (templates folded into workspace spec)
DELETE services/catalog/catalog-sync.service.ts     (5 TS errors, v1-only)
```

---

### Phase 7B: Remove v1 Schema Files (~1 hour)

**Prerequisite:** Phase 7A complete (no more v1 controller imports)

#### Step 1: Rename v2 schemas

```
db/schema/software-v2.ts  → db/schema/software.ts
db/schema/org-v2.ts        → db/schema/org.ts       (overwrites v1)
db/schema/infra-v2.ts      → db/schema/infra.ts     (overwrites v1)
db/schema/build-v2.ts      → db/schema/build.ts     (overwrites v1)
db/schema/commerce-v2.ts   → db/schema/commerce.ts  (overwrites v1)
```

#### Step 2: Delete v1 schema files

```
DELETE db/schema/agent.ts      (tables moved to org-v2)
DELETE db/schema/catalog.ts    (tables moved to software-v2)
DELETE db/schema/fleet.ts      (tables moved to ops)
DELETE db/schema/gateway.ts    (tables moved to infra-v2)
DELETE db/schema/product.ts    (tables moved to software-v2)
```

#### Step 3: Update barrel export

File: `db/schema/index.ts` -- remove `-v2` suffixes from all re-exports, remove v1 re-exports.

#### Step 4: Global import fixup

Find-and-replace across codebase:

```
from "../../db/schema/software-v2"  → from "../../db/schema/software"
from "../../db/schema/org-v2"       → from "../../db/schema/org"
from "../../db/schema/infra-v2"     → from "../../db/schema/infra"
from "../../db/schema/build-v2"     → from "../../db/schema/build"
from "../../db/schema/commerce-v2"  → from "../../db/schema/commerce"
```

Also update any relative path variations (`../db/schema/...`, etc.)

---

### Phase 7C: Migrate Remaining v1 Services (~2-3 hours)

These services still import from v1 schema files and need migration:

#### Infra services (largest batch -- 11 files)

| File                                   | v1 Import                 | v2 Target                     | Complexity                                                |
| -------------------------------------- | ------------------------- | ----------------------------- | --------------------------------------------------------- |
| `services/infra/provider.service.ts`   | `schema/infra` (provider) | `infra-v2` (substrate)        | Medium -- rename provider→substrate, flat cols→spec JSONB |
| `services/infra/cluster.service.ts`    | `schema/infra` (cluster)  | `infra-v2` (runtime)          | Medium -- rename cluster→runtime, flat cols→spec JSONB    |
| `services/infra/vm.service.ts`         | `schema/infra` (vm)       | `infra-v2` (host)             | Medium -- vm→host, 1 TS error                             |
| `services/infra/host.service.ts`       | `schema/infra` (host)     | `infra-v2` (host)             | Low -- same entity, just JSONB                            |
| `services/infra/ipam.service.ts`       | `schema/infra` (subnet)   | Remove or fold into substrate | Medium -- subnet removed in v2                            |
| `services/infra/region.service.ts`     | `schema/infra` (region)   | `infra-v2` (region)           | Low                                                       |
| `services/infra/kube-node.service.ts`  | `schema/infra` (kubeNode) | `infra-v2` (kubeNode)         | Low                                                       |
| `services/infra/ssh-key.service.ts`    | `schema/infra`            | `infra-v2`                    | Low                                                       |
| `services/infra/vm-cluster.service.ts` | `schema/infra`            | `infra-v2`                    | Low                                                       |
| `services/infra/assets.service.ts`     | `schema/infra`            | `infra-v2`                    | Low                                                       |
| `lib/proxmox/sync-loop.ts`             | `schema/infra`            | `infra-v2` (substrate)        | Medium -- provider→substrate                              |

#### Product/Build services

| File                                       | v1 Import                 | v2 Target                        | Complexity |
| ------------------------------------------ | ------------------------- | -------------------------------- | ---------- |
| `services/product/work-tracker.service.ts` | `schema/build`            | `build-v2` (workTrackerProvider) | Medium     |
| `lib/work-tracker/sync-loop.ts`            | `schema/build`            | `build-v2`                       | Medium     |
| `services/build/pipeline-run.service.ts`   | Check if already migrated | `build-v2`                       | Low        |

#### Fleet service (v1 remnant)

| File                             | v1 Import                      | v2 Target                                   | Complexity         |
| -------------------------------- | ------------------------------ | ------------------------------------------- | ------------------ |
| `modules/fleet/service.ts`       | `schema/fleet`                 | Delete (replaced by domain-scoped services) | Low -- just delete |
| `modules/fleet/plane.service.ts` | `schema/fleet` (releaseBundle) | Keep as v1 compat or migrate                | Medium             |

#### Org + Agent services (9 files on v1 `schema/org`, 5 on `schema/agent`)

| File                                        | v1 Import                                        | v2 Target                             | Complexity           |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------- | -------------------- |
| `modules/messaging/messaging.service.ts`    | `schema/org`                                     | `org-v2` (messagingProvider)          | Medium               |
| `modules/identity/identity.service.ts`      | `schema/org`                                     | `org-v2` (principal, orgMembership)   | Medium               |
| `modules/identity/identity-sync.service.ts` | `schema/org` + `schema/build` + `schema/product` | `org-v2` + `build-v2` + `software-v2` | High -- multi-schema |
| `modules/identity/secret.controller.ts`     | `schema/org`                                     | `org-v2` (secret)                     | Low                  |
| `modules/memory/memory.model.ts`            | `schema/org`                                     | `org-v2` (memory)                     | Low                  |
| `modules/agent/service.ts`                  | `schema/agent`                                   | `org-v2` (agent)                      | Medium               |
| `modules/agent/preset.service.ts`           | `schema/agent`                                   | `org-v2` (agentRolePreset)            | Low                  |
| `modules/agent/job.model.ts`                | `schema/agent`                                   | `org-v2` (job)                        | Low                  |
| `modules/agent/dispatch.ts`                 | `schema/agent`                                   | `org-v2` (job, agent)                 | Medium               |
| `lib/secrets/postgres-backend.ts`           | `schema/org`                                     | `org-v2` (secret)                     | Low                  |
| `lib/messaging-sync-loop.ts`                | `schema/org`                                     | `org-v2`                              | Medium               |
| `lib/identity-sync-loop.ts`                 | implicit via identity service                    | `org-v2`                              | Low                  |

#### Commerce services (2 files on v1 `schema/commerce`)

| File                                 | v1 Import         | v2 Target     | Complexity |
| ------------------------------------ | ----------------- | ------------- | ---------- |
| `modules/commerce/plane.service.ts`  | `schema/commerce` | `commerce-v2` | Medium     |
| `modules/commerce/bundle.service.ts` | `schema/commerce` | `commerce-v2` | Low        |

#### Other

| File                                      | v1 Import                         | v2 Target                  | Complexity         |
| ----------------------------------------- | --------------------------------- | -------------------------- | ------------------ |
| `modules/release-content/service.ts`      | `schema/product`/`schema/catalog` | `software-v2`              | Medium             |
| `modules/product/service.ts`              | `schema/product`                  | `software-v2`              | Medium             |
| `modules/build/plane.service.ts`          | `schema/build` + `schema/product` | `build-v2` + `software-v2` | Medium             |
| `lib/proxmox/resolve-vm.ts`               | `schema/infra`                    | `infra-v2`                 | Low                |
| `adapters/vm-provider-adapter-proxmox.ts` | `schema/infra`                    | `infra-v2`                 | Low -- 1 TS error  |
| `adapters/observability-adapter-demo.ts`  | Broken types                      | Fix types                  | Low -- 7 TS errors |
| `factory-core.ts` seed functions          | `schema/fleet`, `schema/infra`    | v2 tables                  | Medium             |

---

### Phase 7D: Fix Remaining TS Errors (~1 hour)

Current: **79 TS errors**. Breakdown by file:

| File                                          | Errors | Fix                                                         |
| --------------------------------------------- | ------ | ----------------------------------------------------------- |
| `__tests__/sandbox-authz.test.ts`             | 11     | Cast `.handle()` to `any`, update sandbox→workspace         |
| `__tests__/reconciler.test.ts`                | 8      | Already updated vocabulary -- fix remaining type mismatches |
| `__tests__/manual-preview-e2e.ts`             | 8      | Update preview test to v2 tables                            |
| `adapters/observability-adapter-demo.ts`      | 7      | Fix adapter interface types                                 |
| `__tests__/auth-resource-client.test.ts`      | 7      | Cast fetch mock to `typeof fetch`                           |
| `__tests__/authz-client.test.ts`              | 6      | Cast fetch mock to `typeof fetch`                           |
| `services/catalog/catalog-sync.service.ts`    | 5      | Delete (v1 only, replaced by v2 ontology)                   |
| `__tests__/manifest.test.ts`                  | 5      | Update manifest fixture shapes                              |
| `__tests__/e2e-preview-lifecycle.test.ts`     | 5      | Full vocabulary update                                      |
| `modules/build/build-api.integration.test.ts` | 3      | Update build test to v2 paths                               |
| `handler.ts`                                  | 3      | Update imports after schema renames                         |
| `__tests__/webhook-dispatch.test.ts`          | 3      | Update webhook fixtures                                     |
| `__tests__/sandbox-service.test.ts`           | 2      | workspace vocabulary update                                 |
| `__tests__/runtime-strategies.test.ts`        | 2      | cluster→runtime                                             |
| Remaining (4 files, 1 each)                   | 4      | Various fixes                                               |

---

### Phase 7-post: Contract Verification (~30 min)

After all v1 code is removed:

1. **API surface diff**: Capture v2 OpenAPI → diff against `snapshots/v1-openapi.json`
2. **Entity field coverage**: Generate v2 entity inventory → diff against `snapshots/v1-entities.json`
3. **Old terminology grep**: Zero hits for `factory_fleet.`, `factory_infra.`, `deployment_target`, `module_version`, `component_spec` in `api/` and `cli/`
4. **Full test suite**: `dx test` -- all green
5. **Update MIGRATION.md**: Mark all entries as done

---

### Phase 8: CLI Terminology Update (~2 hours)

#### Command renames

| Old file                          | New file                           | Old command      | New command       |
| --------------------------------- | ---------------------------------- | ---------------- | ----------------- |
| `cli/src/commands/module.ts`      | `cli/src/commands/system.ts`       | `dx module`      | `dx system`       |
| `cli/src/commands/sandbox.ts`     | `cli/src/commands/workbench.ts`    | `dx sandbox`     | `dx workbench`    |
| `cli/src/commands/cluster.ts`     | `cli/src/commands/runtime.ts`      | `dx cluster`     | `dx runtime`      |
| `cli/src/commands/entitlement.ts` | `cli/src/commands/subscription.ts` | `dx entitlement` | `dx subscription` |

#### API path updates inside commands

| Command                  | Old path                 | New path                            |
| ------------------------ | ------------------------ | ----------------------------------- |
| module/system            | `/product/modules`       | `/product/systems`                  |
| sandbox/workspace        | `/infra/sandboxes`       | `/fleet/workspaces`                 |
| cluster/runtime          | `/infra/clusters`        | `/infra/runtimes`                   |
| entitlement/subscription | `/commerce/entitlements` | `/commerce/subscriptions`           |
| infra                    | `/infra/providers`       | `/infra/substrates`                 |
| infra                    | `/infra/subnets`         | Remove (folded into substrate spec) |

#### Other CLI updates

- `cli/src/commands/infra.ts`: Rename `provider` subcommand → `substrate`, remove `subnet`
- `cli/src/lib/entity-finder.ts`: Update entity type names
- `cli/src/lib/toolchain-detector.ts`: No change needed
- `cli/src/handlers/docker-remote.ts`: sandbox → workspace if applicable
- `cli/src/commands/ssh.ts`: sandbox → workspace
- Update `cli/src/cli.ts` command registrations
- Optional: add backward-compat aliases with deprecation warnings

#### CLI test updates

- `cli/src/__tests__/dx-project-config.test.ts`
- `cli/src/__tests__/toolchain-detector.test.ts`
- `cli/src/__tests__/hooks.test.ts`

---

### Phase 9: Documentation Update (~1-2 hours)

Global search-and-replace across `docs/`:

| Old                 | New                                    |
| ------------------- | -------------------------------------- |
| module (as entity)  | system                                 |
| sandbox             | workspace                              |
| cluster (as entity) | runtime                                |
| deployment target   | system deployment                      |
| provider (infra)    | substrate                              |
| subnet              | (remove or "substrate network config") |
| entitlement         | subscription                           |
| module version      | release                                |
| component spec      | component                              |
| workload            | component deployment                   |

Key files:

- `docs/reference/unified-entity-map.md`
- `docs/guides/dx-developer-guide.md`
- `docs/software-factory/*.md`
- `CLAUDE.md` (if any old terminology)

---

## Execution Order

```
7A: Remove v1 controllers, wire v2 directly
  |
7B: Rename v2 schemas, delete v1 schemas, fix imports
  |
7C: Migrate remaining v1 services (infra batch is biggest)
  |
7D: Fix all TS errors → 0
  |
7-post: Contract verification (diff snapshots)
  |
8: CLI terminology update
  |
9: Docs update
```

**Each step should end with:**

- `npx tsc --noEmit` -- error count decreasing
- `dx test` -- no regressions
- `MIGRATION.md` updated

---

## Key Design Decisions to Preserve

1. **Spec JSONB pattern**: All v2 entities store domain data in `spec jsonb`. Access via `(row.spec as Record<string, any>).field`. Updates via spread: `{ ...spec, field: newValue } as any`.

2. **Lifecycle field**: Workspaces use `spec.lifecycle` (not `spec.status`): `provisioning` → `active` → `suspended` → `destroying` → `destroyed`.

3. **ontologyRoutes() CRUD factory**: Declarative route generation. Actions, relations, bitemporal soft-delete all configured via options object. See any `index.v2.ts` for examples.

4. **Repo-centric git operations**: PR/merge actions live on the repo entity (which has `gitHostProviderId` FK), not nested under git-host-provider. Legacy provider-level actions kept with `@deprecated` tag.

5. **ESM namespace workaround**: `factory-core.ts` filters objects with null prototypes before passing to drizzle. This is needed because `export * as X` creates namespace objects that crash drizzle's `is()` function.

6. **Release bundle v1 compat**: `install-manifest.service.ts` still imports `releaseBundle` from v1 `fleet` schema because there's no v2 equivalent yet. Concept should be folded into release spec JSONB when v2 `release` entity is fully wired.

---

## Code Review Findings (2026-04-04)

Final code review identified these issues to address during remaining phases:

### Critical (tracked in phases above)

1. **factory-core.ts split-brain**: Local dev (`dx dev`) mounts v1 controllers + seeds v1 tables. V2 services read v2 tables = data divergence. Fix in Phase 7A Step 1.
2. **install-manifest.service.ts v1 dependency**: `releaseBundle` from `fleet` schema. Either migrate to v2 ops or explicitly defer. Tracked in Phase 7C.
3. ~~**Deprecated alias in reconciler**~~: Fixed -- `reconcileSandbox` call replaced with `reconcileWorkspace`.

### Important (fix during Phase 7)

4. **~30 files still import v1 schemas**: org (9 files), agent (5), infra (14), build (6), product (6), fleet (3), commerce (2). Full inventory in Phase 7C tables above.
5. **workspace.service.ts uses v1 adapter interface**: `SandboxAdapter.provision()` with `deploymentTargetId`. Rename adapter interface in Phase 7 or 8.
6. **Gateway stores workspace ID as `systemDeploymentId`**: Semantically incorrect but functional. Clean up when gateway route model is revisited.
7. **Reconciler `v2Route.status` vs gateway `spec.status`**: Verify these are the same table or document the distinction.

### Suggestions

8. **Typed spec helpers**: Consider `readSpec<T>(entity)` instead of `(entity.spec as any)` everywhere.
9. **Clone snapshot returns 501**: `cloneFromSnapshot()` is implemented in service but controller returns "not implemented". Wire it or document why.

---

## Quick Reference: File Locations

| What                  | Where                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| v2 CRUD factory       | `api/src/lib/crud.ts`                                                         |
| v2 controllers        | `api/src/modules/*/index.v2.ts`                                               |
| v2 schemas            | `api/src/db/schema/{ops,infra-v2,build-v2,software-v2,org-v2,commerce-v2}.ts` |
| Zod body schemas      | `shared/src/schemas/actions.ts`                                               |
| Zod CRUD schemas      | `shared/src/schemas/{ops,infra,build,software,org,commerce}.ts`               |
| v1 snapshots          | `snapshots/v1-*.json`, `snapshots/v1-cli-commands.txt`                        |
| Migration manifest    | `MIGRATION.md`                                                                |
| Test helpers          | `api/src/test-helpers.ts`                                                     |
| Main assembly         | `api/src/factory.api.ts`                                                      |
| v2 switch (to delete) | `api/src/plugins/v2-switch.plugin.ts`                                         |
