# Product Requirements Document

# **Product Plane (Factory-Level Product Intent and Governance)**

---

**Document Owner:** Nikhil
**Version:** 1.0
**Last Updated:** March 2026
**Status:** RFC — Request for Comments
**Scope:** Factory-wide
**Part of:** Platform Fabric

---

# 1. Purpose

The Product Plane is the company's system of record for **what gets built, why it gets built, and when it ships**.

It is the central coordination layer for product intent — from a raw idea all the way through to a released version running in customer environments. It is product-agnostic: all products (Trafficure, NetworkAccess, SmartMarket, and future offerings) run through the same Product Plane.

It is responsible for:

- Product definition and module registry
- Roadmap and initiative management
- Work management (epics, stories, tasks)
- Cross-product dependency tracking
- Release planning, scoping, and lifecycle
- Release notes and changelog generation
- Architecture governance (ADRs, platform standards, API conventions)
- Engineering guidelines and development standards
- Delivery metrics and engineering analytics
- Internal documentation governance

It does **not**:

- Build software or run CI/CD pipelines (Build Plane)
- Deploy software or manage rollouts (Fleet Plane)
- Manage billing, entitlements, or customer accounts (Commerce Plane)
- Provision infrastructure (Infrastructure Plane)
- Execute business logic or run workloads (Service Plane)

Product Plane defines intent (what, why, and when). Build Plane handles execution (how). Fleet Plane handles delivery (where).

---

# 2. Design Principles

1. Product Plane is product-agnostic. All products flow through the same system.
2. Module is the unit of product capability. Every feature, service boundary, and deployment unit maps to a module.
3. Work flows downward: initiative → epic → story → task. Traceability flows upward: task → story → epic → initiative.
4. Release plans express intent. Release manifests (Fleet Plane) express execution.
5. All state changes emit outbox events.
6. Product Plane owns what and when. Build Plane owns how. Fleet Plane owns where.
7. Third-party tools are the system of record for their domain (Jira for work, GitHub for code and docs). Product Plane aggregates and governs, it does not replace.
8. Architecture decisions are versioned, reviewed, and traceable — never informal.
9. Engineering standards are enforced through tooling and templates, not tribal knowledge.
10. Metrics are computed, not estimated. Product Plane derives delivery analytics from actual work and build data.

---

# 3. Core Concepts

## 3.1 Product

A commercial software offering sold to customers.

- Contains modules.
- Has its own roadmap, release cadence, and customer base.
- Product is a dimension of data flowing through the Factory, not a separate instance of it.

Examples: Trafficure, NetworkAccess, SmartMarket.

---

## 3.2 Module

The unit of product capability and deployment.

A module represents a deployable product capability — a service or group of services that provide a cohesive function. Modules are the most important cross-plane entity in the architecture.

- Designed in Product Plane.
- Built in Build Plane.
- Deployed via Fleet Plane.
- Executed in Service Plane.

Each module has:

- A unique identity (`module_id`)
- An owning team
- A lifecycle state (draft, active, deprecated, retired)
- A linked GitHub repository (`github_repo`)
- Zero or more module versions (built by Build Plane)
- Zero or more dependencies on other modules

Examples: geoanalytics, traffic-engine, network-planner, auth-service, workflow-engine.

A release is fundamentally a collection of module version pins. Without modules, releases cannot be defined, deployments cannot be structured, and entitlements cannot target features.

---

## 3.3 Initiative

A strategic goal or theme that spans multiple epics.

- Owned by product leadership.
- Scoped to a single product or cross-product.
- Has a target milestone or quarter.
- Contains one or more epics.

---

## 3.4 Epic

A large body of work that delivers a coherent capability.

- Belongs to an initiative.
- Contains stories.
- May span multiple sprints.
- Tracks completion as percentage of stories done.

---

## 3.5 Story

A user-visible unit of work.

- Belongs to an epic.
- Contains tasks.
- Estimable and schedulable.
- Linked to one or more pull requests (via Build Plane bridge).
- May be included in one or more release plans.

---

## 3.6 Task

The smallest unit of trackable work.

- Belongs to a story.
- Assignable to a person or agent.
- Has a status (backlog, in-progress, review, done).
- Linked to pull requests via the Build Plane bridge.

