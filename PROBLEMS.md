# Engineering Problems vs Factory Coverage

> Last updated: 2026-04-02
> Purpose: Map real engineering pain points against what the Factory digital twin solves, has planned, or still needs to address.

---

## Problem Inventory

### A. Inner-Loop Development

| #   | Problem                                                                                                                                                                                | Status  | Notes                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| A1  | **Shared package editing across repos** — reluctant to touch shared packages because of PR/merge/publish cycle; need to pull remote packages locally, edit, test, patch, then upstream | Gap     | Needs `dx patch` workflow (like `pnpm patch` + `git format-patch` + upstream PR automation) |
| A2  | **Slow machines / too little RAM** for multi-project work                                                                                                                              | Partial | Sandboxes (`dx sandbox`) offload compute to remote VMs                                      |
| A3  | **Codespaces for different projects**                                                                                                                                                  | Partial | `dx sandbox create` provisions ephemeral dev environments                                   |
| A4  | **Slow network / need local registries and mirrors**                                                                                                                                   | Gap     | Needs `dx registry mirror` for npm/docker/apt                                               |
| A5  | **Too many CLI tools** — have to combine many CLIs for a uniform experience                                                                                                            | Solved  | `dx` is the unified CLI (50+ commands)                                                      |
| A6  | **Very quick prototyping**                                                                                                                                                             | Partial | `dx init` + templates + `dx add`. Needs `dx init --stack` presets                           |

### B. CI/CD & Deployment

| #   | Problem                                                                                  | Status  | Notes                                                                                           |
| --- | ---------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| B1  | **Review/preview deployments like Vercel** — branch URL, AI work gets a URL for feedback | Partial | `dx preview deploy` exists. Missing: PR comment with URL, sandbox linking, AI agent integration |
| B2  | **Same GitHub Actions for every project** — repetitive CI/CD setup                       | Planned | `dx init` will scaffold `.github/workflows/`. `@dx/ci` runtime planned                          |
| B3  | **Managing CI/CD across repos**                                                          | Partial | Pipeline tracking in Build Plane. Needs cross-repo orchestration                                |
| B4  | **Release management**                                                                   | Planned | `dx release notes`, `dx release create --auto`, changelog generation                            |

### C. Standards & Onboarding

| #   | Problem                                                                      | Status  | Notes                                                                                            |
| --- | ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| C1  | **Cross-team standards** — knowledge, code structure, formatting, linking    | Partial | `dx check` enforces conventions via `.dx/conventions.yaml`. Quality gates with floor enforcement |
| C2  | **New engineer onboarding** — familiar structure, things work out of the box | Partial | `dx init` scaffolds standard structure. `dx doctor` validates. Needs guided walkthroughs         |
| C3  | **Discovery of shared components, existing APIs, favored libraries**         | Partial | `dx catalog` exists. Needs better search/discovery UX                                            |
| C4  | **Feature/code duplication** — same things get rebuilt                       | Partial | Catalog + module system. Needs "did you know X exists?" discovery                                |

### D. Infrastructure & DevOps

| #   | Problem                                                    | Status  | Notes                                                                                |
| --- | ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| D1  | **Hybrid infra** — own cluster + cloud + on-prem customers | Solved  | Infrastructure Plane: Provider, Cluster, Host, VM, Region, Datacenter                |
| D2  | **VPN hops to customer servers**                           | Partial | `dx tunnel`, `dx ssh`, `dx connect`. Route entity for traffic routing                |
| D3  | **Incident management** — logs, stack traces               | Partial | `dx logs`, `dx trace`, `dx metrics`, `dx alert`. Needs incident workflow integration |
| D4  | **Observability — metrics and performance**                | Partial | Observability Plane with adapters, OTel in CLI. Frontend observability not addressed |
| D5  | **IP address management**                                  | Solved  | `IpAddress` + `Subnet` entities in Infrastructure Plane                              |
| D6  | **IT inventory management**                                | Partial | Host/VM/Cluster entities. Could extend to non-compute assets                         |

### E. Database Management

