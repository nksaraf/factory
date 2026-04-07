# v1 → v2 Migration Manifest

Tracks every v1 file's fate during the ontology migration. Every file deletion must appear in either a "replaced by" column or the "Intentionally removed" section. If it's in neither, it's a bug.

**Status key:** `pending` | `in-progress` | `done` | `n/a`

---

## Controllers (v1 → v2)

| v1 file | v2 replacement | Status | Notes |
|---------|---------------|--------|-------|
| `modules/agent/index.ts` | `modules/agent/index.v2.ts` | pending | |
| `modules/build/index.ts` | `modules/build/index.v2.ts` | pending | |
| `modules/build/git-host.controller.ts` | `modules/build/index.v2.ts` (git-host-providers entity) | pending | Actions: create-pr, merge-pr |
| `modules/build/pipeline-run.controller.ts` | `modules/build/index.v2.ts` (pipeline-runs entity) | pending | |
| `modules/build/webhook.controller.ts` | stays (webhook ingress, not entity CRUD) | n/a | Keep as-is |
| `modules/commerce/index.ts` | `modules/commerce/index.v2.ts` | pending | |
| `modules/fleet/index.ts` | `modules/fleet/index.v2.ts` | pending | |
| `modules/health/index.ts` | stays (not entity CRUD) | n/a | Keep as-is |
| `modules/identity/index.ts` | `modules/identity/index.v2.ts` | pending | |
| `modules/identity/identity.controller.ts` | `modules/identity/index.v2.ts` (principals entity) | pending | Actions: link-identity, add-ssh-key |
| `modules/identity/secret.controller.ts` | `modules/infra/index.v2.ts` (secrets entity) | pending | Moved to infra domain |
| `modules/infra/index.ts` | `modules/infra/index.v2.ts` | pending | |
| `modules/infra/access.controller.ts` | `modules/infra/index.v2.ts` (substrates entity) | pending | |
| `modules/infra/gateway.controller.ts` | `modules/infra/index.v2.ts` (routes + dns-domains) | pending | |
| `modules/infra/preview.controller.ts` | `modules/build/index.v2.ts` or fleet (TBD) | pending | Preview lifecycle |
| `modules/infra/sandbox.controller.ts` | `modules/fleet/index.v2.ts` (workspaces entity) | pending | sandbox→workspace |
| `modules/memory/index.ts` | `modules/agent/index.v2.ts` (memory entity) | pending | Moved to agent domain |
| `modules/messaging/index.ts` | `modules/messaging/index.v2.ts` | pending | |
| `modules/messaging/messaging.controller.ts` | `modules/messaging/index.v2.ts` (providers entity) | pending | Actions: map-channel, unmap-channel, link-user |
| `modules/messaging/messaging-webhook.controller.ts` | stays (webhook ingress) | n/a | Keep as-is |
| `modules/observability/index.ts` | stays (adapter, not entity CRUD) | n/a | Keep as-is |
| `modules/presence/index.ts` | stays (WebSocket, not entity CRUD) | n/a | Keep as-is |
| `modules/product/index.ts` | `modules/product/index.v2.ts` | pending | |
| `modules/release-content/index.ts` | `modules/product/index.v2.ts` (releases actions) | pending | Actions: generate, promote |
| `modules/site/index.ts` | `modules/fleet/index.v2.ts` (sites entity) | pending | |

## Services