---

## 3.7 Release Plan

A declaration of what will ship and when.

- Belongs to a milestone.
- Scoped to one or more modules.
- Contains a set of stories (N—M relationship; stories can be rescheduled across release plans).
- Produces release notes and changelog entries.
- Has a lifecycle state (draft, scoped, finalized, released, cancelled).

A release plan is intent. The actual deployable release manifest (a collection of module version pins) is owned by Fleet Plane. The bridge between them is: `release_plan` N—M `release` (product intent maps to actual deployable release bundles).

---

## 3.8 Milestone

A time-bound target that anchors one or more release plans.

- Has a target date.
- May be product-scoped or company-wide.
- Contains release plans.

---

## 3.9 Architecture Decision Record (ADR)

A versioned, reviewed document that records a significant architectural decision.

- Stored in GitHub as Markdown files in the `/docs/adr/` directory of the relevant repository.
- File naming convention: `NNNN-short-title.md` (e.g., `0001-use-postgis-for-spatial.md`).
- Has frontmatter with metadata (status, date, author, reviewers, decision).
- Has a lifecycle: proposed → accepted → superseded | deprecated.
- Indexed and synced to Product Plane via GitHub webhooks.

---

# 4. Functional Requirements

---

## 4.1 Module Registry

Product Plane owns the canonical registry of all modules across all products.

### 4.1.1 Module Definition

Each module record must include:

- `module_id` (stable, unique)
- `name` (human-readable, unique per product)
- `description`
- `product_id` (which product this module belongs to)
- `owner_team`
- `github_repo` (e.g., `org/smartmarket-geoanalytics`)
- `lifecycle_state` (draft, active, deprecated, retired)
- `created_at`
- `updated_at`

### 4.1.2 Module Lifecycle

State transitions:

```
draft → active       (module is ready for development)
active → deprecated  (module is being phased out; no new features, bug fixes only)
deprecated → retired (module is removed from all releases)
```

Retirement requires:

- No active module instances in any Site (verified via Fleet Plane)
- No active entitlements referencing the module (verified via Commerce Plane)
- Confirmation from product owner

### 4.1.3 Module Dependencies

Modules may declare dependencies on other modules.

```
module_version N — M module_version
```

Dependency types: `requires`, `compatible_with`, `conflicts_with`.

Fleet Plane consults the dependency graph when composing releases to ensure compatibility.

### 4.1.4 Module Roadmap

Optional linkage between modules and planned work.

```
module 1 — N module_roadmap_item
module N — M release_plan
```

This allows Product Plane to answer: "What is planned for the geoanalytics module in Q3?"

---

## 4.2 Work Management

### 4.2.1 Work Graph

Product Plane maintains the full work hierarchy:

```
product 1 — N initiative
initiative 1 — N epic
epic 1 — N story
story 1 — N task
```

Each entity in the work graph must have:

- A unique identifier (Jira issue key)
- A status
- An assignee (person or agent)
- A product association
- Creation and update timestamps

### 4.2.2 Cross-Product Dependencies

Stories or epics may declare dependencies on work items in other products.

Product Plane must:

- Track cross-product blockers
- Surface dependency conflicts in release planning
- Emit events when blocked items are resolved

### 4.2.3 Defect Tracking

Defects are a story subtype with additional metadata:

- Severity (critical, major, minor, trivial)
- Affected module
- Affected module version
- Customer impact (optional: link to customer account via Commerce Plane reference)
- Regression flag

### 4.2.4 Sprint Management

Product Plane governs sprint cadence and capacity:

- Sprint definition (start date, end date, team, capacity)
- Sprint scope (stories assigned to sprint)
- Sprint velocity tracking (computed from completed story points per sprint)

---

## 4.3 Release Planning

### 4.3.1 Release Plan Lifecycle

```
draft → scoped → finalized → released → (post-release)
                    ↘ cancelled
```

**Draft:** Initial creation. Stories may be tentatively associated.

**Scoped:** Story list is committed. Scope changes require explicit re-scoping and emit a `release_plan.scope_changed` event.

**Finalized:** All stories are complete or explicitly deferred. Release notes are generated. Ready for Fleet Plane to compose a release manifest.