| #   | Problem                                     | Status   | Notes                                                     |
| --- | ------------------------------------------- | -------- | --------------------------------------------------------- |
| E1  | **Backup, restore, point-in-time recovery** | Designed | Database Lifecycle spec complete. Implementation pending  |
| E2  | **Retention policies**                      | Designed | Part of database lifecycle spec                           |
| E3  | **Encryption**                              | Gap      | Not addressed in current specs                            |
| E4  | **Role management / authorization**         | Gap      | Database-level RBAC not in scope (app-level auth exists)  |
| E5  | **Different kinds of databases**            | Designed | Database entity supports sidecar, managed, external modes |

### F. Security & Access

| #   | Problem                                               | Status  | Notes                                                                         |
| --- | ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| F1  | **Secret management**                                 | Partial | `dx secret` exists. CI injection not wired yet                                |
| F2  | **Authentication / authorization**                    | Partial | Identity module, Principal entity, scope-based permissions. Needs fuller RBAC |
| F3  | **Vulnerability protection**                          | Planned | `dx review --focus security` planned                                          |
| F4  | **License management** (AI agents, tools, SaaS seats) | Gap     | Commerce Plane has customer entitlements but not internal license tracking    |

### G. Environment & Process Management

| #   | Problem                       | Status  | Notes                                                                     |
| --- | ----------------------------- | ------- | ------------------------------------------------------------------------- |
| G1  | **Environment management**    | Solved  | DeploymentTarget, `dx env`, Fleet Plane                                   |
| G2  | **Process management on VMs** | Partial | Workload entity, `dx docker`, `dx kube`. Systemd/Windows runtimes modeled |
| G3  | **Deployment management**     | Solved  | Rollout entity, `dx deploy`, Release lifecycle                            |

### H. Code Quality & Review

| #   | Problem                             | Status  | Notes                                                   |
| --- | ----------------------------------- | ------- | ------------------------------------------------------- |
| H1  | **Code quality from all engineers** | Partial | `dx check` with conventions + floor enforcement         |
| H2  | **Automated code review**           | Planned | `dx review` — Claude-powered with conventions awareness |
| H3  | **Structured manual code review**   | Gap     | No checklist/tracking tooling                           |

### I. Modular Development & Multi-tenancy

| #   | Problem                                        | Status  | Notes                                                        |
| --- | ---------------------------------------------- | ------- | ------------------------------------------------------------ |
| I1  | **Customer-specific features / feature flags** | Partial | Entitlement system for module access. No feature flag system |
| I2  | **Long-lived branches**                        | Gap     | No drift tracking or auto-sync tooling                       |
| I3  | **Modular development**                        | Solved  | Module + ComponentSpec + Entitlements                        |

### J. Data & AI

| #   | Problem                                            | Status  | Notes                                                             |
| --- | -------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| J1  | **GIS, time series, streaming, unstructured data** | Gap     | Needs specialized module templates and DB adapter extensions      |
| J2  | **AI/LLM usage management**                        | Partial | Agent jobs tracked. No token/cost tracking                        |
| J3  | **Creating chatbots / agent development**          | Partial | Agent Plane + Chat SDK designed. Implementation pending           |
| J4  | **Agent dev only on local laptops**                | Partial | Sandboxes allow remote execution. Needs better agent dev workflow |
| J5  | **No version control for agent work**              | Partial | Agent → PR → merge flow designed                                  |

### K. Documentation & Knowledge

| #   | Problem                             | Status | Notes                                                     |
| --- | ----------------------------------- | ------ | --------------------------------------------------------- |
| K1  | **Keep docs up to date**            | Gap    | No staleness detection or auto-update                     |
| K2  | **Managing project docs and plans** | Gap    | No integrated doc management                              |
| K3  | **Queryable knowledge base**        | Gap    | Agent memory v2 (vector search) is closest, not yet built |

### L. Feedback & Incident Management

