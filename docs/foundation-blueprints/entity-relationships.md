## Global conventions

All relationships below assume stable IDs:

- `factory_id` (usually 1)
- `site_id`
- `namespace_id`
- `module_id`, `module_version_id`
- `module_instance_id`
- `principal_id` (user/agent/service account)
- `agent_id`
- `release_id`
- `deployment_id` (alias of `site_id` if you want)
- `policy_id`, `role_id`, `permission_id`
- `artifact_id`, `build_id`, `pr_id`
- `license_id`, `entitlement_bundle_id`
- `usage_record_id`

---

# 1) Factory systems of record (planes) — entities + relationships

## A. Product Plane (work + release intent)

**Entities**

- `product` (optional, if you want multiple product areas)
- `initiative`
- `epic`
- `module`
- `story`
- `task`
- `milestone`
- `release_plan`
- `release_note_entry`
- `changelog_entry`
- `module_roadmap_item` (optional: link work to modules)

**Relationships**

- `product` 1—N `initiative`
- `initiative` 1—N `epic`
- `epic` 1—N `story`
- `story` 1—N `task`
- `milestone` 1—N `release_plan`
- `release_plan` N—M `story` (a release includes many stories; a story can be rescheduled)
- `release_plan` N—M `module` (optional, if release is module-scoped)
- `release_plan` 1—N `release_note_entry`
- `release_plan` 1—N `changelog_entry`

---

## B. Build Plane (code + PRs + builds + artifacts)

**Entities**

- `repo`
- `branch`
- `commit`
- `pull_request`
- `pr_review`
- `ci_pipeline`
- `ci_run`
- `build` (build record; often 1–1 with a CI run, but keep separate)
- `artifact` (image/binary/bundle)
- `artifact_signature`
- `sbom`
- `vulnerability_report`
- `test_report`
- `module_version` (links module to artifacts + metadata)

**Relationships**

- `repo` 1—N `branch`
- `repo` 1—N `commit`
- `branch` 1—N `commit`
- `repo` 1—N `pull_request`
- `pull_request` N—M `commit` (PR has many commits; commits can be in multiple PRs via cherry-picks; model as join table)
- `pull_request` 1—N `pr_review`
- `ci_pipeline` 1—N `ci_run`
- `pull_request` 1—N `ci_run` (PR triggers runs)
- `commit` 1—N `ci_run` (commit triggers runs)
- `ci_run` 1—1 `build` (often; allow 1—N if you split build steps)
- `build` 1—N `artifact`
- `artifact` 1—1 `artifact_signature` (or 1—N if multiple signing schemes)
- `artifact` 1—1 `sbom` (or 1—N if regenerated)
- `build` 1—N `test_report`
- `build` 1—N `vulnerability_report`
- `module` 1—N `module_version`
- `module_version` 1—N `artifact` (a module version produces multiple artifacts: api/worker/ui)
- `module_version` N—M `module_version` (dependencies/compat graph: “requires”, “compatible_with” edges)

**Bridge into Product Plane**

- `task` N—M `pull_request` (a task can have multiple PRs; PR can address multiple tasks)

---

## C. Agent Plane (agent registry + execution + memory)

**Entities**

- `agent`
- `agent_identity` (optional if you unify with principals; recommended)
- `agent_capability`
- `agent_tool_grant`
- `agent_queue`
- `agent_task` (work item assigned to an agent; not the same as Product task)
- `agent_execution`
- `agent_execution_step` (tool calls)
- `agent_memory_store`
- `agent_memory_item` (documents/embeddings/notes)
- `agent_metric` (optional)

**Relationships**

- `agent` 1—N `agent_capability`
- `agent` 1—N `agent_tool_grant`
- `agent_queue` 1—N `agent_task`
- `agent` 1—N `agent_execution`
- `agent_task` 1—N `agent_execution` (retries)
- `agent_execution` 1—N `agent_execution_step`
- `agent` 1—1 `agent_memory_store`
- `agent_memory_store` 1—N `agent_memory_item`

**Bridges**