| v1 file | Status | Notes |
|---------|--------|-------|
| `modules/agent/preset.service.ts` | pending | Needs v2 schema imports |
| `modules/build/git-host.service.ts` | pending | Needs build-v2 imports |
| `modules/build/plane.service.ts` | pending | Needs build-v2 imports |
| `modules/build/webhook.service.ts` | pending | Needs build-v2 imports |
| `modules/commerce/bundle.service.ts` | pending | Needs commerce-v2 imports |
| `modules/commerce/plane.service.ts` | pending | Needs commerce-v2 imports |
| `modules/fleet/install-manifest.service.ts` | pending | Needs ops imports |
| `modules/fleet/plane.service.ts` | pending | Needs ops imports |
| `modules/fleet/workbench.service.ts` | pending | Needs ops imports |
| `modules/identity/identity-sync.service.ts` | pending | Needs org-v2 imports |
| `modules/identity/identity.service.ts` | pending | Needs org-v2 imports |
| `modules/infra/gateway.service.ts` | pending | Needs infra-v2 imports |
| `modules/messaging/messaging.service.ts` | pending | Needs org-v2 imports |
| `modules/release-content/service.ts` | pending | Needs software-v2 imports |
| `services/build/pipeline-run.service.ts` | pending | Needs build-v2 imports |
| `services/catalog/catalog-sync.service.ts` | pending | Needs software-v2 imports |
| `services/infra/access.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/assets.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/cluster.service.ts` | pending | cluster→runtime, infra-v2 imports |
| `services/infra/host.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/ipam.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/kube-node.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/provider.service.ts` | pending | provider→substrate, infra-v2 imports |
| `services/infra/region.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/ssh-key.service.ts` | pending | Needs org-v2 imports |
| `services/infra/vm-cluster.service.ts` | pending | Needs infra-v2 imports |
| `services/infra/vm.service.ts` | pending | Needs infra-v2 imports |
| `services/preview/preview.service.ts` | pending | Needs build-v2 + ops imports |
| `services/product/work-tracker.service.ts` | pending | Needs build-v2 imports |
| `services/sandbox/sandbox-template.service.ts` | pending | sandbox→workspace, ops imports |
| `services/sandbox/sandbox.service.ts` | pending | sandbox→workspace, ops imports |

## Sync Loops

| v1 file | Status | Notes |
|---------|--------|-------|
| `lib/git-host-sync-loop.ts` | pending | Needs build-v2 imports |
| `lib/identity-sync-loop.ts` | pending | Needs org-v2 imports |
| `lib/messaging-sync-loop.ts` | pending | Needs org-v2 imports |
| `lib/proxmox/sync-loop.ts` | pending | Needs infra-v2 imports |
| `lib/work-tracker/sync-loop.ts` | pending | Needs build-v2 imports |

## Schema Files (v1 → v2)

| v1 file | v2 replacement | Status | Notes |
|---------|---------------|--------|-------|
| `db/schema/agent.ts` | `db/schema/org-v2.ts` (agent, job, memory tables) | pending | Delete after service migration |
| `db/schema/build.ts` | `db/schema/build-v2.ts` | pending | Delete after service migration |
| `db/schema/catalog.ts` | `db/schema/software-v2.ts` | pending | module→system, component_spec→component |
| `db/schema/commerce.ts` | `db/schema/commerce-v2.ts` | pending | entitlement→subscription |
| `db/schema/fleet.ts` | `db/schema/ops.ts` | pending | sandbox→workspace, deployment_target→system_deployment |
| `db/schema/gateway.ts` | `db/schema/infra-v2.ts` (route, dns_domain) | pending | gateway_route→route, gateway_domain→dns_domain |
| `db/schema/infra.ts` | `db/schema/infra-v2.ts` | pending | provider→substrate, cluster→runtime |
| `db/schema/org.ts` | `db/schema/org-v2.ts` | pending | Added principal, scope, identity_link, ssh_key |
| `db/schema/product.ts` | `db/schema/software-v2.ts` | pending | module_version→release, workload→component_deployment |
| `db/schema/index.ts` | `db/schema/index.ts` (rewrite) | pending | Update barrel exports |

**Post-migration renames:**
- `software-v2.ts` → `software.ts`
- `org-v2.ts` → `org.ts`
- `infra-v2.ts` → `infra.ts`
- `build-v2.ts` → `build.ts`
- `commerce-v2.ts` → `commerce.ts`