| #   | Problem                                                                                        | Status  | Notes                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Incident management workflow** — detecting, triaging, assigning, resolving, post-mortem      | Gap     | `dx logs/trace/alert` exist for observability but no incident lifecycle (create → triage → mitigate → resolve → post-mortem) |
| L2  | **Incident response automation** — pull logs, stack traces, correlate across services          | Partial | Observability adapters exist. No automated correlation or runbook execution                                                  |
| L3  | **Customer feedback collection & routing** — gathering, categorizing, linking to work items    | Gap     | No feedback entity. Commerce Plane has customers but no feedback loop back to Product Plane                                  |
| L4  | **Internal feedback / retro tracking** — team retros, process improvement signals              | Gap     | No structured feedback capture. Could extend WorkItem or add Feedback entity                                                 |
| L5  | **Feedback → feature prioritization pipeline** — sorting, scoring, linking feedback to roadmap | Gap     | No feedback-to-work-item pipeline. Needs scoring model + linking                                                             |
| L6  | **On-call management** — schedules, escalation, paging                                         | Gap     | Not modeled. Could integrate with PagerDuty/OpsGenie via adapter                                                             |

### M. Collaboration & Communication

| #   | Problem                                              | Status   | Notes                                                              |
| --- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| M1  | **Better Slack integration**                         | Designed | Chat SDK Slack adapter spec complete. Implementation pending       |
| M2  | **Working on many projects/features simultaneously** | Partial  | `dx worktree`, sandboxes. Multi-project orchestration not explicit |

### N. Commercial & Operations

| #   | Problem                              | Status  | Notes                                                        |
| --- | ------------------------------------ | ------- | ------------------------------------------------------------ |
| N1  | **Seeds / credits / usage tracking** | Partial | Commerce Plane subscriptions. Usage tracking not fully wired |
| N2  | **Hierarchies (org structure)**      | Solved  | Team entity with business-unit/product-area types            |

---

## Coverage Summary

| Category                  | Solved | Partial | Planned | Gap    |
| ------------------------- | ------ | ------- | ------- | ------ |
| A. Inner-Loop Dev         | 1      | 3       | 0       | 2      |
| B. CI/CD & Deploy         | 0      | 2       | 2       | 0      |
| C. Standards & Onboarding | 0      | 4       | 0       | 0      |
| D. Infra & DevOps         | 2      | 4       | 0       | 0      |
| E. Database               | 0      | 0       | 3       | 2      |
| F. Security & Access      | 0      | 2       | 1       | 1      |
| G. Env & Process          | 2      | 1       | 0       | 0      |
| H. Code Quality           | 0      | 1       | 1       | 1      |
| I. Modular Dev            | 1      | 1       | 0       | 1      |
| J. Data & AI              | 0      | 3       | 0       | 2      |
| K. Docs & Knowledge       | 0      | 0       | 0       | 3      |
| L. Feedback & Incidents   | 0      | 1       | 0       | 5      |
| M. Collaboration          | 0      | 1       | 1       | 0      |
| N. Commercial             | 1      | 1       | 0       | 0      |
| **TOTALS**                | **7**  | **24**  | **8**   | **17** |

---

## Prioritized Roadmap

### Tier 1: High Impact, Foundation Ready

#### 1. Complete Preview Deployments (B1)

**Pain:** Every PR should get a URL. AI agents should produce testable URLs.

- Post preview URL as PR comment (git host adapter has the hooks)
- Link preview to sandbox
- AI agent → preview integration
- **Effort:** Small | **Unlocks:** AI feedback loops, QA workflows, stakeholder review

#### 2. Complete Database Lifecycle (E1-E5)

**Pain:** Every developer struggles with DB management daily.

- Implement Phases 2-4 of the designed spec
- `dx db backup/restore/seed` commands
- Sandbox/preview auto-provisioning with anonymized prod data
- Add encryption-at-rest and DB role management
- **Effort:** Medium | **Unlocks:** Safe dev environments, incident recovery

#### 3. CI/CD Scaffolding (B2, B3)

**Pain:** Writing the same GitHub Actions for every repo.

- `dx init` scaffolds ci.yml, review.yml, preview.yml, release.yml
- Template registry with org-level defaults
- `dx ci sync` to update workflows across repos
- **Effort:** Medium | **Unlocks:** Consistent CI, preview/review out of the box