**Released:** Fleet Plane has deployed the corresponding release to at least one Site. Release notes and changelog are published.

**Cancelled:** Release plan abandoned. All associated stories return to backlog or are reassigned to a future release plan.

### 4.3.2 Release Scoping

A release plan includes stories via an N—M join:

```
release_plan N — M story
```

Stories can be:

- Added to a release plan (scoped in)
- Removed from a release plan (descoped, with reason)
- Moved to a different release plan (rescheduled)

All scope changes are audited and emit events.

### 4.3.3 Release Notes

Each release plan produces release note entries:

```
release_plan 1 — N release_note_entry
```

Release note entries are:

- Auto-generated from story titles and descriptions (draft)
- Editable by product owners (refinement)
- Categorized (feature, improvement, fix, deprecation, breaking change)
- Audience-tagged (customer-facing, internal, partner)

### 4.3.4 Changelog

Each release plan produces changelog entries:

```
release_plan 1 — N changelog_entry
```

Changelog entries are:

- Module-scoped (which module changed)
- Version-tagged (which module version)
- Cumulative (changelog for a product is the union of all release plan changelogs)

### 4.3.5 Release Plan to Release Bridge

Product Plane owns intent. Fleet Plane owns execution.

```
release_plan N — M release (Fleet Plane entity)
```

A single release plan may map to multiple Fleet releases (e.g., one per deployment type or region). Multiple release plans may feed into a single Fleet release (e.g., a combined quarterly release).

Product Plane emits a `release_plan.finalized` event. Fleet Plane consumes it and composes the deployable release manifest (a set of `release_module_pin` records pointing to specific `module_version` IDs from Build Plane).

---

## 4.4 Architecture Governance

### 4.4.1 Architecture Decision Records (ADRs)

ADRs are the mechanism for recording and reviewing significant architectural decisions.

**Storage:** ADRs are stored as Markdown files in GitHub repositories under `/docs/adr/`.

**Structure:**

```
/docs/
  /adr/
    0001-use-postgis-for-spatial.md
    0002-event-bus-technology-selection.md
    0003-tenant-isolation-strategy.md
    _index.md  (auto-generated index)
```

**Frontmatter schema:**

```yaml
---
id: "0001"
title: "Use PostGIS for spatial operations"
status: proposed | accepted | superseded | deprecated
date: 2026-03-01
author: nikhil
reviewers: [eng-lead-1, eng-lead-2]
supersedes: null
superseded_by: null
tags: [data-plane, spatial, database]
---
```

**Lifecycle:**

```
proposed → accepted     (reviewers approve via PR merge)
accepted → superseded   (new ADR replaces this one; superseded_by field set)
accepted → deprecated   (decision is no longer relevant)
```

**Sync:** GitHub webhooks notify Product Plane when ADR files are created or modified. Product Plane maintains an index of all ADRs across all repositories for cross-product search and governance tracking.

### 4.4.2 Platform Standards

Product Plane maintains a registry of platform-wide standards:

- API conventions (REST/gRPC patterns, error formats, pagination)
- Naming conventions (service naming: `{scope}-{plane}-{component}`)
- Code style and linting rules
- Documentation requirements per module
- Review and approval policies

Standards are stored as Markdown documents in a shared platform repository and enforced through Build Plane CI checks where automatable.

### 4.4.3 API Conventions

Product Plane defines the API design guidelines that all modules must follow:

- Endpoint naming patterns
- Request/response envelope standards
- Error code taxonomy
- Versioning strategy (URL path vs. header)
- Pagination contract
- Rate limiting header conventions

Build Plane enforces these via linting in CI pipelines.

---

## 4.5 Engineering Guidelines and Documentation

### 4.5.1 Spec Templates

Product Plane provides standardized templates for:

- Product requirement documents (PRDs)
- Technical design documents
- API specification documents
- Module onboarding guides
- Runbook templates

Templates are stored in GitHub and versioned. Product Plane tracks which modules have completed required documentation.

### 4.5.2 Documentation Coverage

Product Plane tracks documentation completeness per module:

- README exists and is current
- API documentation exists
- ADRs exist for significant decisions
- Runbooks exist for operational procedures
- Onboarding guide exists