## V2 Infrastructure (new files — no v1 equivalent)

| File | Purpose | Status |
|------|---------|--------|
| `db/schema/helpers.ts` | Column helper functions (specCol, metadataCol, etc.) | done |
| `db/schema/ops.ts` | Operational tables (workspace, site, rollout, etc.) | done |
| `db/temporal.ts` | Bitemporal query helpers | done |
| `lib/crud.ts` | ontologyRoutes() CRUD factory | done |
| `lib/errors.ts` | Typed error classes | done |
| `lib/pagination.ts` | Pagination helpers | done |
| `lib/resolvers.ts` | Slug/ID resolution helpers | done |
| `lib/responses.ts` | Standard response helpers | done |
| `plugins/v2-switch.plugin.ts` | X-Factory-V2 header routing | done (delete in Phase 7) |
| `plugins/error-handler.plugin.ts` | Global error handler | done |
| `modules/infra/route-resolver.ts` | Route target resolution | done |

## Test Files

| Test file | Migration scope | Status |
|-----------|----------------|--------|
| `__tests__/sandbox-controller.test.ts` | `/infra/sandboxes` → `/fleet/workspaces` | pending |
| `__tests__/infra-controller.test.ts` | providers→substrates, clusters→runtimes | pending |
| `__tests__/preview-controller.test.ts` | deploymentTarget→systemDeployment | pending |
| `__tests__/pipeline-run.test.ts` | Minor field updates | pending |
| `__tests__/observability-controller.test.ts` | Minimal changes | pending |
| `__tests__/sandbox-service.test.ts` | ops.workspace instead of fleet.sandbox | pending |
| `__tests__/fleet-service.test.ts` | ops.site, ops.system_deployment | pending |
| `__tests__/infra-services.test.ts` | infra-v2 imports | pending |
| `__tests__/gateway-service.test.ts` | infra-v2 (route, dns_domain) | pending |
| `__tests__/gateway-services.test.ts` | Same as above | pending |
| `__tests__/git-host-service.test.ts` | build-v2 imports | pending |
| `__tests__/webhook-dispatch.test.ts` | Fixture updates | pending |
| `__tests__/reconciler.test.ts` | All v2 tables, cross-schema joins | pending |
| `__tests__/resource-generator.test.ts` | component, system_deployment | pending |
| `__tests__/sandbox-resource-generator.test.ts` | sandbox→workspace | pending |
| `__tests__/e2e-preview-lifecycle.test.ts` | Full vocabulary update | pending |
| `__tests__/route-resolver.test.ts` | Already uses v2 patterns | done |
| `__tests__/network-link.test.ts` | Already uses v2 patterns | done |

## CLI Commands

| v1 command | v2 command | Status | Notes |
|-----------|-----------|--------|-------|
| `dx module` | `dx system` | pending | module→system |
| `dx sandbox` | `dx workspace` | pending | sandbox→workspace |
| `dx cluster` | `dx runtime` | pending | cluster→runtime |
| `dx entitlement` | `dx subscription` | pending | entitlement→subscription |
| `dx infra` (provider subcommand) | `dx infra` (substrate subcommand) | pending | provider→substrate |
| `dx infra` (subnet subcommand) | removed | pending | Folded into substrate spec |
| `dx catalog` | TBD | pending | May become `dx software` |

## Plugins & Middleware

| File | Fate | Status |
|------|------|--------|
| `plugins/v2-switch.plugin.ts` | Delete in Phase 7 | pending |
| `plugins/error-handler.plugin.ts` | Keep | done |
| `config/env.ts` | Keep | done |

## Adapters