#### 4. Agentic Code Review (H2, F3)

**Pain:** Code quality varies. Security vulnerabilities slip through.

- `dx review` with Claude API + conventions + PR diff
- Security scanning (`--focus security`)
- Auto-trigger on PR via webhook
- **Effort:** Medium | **Unlocks:** Consistent quality floor, vulnerability catching

---

### Tier 2: High Impact, Needs New Design

#### 5. Shared Package Editing Workflow (A1)

- `dx patch <package>` — pull source, set up local override
- `dx patch test` — run downstream tests against patch
- `dx patch upstream` — create PR on source repo
- **Effort:** Medium-High | **Unlocks:** Cross-team collaboration

#### 6. Documentation & Knowledge Base (K1-K3)

- `dx docs check` — detect stale docs
- `dx docs generate` — AI-powered doc generation
- `dx knowledge` — queryable KB backed by agent memory v2 (vector search)
- **Effort:** High | **Unlocks:** Onboarding speed, institutional memory

#### 7. Local Registries & Mirrors (A4)

- `dx registry mirror npm/docker/apt`
- Auto-configure projects to use mirrors when available
- **Effort:** Medium | **Unlocks:** Faster installs, offline-capable dev

---

### Tier 3: Important, Lower Frequency

#### 8. LLM Cost & Token Tracking (J2)

- Track tokens/cost per Agent Job
- `dx agent usage` by agent, team, period
- Budget alerts
- **Effort:** Small | **Unlocks:** Cost visibility

#### 9. Internal License Management (F4)

- New `License` entity (tool, vendor, seats, assigned principals, renewal)
- `dx license list/assign/revoke`
- **Effort:** Small | **Unlocks:** IT inventory

#### 10. Long-Lived Branch Management (I2)

- `dx branch health` — drift metrics
- `dx branch sync` — automated rebase/merge
- Agent job for periodic health checks
- **Effort:** Medium | **Unlocks:** Reduced merge debt

#### 11. Structured Manual Review (H3)

- Review checklist templates in `.dx/review/`
- `dx review manual` with tracking
- **Effort:** Small | **Unlocks:** Review consistency

#### 12. Incident Management Lifecycle (L1-L2, L6)

**Pain:** Incidents are ad-hoc. No structured workflow from detection to post-mortem.

- New `Incident` entity in a new **Ops Plane** or extend Fleet Plane
  - Status: `detected → triaged → mitigating → resolved → post-mortem`
  - Severity: `sev1/sev2/sev3/sev4`
  - Links to: affected Sites, DeploymentTargets, Workloads, PipelineRuns
- `dx incident create/triage/resolve/postmortem`
- `dx incident correlate` — auto-pull logs, traces, recent deploys for affected services
- On-call adapter (PagerDuty/OpsGenie) for paging + escalation
- Agent job: auto-detect anomalies → create incident → pull diagnostics → notify on-call
- Post-mortem template generation from incident timeline
- **Effort:** Medium-High | **Unlocks:** Structured response, faster MTTR, learning from failures

#### 13. Feedback Collection & Prioritization (L3-L5)

**Pain:** Customer and internal feedback is scattered. No pipeline from feedback to roadmap.

- New `Feedback` entity in Product Plane
  - Types: `bug_report | feature_request | complaint | praise | internal_retro`
  - Source: `slack | email | support_ticket | in_app | retro`
  - Links to: CustomerAccount, Module, WorkItem
- `dx feedback collect` — ingest from Slack channels, support tools, in-app widgets
- `dx feedback triage` — categorize, deduplicate, score by frequency/impact/effort
- `dx feedback link` — connect feedback to existing WorkItems or create new ones
- Scoring model: frequency x customer_weight x severity → priority score
- Dashboard: top unaddressed feedback, trending themes, feedback-to-ship velocity
- Slack agent: "@factory what are customers saying about module X?"
- **Effort:** Medium-High | **Unlocks:** Customer-driven prioritization, closed feedback loop

#### 14. Vendor & Partner Management (O3)