Coverage is computed via GitHub API inspection and reported in engineering analytics.

### 4.5.3 Documentation in GitHub

All technical documentation lives in GitHub repositories alongside code.

```
repo/
  /docs/
    /adr/           ← Architecture Decision Records
    /api/           ← API specifications (OpenAPI)
    /guides/        ← Onboarding and how-to guides
    /runbooks/      ← Operational runbooks
  README.md         ← Module overview
```

Product Plane owns the folder structure convention and template files. Teams own the content. Product Plane tracks coverage.

---

## 4.6 Engineering Analytics

### 4.6.1 Delivery Metrics

Product Plane computes delivery metrics from Jira and GitHub data:

- **Velocity:** Story points completed per sprint, per team
- **Cycle time:** Time from story start to story completion
- **Lead time:** Time from story creation to deployment (requires Fleet Plane deployment event)
- **Throughput:** Stories completed per week/sprint
- **Scope change rate:** Stories added or removed from release plans after scoping
- **PR merge time:** Average time from PR creation to merge (from GitHub)
- **Review turnaround:** Average time from PR review request to first review (from GitHub)

### 4.6.2 Quality Metrics

- **Defect rate:** Defects per module per release
- **Defect escape rate:** Defects found in production vs. defects found pre-release
- **Regression rate:** Defects flagged as regressions per release
- **Test coverage trend:** Per module (sourced from Build Plane CI reports)

### 4.6.3 Cross-Team Visibility

Product Plane provides cross-product dashboards showing:

- Release plan status across all products
- At-risk release plans (scope change rate > threshold, velocity drop)
- Cross-product dependency status
- Module health (documentation coverage, defect rate, deployment frequency)

### 4.6.4 At-Risk Signals

Product Plane computes and emits at-risk signals:

- Release plan has > 20% scope change after scoping
- Sprint velocity drops > 30% compared to trailing average
- Critical-severity defect open > 48 hours
- Cross-product dependency blocked > 5 business days

At-risk signals are emitted as events and delivered via Slack notifications.

---

## 4.7 Agent Plane Integration

Product Plane exposes work graph data to Agent Plane for automation.

Supported agent interactions (light touch, Phase 1):

- **Backlog grooming agents:** Read stories and tasks, suggest priority, flag stale items
- **Spec drafting agents:** Generate draft PRDs or technical design docs from initiative descriptions
- **Analytics agents:** Compute and report delivery metrics on schedule

Product Plane provides read APIs for agent consumption. Write actions (story creation, status changes) are performed by agents via Jira API with appropriate agent identity (Agent Plane manages agent credentials).

Agent integration does not change Product Plane's data model or authority boundaries. Agents are consumers, not owners.

---

# 5. Data Model

## 5.1 Core Entities

```
product
  product_id          PK
  name                unique
  description
  created_at
  updated_at

module
  module_id           PK
  product_id          FK → product
  name                unique per product
  description
  owner_team
  github_repo
  lifecycle_state     enum (draft, active, deprecated, retired)
  created_at
  updated_at

initiative
  initiative_id       PK
  product_id          FK → product
  jira_key            unique (e.g., TRAF-100)
  title
  description
  target_quarter
  status              enum (proposed, active, completed, cancelled)
  created_at
  updated_at

epic
  epic_id             PK
  initiative_id       FK → initiative
  jira_key            unique
  title
  status
  created_at
  updated_at

story
  story_id            PK
  epic_id             FK → epic
  jira_key            unique
  title
  story_points
  status
  assignee_id
  severity            nullable (for defect stories)
  affected_module_id  nullable FK → module
  regression_flag     boolean default false
  created_at
  updated_at

task
  task_id             PK
  story_id            FK → story
  jira_key            unique
  title
  status
  assignee_id
  created_at
  updated_at

milestone
  milestone_id        PK
  name
  target_date
  product_id          FK → product (nullable for company-wide milestones)
  created_at
  updated_at
```

## 5.2 Release Entities

