# Factory UI: Complete Screen Inventory & Visual Design System

**Date:** 2026-03-26
**Status:** Draft
**Scope:** All dashboards, screens, views, and visualizations across all Factory planes

---

## Design Decisions

### Entry Point Architecture

- **Role-based home** as the default landing (Developer, PM, DevOps, QA, Commerce, Agent Supervisor)
- **Factory Floor overview** accessible from every home as the "zoom out" view
- **Project-centric drill-downs** via Module Detail and Traceability Explorer
- **Activity Feed** as a cross-cutting real-time stream

### Relationship to External Tools

- **Phase 1 (now):** Orchestration layer — aggregate, link out to specialized tools (ArgoCD, Grafana, GitHub)
- **Phase 2:** AI-native synthesis — cross-plane intelligence (incident narratives, impact analysis, natural language search)
- **Phase 3:** Primary interface — replace specialized tools where Factory is better

### Agent Model

Agents are **first-class workers** visible alongside humans in all dashboards. They show up in assignment lists, activity feeds, sprint boards, and review queues. The UI manages the balance between agent autonomy and human oversight (Review Queue, Dispatch Board). At scale, there will be far more agent workers than humans.

---

## Entity Naming (Schema-Level Renames)

### Renames

| Current                     | New Name                                                | Rationale                                                    |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `componentSpec`             | `component`                                             | Drop "Spec" suffix — everything in catalog is a spec         |
| `componentSpec.kind='site'` | `'website'`                                             | Disambiguate from fleetSite; add `'mobile_app'` kind         |
| `workItem`                  | Split into `initiative`, `epic`, `story`, `task`, `bug` | Match actual work hierarchy; each gets its own table         |
| `customerAccount`           | `customer`                                              | Drop redundant suffix                                        |
| `kubeNode`                  | `node`                                                  | Context makes prefix redundant                               |
| `agentExecution`            | `agentRun`                                              | Shorter, matches CI/CD language ("pipeline run", "test run") |
| `commercePlan`              | `plan`                                                  | Drop prefix                                                  |
| `productModule`             | `module`                                                | Drop prefix                                                  |

### Conflict Resolutions

| Conflict                                         | Resolution                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| "Site" (fleet location vs component kind)        | Fleet keeps `site`. Component kind `'site'` → `'website'`                                          |
| "Domain" (DNS vs business domain)                | DNS keeps `domain`. Business domain concept = existing `product` entity (no catalog.Domain needed) |
| "Component" (deployable unit vs catalog concept) | Keep `component` for deployable units within a Module. Catalog aligns: catalog.Component ≈ Module  |

### Kept As-Is

Module, Repo, Release, Artifact, Workload, Rollout, Sandbox, Cluster, Provider, Agent, Route, Tunnel, Host, VM, Plan, Entitlement, Intervention, Region, Datacenter, Domain (DNS)

### New Entity

**Incident** — added to `factory_fleet` schema. Fields: severity, status (detected → acknowledged → mitigating → resolved), affected site/workloads, responders, timeline, linked interventions, postmortem. Distinct from bugs/issues — it's an operational event, not a work item.

---

## Visual Design System: Plane Aesthetics

Each plane has a distinct visual personality that matches its nature. The aesthetic is ambient — it enhances awareness without obstructing the buttery-smooth UX.

| Plane        | Codename          | Color            | Visual Metaphor                             | Aesthetic                                                                     |
| ------------ | ----------------- | ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| **Product**  | The Design Studio | Purple `#b794f4` | Creative studio, whiteboards, sticky notes  | Warm, organic, kanban boards, handwritten feel                                |
| **Build**    | The Assembly Line | Amber `#d9a94f`  | Industrial factory, conveyor belts, gears   | Mechanical, precise, steel/copper tones, progress bars as conveyor belts      |
| **Fleet**    | Mission Control   | Teal `#4fd1c5`   | NASA command center, radar screens          | Dark with glowing elements, data-dense, status grids, real-time telemetry     |
| **Infra**    | The Server Room   | Blue `#58a6ff`   | Datacenter racks, blinking LEDs, cable runs | Cool, structured, rack visualizations, topology diagrams                      |
| **Agents**   | The Workforce     | Green `#68d391`  | Bot army, worker dispatch, assembly workers | Bustling, industrious, worker avatars with status badges, dispatch board feel |
| **Commerce** | The Trading Floor | Gold `#ecc94b`   | Financial trading desk, ticker tapes        | Clean, professional, charts, numbers-forward, gold for value                  |

### Ambient Health Feedback

The factory floor and individual planes reflect system health through ambient visual cues:

- **Healthy:** Bright colors, smooth animations, vibrant saturation, "sunny day" feel
- **Warning:** Slightly desaturated, amber accents creep in, animations slow slightly
- **Degraded:** Muted tones, red/amber alerts prominent, "overcast" atmosphere
- **Critical:** Dark, urgent, red pulsing elements, the plane feels "on fire"

**Principle:** The vibes enhance peripheral awareness. You _feel_ the health before you read a dashboard. But the operational UX is always butter — no ambient effect ever blocks, slows, or obscures the actual controls and data.

---

## Screen Inventory

### Product Plane — 10 screens

1. **Product Overview** — Top-level per-product view (PM, Leadership). Modules, Initiatives, Milestones, delivery health percentage.
2. **Initiative Board** — Kanban/timeline of Initiatives → Epics → Stories (PM, Engineering Lead). Completion %, velocity trends.
3. **Backlog** — Flat sortable list of Stories and Tasks (PM, Developer, Agent). Filters: my work, unassigned, blocked, agent-assignable.
4. **Release Planner** — Create/manage Release Plans (PM). Scope stories, track readiness, lifecycle (draft → scoped → finalized → released).
5. **Delivery Metrics** — Velocity, cycle time, throughput, PR merge time (PM, Engineering Lead). Sparklines per team.
6. **Quality Dashboard** — Defect rate, escape rate, regression rate, bug backlog by severity (QA, PM). Links to Build test reports.
7. **Module Detail** — The "service page" (Developer, PM). Components, Repo, Versions, Stories, deployment status, dependency graph, owning team.
8. **Sprint Board** — Current sprint kanban (Developer, PM). Burndown, capacity, assignee avatars (humans AND bots).
9. **Roadmap Timeline** — Gantt-style Initiatives and Milestones across quarters (PM, Leadership). Cross-product dependency lines.
10. **ADR Index** — Searchable Architecture Decision Records across repos (Developer, Engineering Lead).

### Build Plane — 9 screens

1. **Pipeline Dashboard** — All CI pipelines, real-time status (Developer, DevOps). Conveyor-belt stage visualization.
2. **Build Detail** — Single build drill-down: logs, timing, test results, security scan, artifacts (Developer). AI-suggested error fixes.
3. **PR Overview** — All open PRs across repos (Developer, Reviewer). CI status, review status, linked stories, author (human/agent).
4. **Artifact Registry** — Browse artifacts: container images, Helm charts, bundles (Developer, DevOps). "What's deployed where" cross-reference.
5. **Module Version History** — All versions with artifacts, compatibility, release pins (Developer, PM). Version diffs.
6. **Test Reports** — Pass rates, flaky test detection, coverage trends (QA, Developer). Drill to individual failures.
7. **Security Dashboard** — SAST, dependency scan, license compliance (Security, Developer). Unresolved findings by severity.
8. **Dependency Graph** — Visual module-to-module dependency map (Developer, Architect). Circular deps, breaking bumps, outdated pins.
9. **Build Metrics** — Duration trends, pass/fail rates, queue times, flakiness (DevOps, Engineering Lead).

### Fleet Plane — 12 screens

1. **Fleet Map** — Geographic/logical map of all Sites (DevOps, SRE, Leadership). The "war room" view. Color-coded health per site.
2. **Site Detail** — One site: DeploymentTargets, Workloads, Release, Routes, Domains, cluster info (DevOps, SRE).
3. **DeploymentTarget Detail** — One target: running Workloads, drift detection, resource usage, connected routes (DevOps, Developer). Quick actions: restart, scale, override.
4. **Release Manager** — All Releases, lifecycle, module version pins (DevOps, PM). Compare releases, trigger rollout.
5. **Rollout Tracker** — Active/recent Rollouts with per-step progress, canary metrics, rollback (DevOps, SRE).
6. **Incident Console** — Active/recent Incidents (SRE, DevOps). Severity, timeline, responders, linked interventions. Postmortem link.
7. **Sandbox Manager** — All Sandboxes by owner (user/agent), TTL, resources (Developer, Agent). Create, connect, snapshot/restore.
8. **Route & Domain Manager** — Routes, Domains, DNS verification, TLS certs, tunnels, preview URLs (DevOps).
9. **Workload Inspector** — Single Workload deep dive: logs, metrics, pod status, env vars, overrides history (Developer, SRE).
10. **Drift Report** — Workloads where desired ≠ actual image (DevOps, SRE). Duration, cause, quick-fix actions.
11. **Intervention Log** — Audit trail of manual actions: restarts, overrides, scale changes (SRE, Auditor). Revert capability.
12. **Release Bundle Manager** — Offline release bundles for air-gapped sites (DevOps). Build, track, distribute.