- New `Vendor` entity: name, type (SaaS/library/infrastructure/consulting), contract_status, renewal_date
- `VendorContract`: terms, SLA, cost, auto-renewal
- `dx vendor list/add/review` — track what third-party tools and services the org depends on
- Dependency health: is this vendor's SDK up to date? Any CVEs? License compatible?
- **Effort:** Small-Medium | **Unlocks:** Supply chain visibility, renewal tracking

#### 15. Support & Helpdesk (O4)

- `SupportTicket` entity linked to CustomerAccount, Site, Component
- `dx support list/triage/escalate`
- SLA tracking (response time, resolution time) per customer tier
- Adapter: integrate with Zendesk/Freshdesk/Linear or be the system of record
- Link tickets to WorkItems when they become bugs/features
- **Effort:** Medium | **Unlocks:** Customer issue visibility, ticket-to-fix pipeline

#### 16. Change Management (O5)

- `ChangeRequest` entity: what's changing, why, risk level, approval status
- Lightweight CAB workflow: auto-approve low-risk, require approval for high-risk
- Link to: Rollout, Release, PipelineRun
- `dx change request/approve/reject`
- **Effort:** Small-Medium | **Unlocks:** Governance, audit trail for production changes

#### 17. Customer Success (O8)

- `AccountHealthScore`: computed from uptime, support tickets, usage trends, NPS
- `QBR` entity for quarterly business review tracking
- Renewal pipeline: upcoming renewals, expansion opportunities, churn risk
- `dx customer health` — dashboard of account health across all customers
- **Effort:** Medium | **Unlocks:** Proactive retention, expansion revenue

#### 18. Specialized Data Templates (J1)

- `dx init --stack timeseries/gis/streaming`
- DB adapter extensions for specialized databases
- **Effort:** Medium | **Unlocks:** Faster project bootstrapping

---

## Highest-Leverage "Partial" Completions

These existing features need finishing and would multiply impact:

1. **Slack agent** (L1) — the UX multiplier; once agents converse in Slack, they become the interface for everything
2. **Catalog discovery** (C3, C4) — `dx catalog search` for "does this already exist?"
3. **Observability wiring** (D3, D4) — connect `dx logs/trace/metrics` to real adapters
4. **Secret injection** (F1) — wire `dx secret` into `dx ci run`
5. **Agent memory v2** (J3, K3) — vector search enables knowledge base + better agent context

---

---

## Operations of a Software Company (Completeness Check)

The Factory ontology currently covers **engineering deeply** but has large gaps in the full operational surface. Here's every operational domain of a software provider mapped against coverage:

### Currently Strong (Engineering Core)

| Domain                   | Factory Plane | Key Entities                                | Coverage |
| ------------------------ | ------------- | ------------------------------------------- | -------- |
| Product definition       | Software      | System, Component, API, Capability, Product | Strong   |
| Source code & versioning | Build         | Repo, SystemVersion, GitHostProvider        | Strong   |
| CI/CD & pipelines        | Build         | PipelineRun, PipelineStepRun, Artifact      | Strong   |
| Work tracking            | Build         | WorkItem, WorkTrackerProvider               | Strong   |
| Infrastructure           | Infra         | Host, VM, Cluster, Subnet, Route, Domain    | Strong   |
| Deployment & fleet       | Ops           | Site, SystemDeployment, Rollout, Workspace  | Strong   |
| Agent/AI operations      | Org           | Agent, Job, Memory, RolePreset              | Strong   |
| Identity & access        | Org           | Principal, Team, Membership, Scope          | Strong   |
| Customer subscriptions   | Commerce      | Customer, Subscription, Plan, Entitlement   | Good     |

### Missing Operational Domains

These are real operations of a software company that Factory doesn't model yet. Organized by how close they are to the engineering core:

#### Ring 1: Directly Touches Engineering (High Priority for Factory)