```
release_plan
  release_plan_id     PK
  milestone_id        FK → milestone
  name
  description
  state               enum (draft, scoped, finalized, released, cancelled)
  created_at
  updated_at

release_plan_story (join table)
  release_plan_id     FK → release_plan
  story_id            FK → story
  added_at
  removed_at          nullable (for audit trail)
  removal_reason      nullable

release_plan_module (join table)
  release_plan_id     FK → release_plan
  module_id           FK → module

release_note_entry
  release_note_id     PK
  release_plan_id     FK → release_plan
  category            enum (feature, improvement, fix, deprecation, breaking_change)
  audience            enum (customer, internal, partner)
  title
  description
  story_id            FK → story (nullable)
  created_at
  updated_at

changelog_entry
  changelog_id        PK
  release_plan_id     FK → release_plan
  module_id           FK → module
  module_version      text (e.g., "2.3.0")
  description
  created_at
```

## 5.3 Governance Entities

```
adr_index
  adr_id              PK
  repo                text (e.g., "org/smartmarket-geoanalytics")
  file_path           text (e.g., "docs/adr/0001-use-postgis.md")
  title
  status              enum (proposed, accepted, superseded, deprecated)
  author
  date
  tags                text[]
  supersedes          FK → adr_index (nullable)
  superseded_by       FK → adr_index (nullable)
  synced_at           timestamp

platform_standard
  standard_id         PK
  name
  category            enum (api, naming, code_style, documentation, review)
  repo                text
  file_path           text
  version
  created_at
  updated_at

doc_coverage
  coverage_id         PK
  module_id           FK → module
  has_readme          boolean
  has_api_docs        boolean
  has_adr             boolean
  has_runbooks        boolean
  has_onboarding      boolean
  computed_at         timestamp
```

## 5.4 Analytics Entities

```
sprint
  sprint_id           PK
  team
  product_id          FK → product
  start_date
  end_date
  planned_points
  completed_points
  created_at

delivery_metric
  metric_id           PK
  product_id          FK → product
  module_id           FK → module (nullable)
  metric_type         enum (velocity, cycle_time, lead_time, throughput,
                            scope_change_rate, pr_merge_time, review_turnaround,
                            defect_rate, defect_escape_rate, regression_rate)
  period_start
  period_end
  value               numeric
  computed_at         timestamp
```

## 5.5 Cross-Plane Bridge Entities

```
module_dependency
  module_version_id           FK → module_version (Build Plane)
  depends_on_module_version_id FK → module_version (Build Plane)
  dependency_type             enum (requires, compatible_with, conflicts_with)

module_roadmap_item
  roadmap_item_id     PK
  module_id           FK → module
  title
  description
  target_quarter
  status
  created_at

task_pull_request (Build Plane bridge)
  task_id             FK → task
  pull_request_id     FK → pull_request (Build Plane)

release_plan_release (Fleet Plane bridge)
  release_plan_id     FK → release_plan
  release_id          FK → release (Fleet Plane)
```

---

# 6. Cross-Plane Interactions

## 6.1 Product Plane → Build Plane

Product Plane provides:

- Module registry (Build Plane maps repos to modules)
- Task-to-PR linkage (traceability from work item to code change)

Build Plane provides:

- Module version records (when artifacts are built)
- PR status and merge data (for engineering analytics)
- Test coverage reports (for quality metrics)
- Artifact readiness signals (for release finalization)

Bridge entities: `task` N—M `pull_request`, `module` 1—N `module_version`.

Branch naming convention (enforced by Build Plane via GitHub branch protection):

```
{jira-key}/{short-description}

Examples:
  SM-1234/add-spatial-enrichment
  TRAF-567/fix-coverage-calculation
```

GitHub for Jira integration automatically links branches and PRs to Jira stories based on the issue key prefix. No custom bridge service needed.

## 6.2 Product Plane → Fleet Plane

Product Plane provides:

- Release plan finalization events
- Module dependency graph (Fleet uses to validate release composition)

Fleet Plane provides:

- Deployment events (for lead time computation)
- Release manifest creation confirmation

Bridge entity: `release_plan` N—M `release`.

## 6.3 Product Plane → Commerce Plane

Product Plane provides:

- Module registry (Commerce references modules in entitlement items)
- Product definitions (Commerce maps plans to products)

Commerce Plane provides:

- Customer feedback signals (defects linked to customer accounts)
- Feature request patterns (from customer interactions)

No direct data bridge. Commerce references `module_id` and `product_id` by stable ID.