### Infrastructure Plane — 8 screens

1. **Provider Overview** — All providers (Proxmox, Hetzner, AWS, GCP), status, credentials health (DevOps, Infra Lead).
2. **Cluster Dashboard** — All clusters, health, node count, CPU/mem/disk gauges (DevOps, SRE). Which sites run where.
3. **Host & VM Inventory** — All bare-metal hosts and VMs (DevOps, Infra Lead). Specs, IPs, access methods, rack locations.
4. **Network Topology** — Subnets, VLANs, IP allocations, visual topology map (DevOps, Network Engineer).
5. **Node Detail** — Single K8s Node: status, role, resources, pods, backing VM (DevOps, SRE). Drain/cordon actions.
6. **Proxmox Cluster View** — Hypervisor nodes, VM distribution, sync status, storage pools (DevOps).
7. **Resource Utilization** — Cross-provider utilization, cost attribution, capacity planning (DevOps, Finance).
8. **Certificates & Secrets** — TLS cert inventory, expiry, renewal, PKI health (DevOps, Security).

### Agent Plane — 7 screens

1. **Dispatch Board** — All agents with status, current task, progress (Agent Supervisor). Utilization %. Aggregated by squad at scale.
2. **Agent Detail** — Single agent: capabilities, history, success rate, cost, current assignment (Agent Supervisor).
3. **Execution Log** — All AgentRuns: task, status, cost, duration, output links (Developer, Agent Supervisor). Replay/retry.
4. **Review Queue** — Agent outputs awaiting human review: PRs, findings, drafts (Developer, Reviewer). Approve/reject workflow.
5. **Task Queue** — Unassigned tasks agents could pick up (Agent Supervisor). Priority-ordered, capability matching, auto-dispatch toggle.
6. **Cost & Efficiency** — Spend per agent/type/task kind, $/merged PR, ROI vs human (Agent Supervisor, Finance).
7. **Agent Registry** — All registered agents, types, capabilities, tool grants, permissions (Admin).

### Commerce Plane — 8 screens

1. **Revenue Dashboard** — MRR, ARR by product/plan tier, growth, churn (Business, Leadership).
2. **Customer List** — All customers with status, plan, products, sites (Business, Support).
3. **Customer Detail** — Single customer: subscriptions, entitlements, sites, usage, billing (Business, Support).
4. **Subscription Manager** — Active subscriptions, upgrade/downgrade flows, trial conversion (Business).
5. **Entitlement Console** — Entitlement bundles: signed, delivered, pending, expiring (Business, DevOps).
6. **Usage & Metering** — Per-customer usage across dimensions, quota alerts, overage tracking (Business, PM).
7. **Plan & Pricing Config** — Define plans, tiers, modules, quotas, pricing, enterprise overrides (Business, PM).
8. **Partner Portal** — Partner accounts, managed customers, billing, commissions (Partner Manager).

### Cross-Cutting Views — 6 screens

1. **Traceability Explorer** — Follow any entity across all planes: Initiative → Story → PR → Build → Artifact → Release → Rollout → Site → Workload. The full lifecycle of a feature from idea to running code.
2. **Universal Search** — AI-powered natural language search across all planes.
3. **Activity Feed** — Real-time cross-plane event stream, filterable by plane, entity, severity, team.
4. **Factory Floor** — Spatial overview of all six planes with ambient health. The "zoom out" view.
5. **Impact Analysis** — "What happens if...?" Pre-deploy blast radius, post-incident customer impact.
6. **Settings & Admin** — Provider integrations, user roles, notifications, webhooks, API keys, home customization.

---

## Role-Based Homes (6)

Each persona gets a default home that surfaces what matters most to them:

| Role                 | Key Widgets                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| **Developer**        | My PRs, my tasks, my sandboxes, recent builds, team sprint board, agent PRs to review     |
| **PM**               | Initiative progress, delivery metrics, at-risk stories, release readiness, quality trends |
| **DevOps/SRE**       | Fleet health map, active incidents, recent rollouts, drift alerts, resource utilization   |
| **QA**               | Test pass rates, flaky tests, bug backlog, coverage trends, regression alerts             |
| **Commerce**         | Revenue dashboard, expiring entitlements, customer health, usage alerts                   |
| **Agent Supervisor** | Dispatch board, review queue depth, agent utilization, cost trends, failed runs           |

---

## Total: 60 screens + 6 role-based homes

Organized into 6 plane-specific sections + 1 cross-cutting section. Each screen has a defined primary audience, clear purpose, and connection to Factory's entity model.