| #   | Domain                          | What's Missing                                                     | Proposed Entities                                              |
| --- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| O1  | **Incident management**         | No incident lifecycle, on-call, escalation, post-mortem            | `Incident`, `OnCallSchedule`, `EscalationPolicy`, `PostMortem` |
| O2  | **Customer feedback → product** | No feedback capture, triage, scoring, linking to work items        | `Feedback` (in Product Plane)                                  |
| O3  | **Vendor/partner management**   | Third-party deps, SaaS tools, partner integrations — untracked     | `Vendor`, `VendorContract`, `Partnership`                      |
| O4  | **Support / helpdesk**          | No ticket lifecycle, SLA tracking, customer case management        | `SupportTicket`, `SupportQueue`, `SLA`                         |
| O5  | **Change management**           | No formal change request → approval → rollout tracking (CAB-style) | `ChangeRequest`, `ApprovalWorkflow`                            |
| O6  | **Internal knowledge base**     | Runbooks, ADRs, how-tos, tribal knowledge — not queryable          | `KnowledgeArticle`, `Runbook`                                  |
| O7  | **Compliance & audit**          | No audit trail beyond connection events, no compliance checks      | `AuditLog`, `ComplianceCheck`, `Policy`                        |

#### Ring 2: Operations Adjacent to Engineering

| #   | Domain                    | What's Missing                                                | Proposed Entities                              |
| --- | ------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| O8  | **Customer success**      | No account health, QBR tracking, renewal pipeline, churn risk | `AccountHealthScore`, `QBR`, `RenewalPipeline` |
| O9  | **Asset management**      | Only compute assets; no laptops, licenses, equipment          | `Asset`, `License`, `MaintenanceSchedule`      |
| O10 | **Training & enablement** | No onboarding programs, certifications, internal courses      | `TrainingProgram`, `Certification`             |
| O11 | **Metrics & OKRs**        | No business KPIs, team OKRs, product metrics beyond usage     | `Metric`, `OKR`, `Dashboard`                   |
| O12 | **Risk management**       | No risk register, impact assessment, mitigation tracking      | `Risk`, `RiskAssessment`                       |

#### Ring 3: Back-Office (Probably Out of Scope for Factory)

| #   | Domain                   | What's Missing                                           | Notes                                                |
| --- | ------------------------ | -------------------------------------------------------- | ---------------------------------------------------- |
| O13 | **Sales pipeline**       | Opportunities, deals, forecasts, commissions             | Better served by CRM (HubSpot, Salesforce)           |
| O14 | **Marketing & growth**   | Campaigns, leads, funnels, A/B tests                     | Better served by marketing tools                     |
| O15 | **Finance & accounting** | Invoicing, tax, GL, cost allocation, revenue recognition | Better served by accounting tools (Xero, QuickBooks) |
| O16 | **HR & people**          | Employee records, PTO, performance reviews, compensation | Better served by HRIS (BambooHR, Deel)               |
| O17 | **Procurement**          | Purchase orders, vendor approval, spending               | Better served by procurement tools                   |
| O18 | **Legal**                | Contracts, NDAs, DPAs, legal holds                       | Better served by CLM tools                           |

**The Factory's sweet spot:** Ring 1 and Ring 2 should be modeled because they directly affect how software gets built, shipped, and operated. Ring 3 domains are better served by specialized tools, but Factory should have **adapters/integrations** to pull relevant data in (e.g., pull customer health from CRM, pull cost data from accounting).

---

## The Digital Twin Philosophy

Factory solves these problems through five layers:

1. **Model Everything (Ontology)** — every real-world concept gets a database entity. When it's in the model, it can be queried, tracked, automated, governed.
2. **Unified CLI (`dx`)** — one CLI wraps all operations. Consistent interface, trivial onboarding.
3. **Adapters (Pluggable Backends)** — GitHub/GitLab, Jira/Linear, Slack, Proxmox/AWS all behind interfaces. Swap backends, keep workflows.
4. **Agents as First-Class Citizens** — AI agents modeled with same rigor as humans. Jobs, memory, tools, trust scores.
5. **Commerce & Governance** — entitlements, subscriptions, module-level access control for multi-tenant deployment.

For remaining gaps: model it in the ontology, expose it via `dx`, automate it with agents.