## 6.4 Product Plane → Agent Plane

Product Plane provides:

- Read access to work graph (for grooming agents)
- Read access to ADR index (for spec drafting agents)
- Read access to delivery metrics (for analytics agents)

Agent Plane provides:

- Agent execution results (draft specs, backlog recommendations)

Agents consume Product Plane APIs. They do not write directly to Product Plane data; they perform actions via Jira and GitHub APIs with their own agent identities.

---

# 7. Eventing

All state changes emit outbox events to the platform event bus.

## 7.1 Events Emitted

```
module.created
module.state_changed          (draft→active, active→deprecated, etc.)
module.updated

initiative.created
initiative.status_changed

epic.created
epic.status_changed

story.created
story.status_changed
story.assigned

release_plan.created
release_plan.scoped           (story list committed)
release_plan.scope_changed    (stories added/removed after scoping)
release_plan.finalized        (ready for Fleet to compose release)
release_plan.released         (deployed to at least one Site)
release_plan.cancelled

adr.proposed
adr.accepted
adr.superseded

at_risk.release_plan          (scope change > 20%, velocity drop > 30%)
at_risk.dependency_blocked    (cross-product block > 5 days)
at_risk.critical_defect       (critical severity open > 48 hours)
```

## 7.2 Events Consumed

```
From Build Plane:
  module_version.created      (new version built → update module roadmap status)
  pull_request.merged         (PR merged → update task/story status, compute metrics)
  build.completed             (build done → compute quality metrics)

From Fleet Plane:
  release.deployed            (deployed to Site → compute lead time, mark release_plan as released)
  module_instance.created     (module running → validate module lifecycle state)

From Commerce Plane:
  (none in Phase 1; future: customer.feedback_submitted)
```

---

# 8. Notification Conventions

## 8.1 Slack Notifications

Product Plane delivers notifications to Slack for three categories:

**Architecture events:**

- ADR proposed → `#architecture`
- ADR accepted → `#architecture`
- ADR superseded → `#architecture`

**Release events:**

- Release plan finalized → `#releases` and product-specific channel (e.g., `#smartmarket-releases`)
- Release plan released → same channels
- Release plan at-risk → `#releases` and product-specific channel

**Delivery alerts:**

- Critical defect open > 48 hours → product-specific channel
- Cross-product dependency blocked > 5 days → `#engineering`
- Sprint velocity drop > 30% → product-specific channel

## 8.2 Notification Contracts

Notifications include:

- Event type
- Entity reference (with link to Jira or GitHub)
- Summary text
- Severity (info, warning, critical)
- Timestamp

---

# 9. Integrations

Product Plane integrates with third-party tools as systems of record. Product Plane aggregates and governs; it does not replace these tools.

## 9.1 Jira

**System of record for:** Work graph (initiative → epic → story → task), sprint management, backlog prioritization.

**Integration pattern:** Product Plane reads from Jira API to compose cross-plane views (e.g., release plan scope with PR status from GitHub). Jira webhooks push status changes to Product Plane for event emission and metric computation.

**Project standards enforced:** Issue type hierarchy, required fields per issue type, workflow state definitions, sprint cadence.

## 9.2 GitHub

**System of record for:** Source code, pull requests, Markdown documentation (ADRs, specs, guides, runbooks), branch protection rules, code ownership (CODEOWNERS).

**Integration pattern:** GitHub webhooks push PR events and documentation changes to Product Plane. GitHub for Jira app handles bidirectional linking between branches/PRs and Jira issues — no custom bridge service needed.

**Module linkage:** Each module record has a `github_repo` field (e.g., `org/smartmarket-geoanalytics`). This is the canonical link between the module registry and source code.

## 9.3 Slack

**System of record for:** Nothing. Slack is a delivery channel for notifications, not a data source.

**Integration pattern:** Product Plane pushes notifications to Slack channels based on event type and product association.

---

# 10. API Surface

All external APIs served by `factory-product-api`.

## 10.1 Module Registry