| File | Status | Notes |
|------|--------|-------|
| `adapters/adapter-registry.ts` | pending | May need v2 schema imports |
| `adapters/gateway-adapter.ts` | pending | May need infra-v2 types |
| `adapters/git-host-adapter-github.ts` | pending | May need build-v2 types |
| `adapters/git-host-adapter-noop.ts` | n/a | Noop adapter, no schema deps |
| `adapters/git-host-adapter.ts` | pending | Interface may reference v1 types |
| `adapters/messaging-adapter.ts` | pending | May need org-v2 types |
| `adapters/observability-adapter.ts` | n/a | No schema dependencies |
| `adapters/sandbox-adapter-noop.ts` | pending | sandbox→workspace naming |
| `adapters/sandbox-adapter.ts` | pending | sandbox→workspace naming |
| `adapters/vm-provider-adapter-proxmox.ts` | pending | May need infra-v2 types |
| `adapters/vm-provider-adapter.ts` | pending | May need infra-v2 types |
| `adapters/work-tracker-adapter.ts` | pending | May need build-v2 types |

---

## Intentionally Removed

| v1 feature/entity | Reason |
|-------------------|--------|
| `/infra/subnets` | Folded into substrate `spec.subnets` JSONB |
| `db/schema/gateway.ts` (as separate schema) | Routes and domains moved to infra domain |
| `deployment_target` (as entity name) | Renamed to `system_deployment` |
| `module_version` (as entity name) | Renamed to `release` (build domain) |
| `component_spec` (as entity name) | Renamed to `component` (software domain) |
| `workload` (as entity name) | Renamed to `component_deployment` (ops domain) |
| `agent_execution` (table) | Folded into `job` spec JSONB (execution details) |
| `channel_mapping` (table) | Folded into `messaging_provider` spec JSONB |
| `customer_account` (table) | Renamed to `customer` (commerce domain) |
| `datacenter` (table) | Folded into `substrate` spec JSONB (location/datacenter info) |
| `dependency_workload` (table) | Folded into `component_deployment` spec JSONB (dependencies array) |
| `domain` (gateway table) | Renamed to `dns_domain` (infra domain) |
| `entity_link` (catalog table) | Replaced by `entity_relationship` (software domain) |
| `kube_node` (table) | Folded into `runtime` spec JSONB (nodes array) |
| `message_thread` (table) | Folded into `messaging_provider` spec JSONB |
| `pipeline_step_run` (table) | Renamed to `pipeline_step` (build domain) |
| `principal_team_membership` (table) | Renamed to `membership` (org domain) |
| `region` (table) | Folded into `substrate` spec JSONB (regions array) |
| `release_bundle` (table) | Folded into `release` spec JSONB (bundles array) |
| `release_module_pin` (table) | Replaced by `release_artifact_pin` (software domain) |
| `resource` (catalog table) | Folded into `component` spec JSONB (resources) |
| `sandbox_template` (table) | Folded into `workspace` spec JSONB (template config) |
| `subnet` (table) | Folded into `substrate` spec JSONB (subnets array) |
| `vm` (table) | Managed externally by substrate adapter (Proxmox), not in factory DB |
| `vm_cluster` (table) | Managed externally by substrate adapter (Proxmox), not in factory DB |
| `workload_override` (table) | Folded into `component_deployment` spec JSONB (overrides) |

**Column migration pattern:** ~456 v1 flat columns moved into v2 `spec` JSONB columns. This is intentional — the JSONB-first design reduces schema churn and migration friction.

---

## Terminology Map

| Old | New | ID prefix |
|-----|-----|-----------|
| module | system | `mod_` → `sys_` |
| sandbox | workspace | `sbx_` → `wksp_` |
| cluster | runtime | `cls_` → `rtm_` |
| deployment_target | system_deployment | `dt_` → `sdpl_` |
| provider (infra) | substrate | `prv_` → `sub_` |
| subnet | (removed) | `sbn_` → removed |
| entitlement | subscription | — |
| module_version | release | `mvr_` → `rel_` |
| component_spec | component | `cmp_` (same) |
| workload | component_deployment | `wl_` → `cdpl_` |