- `agent_task` N—M `task` (Product tasks)
- `agent_execution` N—M `pull_request` (if you want traceability: “this run opened PR #123”)

---

## D. Commerce Plane (plans, licenses, entitlements, billing)

**Entities**

- `product_sku`
- `plan`
- `addon`
- `price`
- `customer_account` (the buyer entity; may be vendor-internal or partner)
- `contract` / `subscription`
- `license`
- `entitlement_bundle` (signed blob delivered to a site)
- `entitlement_item` (feature/module/quota line items)
- `quota_definition`
- `invoice`
- `payment`
- `usage_record` (aggregated metering)
- `overage_event` (optional)

**Relationships**

- `product_sku` 1—N `plan`
- `plan` N—M `addon`
- `plan` 1—N `quota_definition`
- `customer_account` 1—N `subscription`
- `subscription` 1—N `license` (or 1—1 if you keep it simple)
- `license` 1—N `entitlement_bundle`
- `entitlement_bundle` 1—N `entitlement_item`
- `entitlement_item` N—1 `module` (module enablement) OR N—1 `feature_flag` (if you model features separately)
- `subscription` 1—N `invoice`
- `invoice` 1—N `payment`
- `usage_record` N—1 `subscription`
- `usage_record` N—1 `site` (if metering is site-scoped)
- `usage_record` N—1 `namespace` (if metering is namespace-scoped)

---

## E. Fleet Plane (sites, releases, rollouts)

**Entities**

- `site` (deployment)
- `environment` (dev/staging/prod) (or attribute on site)
- `site_channel` (beta/stable) (optional)
- `release` (a deployable bundle; not just a product plan)
- `release_module_pin` (which module_version is included)
- `rollout`
- `rollout_step`
- `site_upgrade`
- `site_health_snapshot`
- `site_secret_bundle` (optional; bootstrap materials)
- `site_manifest` (desired state)

**Relationships**

- `release` 1—N `release_module_pin`
- `release_module_pin` N—1 `module_version`
- `site` 1—N `rollout`
- `rollout` 1—N `rollout_step`
- `rollout` N—1 `release`
- `site` 1—N `site_upgrade`
- `site_upgrade` N—1 `release`
- `site` 1—N `site_health_snapshot`
- `license` 1—N `site` (if one license covers many sites) OR `site` 1—1 `license` (common)

**Bridge from Product to Fleet**

- `release_plan` N—M `release` (product intent maps to actual deployable release bundles; keep as join)

---

## F. Infrastructure Plane (inventory + clusters + networking + PKI)

You can keep this plane “thin” in DB or very detailed. Minimal viable inventory:

**Entities**

- `cluster`
- `node_pool`
- `node`
- `network_segment` (vpc/subnet)
- `dns_zone`
- `certificate_authority`
- `certificate`
- `secret_store`
- `registry`
- `storage_pool`

**Relationships**

- `site` 1—N `cluster` (or 1—1 if each site is a single cluster)
- `cluster` 1—N `node_pool`
- `node_pool` 1—N `node`
- `cluster` N—M `network_segment`
- `dns_zone` 1—N `site` (or N—M)
- `certificate_authority` 1—N `certificate`
- `site` 1—N `certificate` (site certs)
- `secret_store` 1—N `site` (or 1—1 local store per site)
- `registry` 1—N `artifact` (from Build Plane; reference by digest)

---

# 2) Site systems of record — entities + relationships

## A. Control Plane (identity, tenancy, policy, authz, audit, quotas)

**Entities**

- `namespace` (tenancy boundary)
- `principal` (abstract identity)
  - `user`
  - `service_account`
  - `agent_identity` (if you mirror agents into site)

- `organization` (optional; if you want org/team inside site)
- `team` / `group`
- `membership`
- `role`
- `permission`
- `role_binding` (principal/group → role, scoped)
- `policy` (ABAC rules, method constraints, etc.)
- `relationship_tuple` (ReBAC graph edges, SpiceDB-like)
- `api_key`
- `session` / `token` (optional; tokens may be externalized)
- `quota_bucket` (limit + counters)
- `quota_reservation`
- `audit_event`
- `control_workflow` (approvals, provisioning workflows)

**Relationships**

- `site` 1—N `namespace`
- `organization` 1—N `team`
- `principal` N—M `team` via `membership`
- `namespace` N—M `principal` via `membership` (if membership is namespace-scoped)
- `role` N—M `permission`
- `role_binding` N—1 `role`
- `role_binding` N—1 `principal` OR N—1 `team`
- `role_binding` N—1 `namespace` (scope) (or site-wide)
- `policy` N—1 `namespace` (or site-wide)
- `relationship_tuple` (subject, relation, resource) (graph; cardinality is N—M by nature)
- `principal` 1—N `api_key`
- `quota_bucket` N—1 `namespace` (and optionally N—1 `module_instance`)
- `quota_bucket` 1—N `quota_reservation`
- `audit_event` N—1 `principal`
- `audit_event` N—1 `namespace` (optional)
- `control_workflow` N—1 `namespace` (optional) and N—1 `principal` (initiator)

---

## B. Service Plane (module runtime, APIs, jobs, events)

**Entities**

- `module_instance` (enabled module in a namespace/site)
- `service` (component inside module instance; optional granularity)
- `endpoint` (API endpoints; optional)
- `job` / `task_run`
- `workflow_run` (Temporal-run-like)
- `event_stream`
- `event_subscription`
- `integration_connector`
- `webhook`
- `run_artifact` (logical result objects; physical in Data Plane)

**Relationships**

- `namespace` 1—N `module_instance`
- `module_instance` N—1 `module_version` (pin at runtime; can change on upgrade)
- `module_instance` 1—N `service` (optional)
- `module_instance` 1—N `job`
- `module_instance` 1—N `workflow_run`
- `event_stream` 1—N `event_subscription`
- `module_instance` N—M `event_stream` (publish/consume)
- `module_instance` 1—N `integration_connector`
- `integration_connector` 1—N `webhook`
- `workflow_run` 1—N `run_artifact` (outputs)

---

## C. Data Plane (storage, analytics, indexing, backup)

**Entities**

- `dataset` (logical)
- `table` / `collection` (optional)
- `object` (blob)
- `index` (search/vector/tile)
- `materialization` (derived tables/views/tiles)
- `pipeline`
- `pipeline_run`
- `backup_snapshot`
- `replication_config`
- `retention_policy`

**Relationships**

- `namespace` 1—N `dataset`
- `dataset` 1—N `materialization`
- `dataset` 1—N `pipeline`
- `pipeline` 1—N `pipeline_run`
- `namespace` 1—N `backup_snapshot`
- `dataset` 0—N `index`
- `retention_policy` N—1 `namespace` (or dataset-scoped)
- `replication_config` N—1 `site` (or dataset-scoped)

---

# 3) The cross-plane joins that matter most

These are the joins that make the whole OS coherent.

## Product → Agent → Build

- `task` N—M `agent_task`
- `agent_execution` N—M `pull_request`
- `task` N—M `pull_request`

## Build → Fleet

- `module_version` 1—N `release_module_pin`
- `release` 1—N `release_module_pin`
- `release` 1—N `rollout` (via rollout.target_release)
- `rollout` N—1 `site`

## Commerce → Fleet → Site(Control)

- `license` 1—N `entitlement_bundle`
- `entitlement_bundle` N—1 `site` (delivered to)
- `entitlement_bundle` 1—N `entitlement_item`
- `entitlement_item` N—1 `module` / `feature_flag`
- Site Control Plane caches `entitlement_bundle` as `local_entitlement_state` (1—1 latest, 1—N history)

## Site(Control) → Site(Service)

- `namespace` 1—N `module_instance`
- `principal` N—M `namespace` (membership)
- `role_binding` controls access to `module_instance` / `dataset` (modeled either via tuples or explicit ACL tables)

## Site(Service) → Site(Data)

- `module_instance` N—M `dataset` (read/write grants; can be enforced via credentials, policies, or tuples)
- `workflow_run` 1—N `run_artifact`
- `run_artifact` N—1 `dataset` or N—1 `object`

---

# 4) Minimal “mental ERD” (ASCII)

```text
FACTORY
  [task]---(N:M)---[pull_request]---(1:N)---[build]---(1:N)---[artifact]
     \                 |
      \(N:M)           (1:N)
        \            [ci_run]
         \
        [agent_task]---(1:N)---[agent_execution]

  [module]---(1:N)---[module_version]---(1:N)---[artifact]
                     |
                   (N:M deps)

  [release]---(1:N)---[release_module_pin]---(N:1)---[module_version]
     |
   (1:N)
  [rollout]---(N:1)---[site]

  [subscription]---(1:N)---[license]---(1:N)---[entitlement_bundle]---(1:N)---[entitlement_item]
                                             |
                                           (N:1)
                                           [site]

SITE
  [site]---(1:N)---[namespace]---(1:N)---[module_instance]---(N:1)---[module_version]
            |
          (N:M)
        [principal]---(N:M)---[team/group]
            |
          (1:N)
         [api_key]

  [namespace]---(1:N)---[dataset]---(1:N)---[pipeline]---(1:N)---[pipeline_run]
```

---

# 5) If you want one database vs many

You can implement this as:

- one “factory db” (all Factory planes)
- one “site db” per site for Control + metadata
- plus per-module databases for Service/Data, but referenced by logical IDs (`dataset_id`, `module_instance_id`, etc.)

That keeps the mental model consistent even when physical storage is fragmented.

---

If you want, the next step is turning this into a strict ERD spec with:

- primary keys
- foreign keys
- join tables (for each N—M)
- required vs optional relationships
- delete behaviors (restrict/cascade)
- tenancy scoping rules (everything in site must be `site_id`-scoped, everything tenant-scoped must be `namespace_id`-scoped).