```
GET    /modules                         List all modules (filterable by product, state)
GET    /modules/:module_id              Get module detail
POST   /modules                         Create module
PATCH  /modules/:module_id              Update module (name, description, owner_team, github_repo)
POST   /modules/:module_id/transition   Transition lifecycle state
GET    /modules/:module_id/versions     List module versions (read-through to Build Plane)
GET    /modules/:module_id/dependencies Module dependency graph
GET    /modules/:module_id/roadmap      Module roadmap items
```

## 10.2 Work Graph

```
GET    /products/:product_id/initiatives    List initiatives
GET    /initiatives/:initiative_id          Get initiative with epics
GET    /epics/:epic_id                      Get epic with stories
GET    /stories/:story_id                   Get story with tasks and PR links
GET    /products/:product_id/backlog        Backlog view (filterable, sortable)
GET    /products/:product_id/sprints        Sprint list with velocity data
GET    /sprints/:sprint_id                  Sprint detail with stories
```

## 10.3 Release Planning

```
GET    /release-plans                       List release plans (filterable by product, state, milestone)
GET    /release-plans/:id                   Get release plan with stories and module scope
POST   /release-plans                       Create release plan
PATCH  /release-plans/:id                   Update release plan
POST   /release-plans/:id/transition        Transition state (draft→scoped→finalized→released)
POST   /release-plans/:id/stories           Add stories to release plan
DELETE /release-plans/:id/stories/:story_id Remove story from release plan (requires reason)
GET    /release-plans/:id/notes             Get release notes
POST   /release-plans/:id/notes             Create/update release note entries
GET    /release-plans/:id/changelog         Get changelog entries
```

## 10.4 Architecture Governance

```
GET    /adrs                                List all ADRs (filterable by repo, status, tag)
GET    /adrs/:adr_id                        Get ADR detail
GET    /standards                            List platform standards
GET    /standards/:standard_id              Get standard detail
GET    /modules/:module_id/doc-coverage     Get documentation coverage for module
GET    /doc-coverage                         Aggregate documentation coverage report
```

## 10.5 Engineering Analytics

```
GET    /analytics/delivery                  Delivery metrics (filterable by product, module, period)
GET    /analytics/quality                   Quality metrics (filterable by product, module, period)
GET    /analytics/velocity                  Velocity trends (by team, product)
GET    /analytics/at-risk                   Current at-risk signals
GET    /analytics/cross-product             Cross-product dependency status
```

## 10.6 Internal

```
POST   /webhooks/jira                       Jira webhook receiver
POST   /webhooks/github                     GitHub webhook receiver
GET    /health                              Health check
GET    /metrics                             Prometheus metrics
```

---

# 11. Non-Functional Requirements

## Scalability

- Support 10+ products
- Support 500+ modules across all products
- Support 100,000+ work items (stories + tasks) across all products
- Support 1,000+ release plans
- Analytics queries must complete in < 5 seconds

## Availability

- Product Plane is not on the critical runtime path (Sites do not depend on it at runtime)
- Target availability: 99.9% during business hours
- Webhook ingestion (Jira, GitHub) must be resilient to temporary downstream failures (queue and retry)

## Data Freshness

- Jira sync: < 5 minutes from status change to Product Plane event
- GitHub sync: < 2 minutes from PR merge to metric update
- Analytics computation: Daily batch + on-demand refresh
- ADR index: < 5 minutes from GitHub push to index update

## Security

- All API access authenticated via Factory identity
- Role-based access: product owner, engineering lead, viewer
- Webhook endpoints validated via HMAC signatures (Jira, GitHub)

---

# 12. Success Criteria

- Any module can be traced from product definition through to running deployment (Product → Build → Fleet → Service)
- Release plans can be composed, scoped, and finalized in < 10 minutes
- Engineering analytics are available without manual data collection
- ADR review workflow is fully supported through GitHub PRs
- At-risk signals fire within 1 hour of threshold breach
- New product onboarding (creating product + first modules + first release plan) completes in < 30 minutes
- No work item exists without traceability to a product and (optionally) a release plan
- Cross-product dependency blockers are visible to all stakeholders within 1 business day

---

# 13. Explicit Boundaries

Product Plane does not:

- Build software or run CI/CD pipelines (Build Plane)
- Produce artifacts or container images (Build Plane)
- Deploy releases or manage rollouts (Fleet Plane)
- Manage customer accounts, billing, or entitlements (Commerce Plane)
- Provision infrastructure (Infrastructure Plane)
- Execute product business logic (Service Plane)
- Replace Jira for work management (Jira is the system of record; Product Plane aggregates)
- Replace GitHub for documentation (GitHub is the system of record; Product Plane indexes and governs)
- Manage agent identity or execution (Agent Plane)

---

# 14. Phased Delivery

## Phase 1 — Foundation

- Module registry (CRUD, lifecycle states, github_repo linkage)
- Jira webhook integration (work graph sync, status events)
- GitHub webhook integration (PR events, ADR sync)
- Release plan lifecycle (draft → scoped → finalized → released)
- Release notes generation (draft from story data, manual editing)
- Basic engineering analytics (velocity, cycle time, PR merge time)
- Slack notifications (release events, at-risk signals)
- `factory-product-api` service deployed

## Phase 2 — Scale

- Cross-product dependency tracking and visualization
- Documentation coverage tracking and reporting
- Advanced engineering analytics (defect escape rate, regression rate, lead time)
- Agent Plane read API integration (backlog grooming, analytics agents)
- Release plan to Fleet release bridge (automated event flow)
- Platform standards registry and enforcement tracking
- Module roadmap items

## Phase 3 — Maturity

- Full cross-plane traceability dashboard (initiative → code → deployment → customer impact)
- Automated at-risk scoring with ML-based prediction
- Release impact analysis (which customers are affected by a release)
- Module health scoring (composite of quality, docs, deployment frequency, defect rate)
- Changelog publishing pipeline (auto-generate customer-facing changelogs from release notes)
- Historical trend analysis and reporting

---

# 15. Open Questions

1. **Jira project structure.** One Jira project per product, or one shared project with product labels? This affects how the work graph hierarchy is queried.
2. **Story point standardization.** Are story points calibrated across teams, or per-team relative? This affects whether velocity can be compared cross-team.
3. **Release cadence.** Is there a standard release cadence (e.g., bi-weekly, monthly), or does each product set its own? This affects milestone and sprint alignment.
4. **Module granularity.** Is `auth-service` a module, or is it a Control Plane concern that exists outside the module system? Where is the line between "platform service" and "module"?
5. **ADR approval quorum.** How many reviewers must approve an ADR PR for it to be accepted? Is this configurable per repository or global?
6. **Defect-to-customer linkage.** Should defects be linkable to specific customer accounts (from Commerce Plane)? This enables "which customers are affected by this bug" but requires a cross-plane reference.
7. **Changelog audience separation.** Should customer-facing changelogs be auto-generated or manually curated? Auto-generation saves time but risks exposing internal details.

---

# 16. Key Services

**Custom-built:**

```
factory-product-api              Core REST API; owns module registry, release plans,
                                 ADR index, analytics, and cross-plane event relay
factory-product-analytics-worker Pulls data from Jira and GitHub APIs, computes
                                 delivery and quality metrics on schedule
factory-product-event-relay      Publishes outbox events to platform event bus
```

**Third-party integrations (configured, not built):**

```
Jira                             Work graph (initiative → epic → story → task),
                                 sprint management
GitHub                           Source code, PRs, Markdown documentation,
                                 branch protection rules
GitHub for Jira                  Automatic story status transitions from
                                 branch/PR activity
Slack                            Event notifications for ADRs, release plans,
                                 at-risk signals
```

No custom Jira-GitHub bridge needed — the GitHub for Jira app handles bidirectional linking. The `factory-product-api` reads from both Jira and GitHub APIs to compose cross-plane views.

---

# 17. Final Definition

The Product Plane is the authoritative system of record for product intent at the Factory level.

It governs:

- What the company builds (module registry, product definitions)
- Why it builds it (initiatives, epics, stories)
- When it ships (release plans, milestones, changelogs)
- How decisions are made (ADRs, platform standards)
- How well it delivers (engineering analytics, quality metrics)

It produces release plan finalization events that trigger Fleet Plane to compose deployable releases. It indexes architecture decisions and documentation to ensure governance is traceable and searchable. It computes delivery and quality metrics from actual work and build data to replace estimation with measurement.

It is the product brain of the Factory — not the build system, not the deployment orchestrator, and not the commercial engine.
