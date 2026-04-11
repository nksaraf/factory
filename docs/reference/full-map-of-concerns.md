# The Full Map of Concerns

## Everything a software company thinks about, and where our model covers it

---

## How to Read This Document

For each concern area, I'll note:

- **Covered** — our model handles this well
- **Thin** — we have the entity but not enough depth
- **Missing** — a real gap that needs vocabulary and possibly new entities
- **Out of scope** — real concern but belongs to a specialized system, not our inventory

---

## I. THE IDEA-TO-PRODUCTION PIPELINE

Everything between "someone has an idea" and "it's running in production for customers."

### 1.1 Strategy & Roadmap — MISSING

We have Product (with lifecycle) and Capability (with lifecycle), but we have no vocabulary
for the PLANNING layer above them.

**What's missing:**

**OUTCOME** — the business result a capability is meant to achieve. "Reduce network
planning time by 40% for enterprise customers." An outcome is not a feature — it's the
WHY behind a feature. Multiple capabilities might serve one outcome. OKRs, KPIs, and
success metrics attach here.

**ROADMAP ITEM** — a planned addition or change to the product. Might become a Capability,
might be a Component improvement, might be a non-functional requirement. Roadmap items have
a time horizon (now/next/later or quarter-based), a confidence level, and dependencies on
other roadmap items.

**EXPERIMENT** — a hypothesis being tested. "If we add AI-assisted planning, enterprise
customers will create plans 3x faster." An experiment might produce a Capability, or it
might be abandoned. This is distinct from a Capability with lifecycle: experimental —
an experiment might not even be code yet. It could be a design prototype, a customer
interview series, or a Wizard-of-Oz test.

**Why it matters:** Without these, your product team is making roadmap decisions in
spreadsheets and Notion docs that are disconnected from the technical catalog. When
engineering asks "why are we building this?", the answer should trace from Capability →
Roadmap Item → Outcome. When leadership asks "what's the ROI of the AI Data Analyst?",
the answer should trace from Outcome → KPI → actual usage metrics.

**Recommendation:** These probably live in your product management tool (Productboard,
Jira Product Discovery, Linear), not in the infrastructure model. But the Capability
entity should have an `outcome_ref` or `roadmap_ref` that links to the planning layer.

---

### 1.2 Design — THIN

We have Component (with source_repo and architecture_doc_url), but the design process
and its artifacts are unmodeled.

**What's thin:**

**ARCHITECTURE DECISION RECORD (ADR)** — a documented decision about how something should
be built. "We chose SpiceDB over Casbin for authorization because..." ADRs are the
institutional memory of WHY your system looks the way it does. They should live with the
code (in the repo) and be referenced by the Component or System they affect. Our model
has `architecture_doc_url` but that's a single link — a System might have 20 ADRs.

**DESIGN DOCUMENT / RFC** — a proposal for a significant change, subject to review and
approval before implementation. Different from an ADR (which records a decision already
made). RFCs have a lifecycle: draft → in review → approved → implemented → superseded.
Your workspace data architecture RFC for Trafficure is a real example.

**INTERFACE CONTRACT** — we have API as an entity with `definition_url`, but we're
missing the concept of contract versioning, breaking change detection, and consumer
compatibility. When you change the Trafficure API, which consumers break? Contract
testing (Pact, Specmatic) is the practice; the mental model is that the API entity
should track its consumers' known-good contract versions.

**Recommendation:** ADRs and RFCs should be properties or linked documents on System
and Component. Interface contracts are an extension of the API entity. None of these
need new top-level entities.

---

### 1.3 Development Process — MISSING

Our model tracks what exists (Components) and where it runs (Deployments), but nothing
about HOW code moves from a developer's hands to production.

**What's missing:**

**BRANCH STRATEGY** — per Component, how do branches map to environments? trunk-based
development? gitflow? feature branches that auto-deploy to preview environments?
This is a property on Component that determines how the CI/CD pipeline behaves.

**CODE REVIEW POLICY** — per Component or System, what's required before code merges?
Required reviewers, automated checks, minimum approval count, security review
for certain paths. This connects to compliance requirements on the Deployment.

**FEATURE FLAG** — distinct from entitlement flags. Engineering feature flags are
temporary switches that control code rollout, not commercial access. They have a
lifecycle: created → enabled-for-dev → canary → percentage-rollout → fully-enabled →
flag-removed. Feature flags that aren't cleaned up become tech debt. They belong on
the Component level and should have an `expected_removal_date`.

**Why it matters:** When an incident happens, you need to trace: which PR introduced
the change, who reviewed it, what feature flag was it behind, and what was the
deployment path from merge to production. Without this vocabulary, incident
investigation is archaeology.

**Recommendation:** Branch strategy and code review policy are properties on Component.
Feature flag could be a lightweight entity linked to Component, or it could live
entirely in your feature flag system (LaunchDarkly, Unleash, custom) with a reference
from the Component.

---

### 1.4 CI/CD Pipeline — THIN

We have `deployment_mechanism` on Deployment and `build_source` on Artifact, but the
pipeline itself — the automated machine that builds, tests, and deploys — is invisible.

**What's thin:**

**PIPELINE** — a defined automated workflow that transforms source code into running
deployments. A pipeline has stages, triggers, secrets it uses, infrastructure it runs
on (Workspaces of type ci-runner), and a history of runs. Our model references
pipelines indirectly but doesn't name them.

**PIPELINE RUN** — a specific execution of a pipeline. This is the audit trail entity
for "what happened between code merge and production deployment." A pipeline run
produces Artifacts, creates or updates Deployments, and should be linked to the Change
Log entry on every entity it touches.

**PROMOTION PATH** — the sequence of environments an Artifact passes through before
reaching production. We have `promotion_path` on Release Bundle, but the concept
deserves more depth: what gates exist between stages? What tests must pass? What
approvals are needed? Is promotion automatic or manual?

**Recommendation:** Pipeline and Pipeline Run are probably entities in your CI/CD system
(GitHub Actions, GitLab CI), not in the inventory model. But the inventory model should
reference them: every Deployment should know "which pipeline run last deployed me" and
every Artifact should know "which pipeline run produced me."

---

### 1.5 Testing — MISSING

Completely absent from our model. Testing is a first-class engineering concern that
intersects infrastructure (where do tests run?), security (what do tests validate?),
and customer confidence (did we test the customer's specific configuration?).

**What's missing:**

**TEST SUITE** — a named collection of tests that validates a Component or System.
Types: unit tests (fast, per-component), integration tests (between components),
contract tests (API compatibility), end-to-end tests (full user flows), performance
tests (load, stress, soak), security tests (SAST, DAST, dependency scanning), and
chaos tests (failure injection). Each type runs at a different stage of the pipeline
and on different infrastructure (unit tests on CI runners, e2e tests on preview
environments, chaos tests on staging).

**TEST ENVIRONMENT** — a Workspace (from V3) specifically provisioned for testing.
Our Workspace entity covers this (type: test-environment), but the connection between
test suites and the environments they need is implicit. A System's e2e test suite might
require a full-stack deployment with seed data — the test environment specification is
a kind of Template.

**TEST DATA** — seed data, fixtures, anonymized production data, synthetic data used
for testing. Test data has its own lifecycle and sensitivity. Using actual customer
data for testing is a compliance issue. You need vocabulary for: `production-copy`
(anonymized), `synthetic` (generated), `fixture` (hardcoded), `seed` (minimal dataset
for bootstrapping).

**QUALITY GATE** — a set of conditions that must pass before promotion. "Coverage > 80%,
no critical vulnerabilities, all contract tests pass, performance within 10% of
baseline." Quality gates sit between environments in the promotion path.

**Recommendation:** Test suites and quality gates are properties on Component and
System respectively. Test environment is covered by Workspace. Test data management
is a practice concern, not an entity — but the vocabulary should exist.

---

### 1.6 Release Management — THIN

We have Release Bundle and Artifact, but the human/organizational side of shipping
software is unmodeled.

**What's thin:**

**RELEASE** — the act of making a new version available. Different from a Release
Bundle (the artifacts) and different from a Deployment (running those artifacts
somewhere). A release is an EVENT, not an entity. But it has properties: release
notes, changelog, who approved it, what's included, who was notified.

**RELEASE TRAIN** — a cadence for shipping. "We release Trafficure on the first
Tuesday of every month." "SmartMarket ships continuously." This is a property on
Product or System that determines how Release Bundles are assembled and promoted.

**CUSTOMER NOTIFICATION** — when a release affects customer deployments, someone
needs to communicate: what changed, when it's happening, whether action is required.
For SaaS customers this might be a changelog post. For managed on-prem customers
it's a formal change notification with a maintenance window. For self-hosted
customers it's release notes in a portal. The notification mechanism depends on
the Offering.

**DEPRECATION NOTICE** — when a Capability, API version, or Component is being
sunset, affected customers need to know: what's being deprecated, when it will be
removed, what the migration path is, and what happens if they don't migrate. This
connects to the API entity (version lifecycle) and the Initiative entity (migration
campaigns).

**Recommendation:** Release is an event in the Change Log, not a separate entity.
Release train is a property on Product/System. Customer notification and deprecation
notice are practices that reference existing entities.

---

## II. THE RUNTIME CONCERNS

Everything about systems while they're running in production.

### 2.1 Observability — THIN

We reference Grafana, Loki, Tempo, OTel collectors as Components, and we have
`runbook_url` on Deployments. But observability as a conceptual framework is
unmodeled.

**What's thin:**

**SLO (Service Level Objective)** — a target for a service's behavior. "99.9% of
Trafficure API requests return in under 500ms." An SLO is defined on a Component or
Deployment, has a measurement (SLI — Service Level Indicator), a target, a time
window (rolling 30 days), and an error budget (how much failure is acceptable before
you stop shipping features).

**SLI (Service Level Indicator)** — the metric that measures the SLO. "Proportion
of requests with latency < 500ms." SLIs are derived from telemetry data (metrics,
traces, logs) and are the quantitative expression of "is this service healthy?"

**SLA vs SLO distinction** — we have SLA on Engagement (the contractual promise to the
customer) and we need SLO on Component/Deployment (the internal target, usually
stricter than the SLA). The SLA is external and legally binding. The SLO is internal
and operationally binding. You might have an SLA of 99.5% uptime for Ultratech but
an internal SLO of 99.9% — the gap is your safety margin.

**ERROR BUDGET** — the amount of allowable unreliability. If your SLO is 99.9% over 30
days, your error budget is 0.1% of 30 days = ~43 minutes. If you've used 30 minutes of
downtime this month, you have 13 minutes left. When the error budget is exhausted,
engineering should freeze feature releases and focus on reliability. This is the
mechanism that balances velocity with stability.

**ALERT** — a defined condition that triggers notification. Alerts are configured on
Deployments, reference SLIs or raw metrics, have severity levels, and route to specific
Teams via on-call rotations. Alert fatigue (too many noisy alerts) is a real
operational problem. Alerts should be reviewed and pruned like code.

**DASHBOARD** — a visual aggregation of metrics for a Component, System, Deployment, or
Customer. Dashboards have owners (Teams) and should be linked from the entity they
monitor. "Where's the dashboard for Trafficure API?" should be answerable from the
Component record.

**Recommendation:** SLO is a first-class property on Component and/or Deployment.
SLI is a property on the SLO. Error budget is derived from the SLO + actual telemetry.
Alerts and dashboards are properties/links on Deployments and Components.

---

### 2.2 Incident Management — MISSING

Completely absent from our model. Incidents are where all the vocabulary comes together
under pressure.

**What's missing:**

**INCIDENT** — an unplanned event that degrades or disrupts service. An incident has:
severity (P1-P4), status (detected → acknowledged → investigating → mitigated →
resolved → postmortem-complete), affected Deployments, affected Customers (with
their SLA implications), a timeline of actions taken, a root cause (traced to a
Component, Artifact version, configuration change, or infrastructure failure), and
an owner (the person or team leading resolution).

**INCIDENT TIMELINE** — the sequence of events during an incident. "13:04 Alert fired.
13:07 On-call acknowledged. 13:15 Identified root cause: OOM on coverage-service
due to memory leak in v2.4.1. 13:22 Rolled back to v2.4.0. 13:25 Service restored."
This timeline is the raw material for postmortems and for improving the system.

**POSTMORTEM** — the analysis after an incident is resolved. Contains: what happened,
why it happened (root cause analysis, often using the "5 whys"), what was the
customer impact, what are the remediation actions, and what systemic improvements
will prevent recurrence. Remediation actions become Initiative items or Component
backlog items.

**Why incidents matter for the model:** During an incident, responders need to
traverse the ENTIRE model at speed: Alert → Deployment → Component → who's the
owner? → what changed recently? (Change Log) → which Customers are affected?
→ what SLAs are at risk? → who's the Engagement Manager to notify the customer?
→ what's the Runbook for this component? → what are the Dependencies that might
be the actual root cause?

The incident is the ultimate test of whether your vocabulary is complete and your
data is connected. If responders have to switch between 5 different tools and
mentally map different terminologies, your vocabulary has failed.

**Recommendation:** Incident is an entity in your incident management system
(PagerDuty, Grafana OnCall, OpsGenie). It should reference: affected Deployment(s),
root cause Component/Artifact, Customers impacted, and Engagement(s) with SLA
implications. The inventory model should be queryable FROM the incident tool.

---

### 2.3 Change Management — THIN

We have Change Log as a cross-cutting concern and `change_process` on Deployment.
But the structured change management process used for customer-facing environments
is underspecified.

**What's thin:**

**CHANGE REQUEST** — a formal request to modify a production deployment, especially
for customer environments with `change_process: customer-approval`. A change request
has: what's being changed, why, risk assessment, rollback plan, scheduled time,
required approvals, and outcome. This is the ITIL change management process,
simplified.

For SaaS deployments with continuous deployment, change requests are implicit (every
merge to main is a change). For managed enterprise deployments, change requests are
explicit and may require a Change Advisory Board (CAB) review.

**MAINTENANCE WINDOW** — we have this as a property on Engagement, but it's more
complex in practice. Windows can be recurring (every Sunday 2-6am), one-time
(next Saturday for a migration), or emergency (bypassing normal windows for critical
fixes). They can be customer-specific or environment-wide.

**ROLLBACK** — the ability to reverse a change. Not every change is reversible.
Database migrations, data transformations, and breaking API changes may not be
rollback-safe. The rollback plan should be a required field on every change request,
and "not rollback-safe" should require additional approval and testing.

**Recommendation:** Change Request is an entity in your change management process
(could be a Jira ticket type, could be a custom system). It should reference the
Deployment being changed, the Artifact version being deployed, and the Engagement
whose change_process governs the approval.

---

### 2.4 Configuration Management — MISSING

We have `config_source` and `config_overlays` on Deployment, but the actual management
of configuration is a deeper concern.

**What's missing:**

**CONFIGURATION LAYER** — the mental model of how configuration is assembled for a
specific deployment. Configuration comes from multiple layers, each overriding the
previous:

```
1. Defaults (baked into the Artifact)
2. Environment-specific (staging vs production)
3. Topology-specific (single-node vs clustered)
4. Customer-specific (Samsung's network parameters)
5. Deployment-specific (this particular instance's secrets and endpoints)
6. Runtime overrides (feature flags, emergency toggles)
```

**CONFIGURATION DRIFT** — when the actual running configuration diverges from the
declared configuration. We have `drift_status` on Deployment, but configuration
drift is distinct from deployment drift. The right Artifact version might be
deployed, but someone SSH'd in and changed an environment variable manually.
Configuration drift is the #1 cause of "it works in staging but not production"
bugs.

**SECRETS MANAGEMENT** (as a practice, not just the Secret entity) — how secrets get
from your vault to the running workload. Are they injected at deploy time? Mounted
as files? Fetched at runtime? Does the workload cache them? If a secret is rotated,
does the workload pick up the new value without restart? These are operational
properties on the Deployment that determine how you handle secret rotation incidents.

**Recommendation:** Configuration layer is a conceptual model for your developers, not
an entity. Configuration drift detection is a feature of your deployment tooling.
Secrets management practices are properties on Component (how it consumes secrets)
and Deployment (how secrets are delivered).

---

### 2.5 Disaster Recovery — THIN

We have `dr` as an environment type, and RPO/RTO on Data Store. But DR as a holistic
concern is underspecified.

**What's thin:**

**DR PLAN** — per Customer or per Deployment, what happens when the primary deployment
is completely lost? Where's the standby? How is failover triggered? Is it automatic
or manual? What's the data loss tolerance? How long to recover?

**BACKUP** — we have `backup_schedule` on Data Store, but backup verification is
missing. An untested backup is not a backup. The model should track: when was the
last successful backup, when was the last successful restore TEST, and how long did
the restore take (does it meet the RTO)?

**FAILOVER TOPOLOGY** — for critical customers, you might have a standby deployment
in a different region or on different infrastructure. The relationship between
primary and standby deployments is a specific type of relation in our graph:
`deployment:primary → fails-over-to → deployment:standby`.

**Recommendation:** DR plan is a property on Deployment (for critical deployments) or
Engagement (for customers with DR SLA commitments). Backup verification should be a
tracked status on Data Store.

---

## III. THE HARDWARE & PHYSICAL LAYER

Everything about the physical world that software runs on.

### 3.1 Hardware Lifecycle — MISSING

We model Substrates and Hosts, but physical hardware has its own lifecycle that's
completely different from software lifecycle.

**What's missing:**

**HARDWARE ASSET** — a physical device with a serial number, purchase date, warranty
expiry, vendor, model, and physical location (rack, slot). This is below Substrate
in our model — a Substrate might be a Proxmox cluster, but the actual servers in
that cluster are hardware assets with warranty dates and replacement cycles.

**PROCUREMENT** — the process of buying hardware. Lead times for servers can be 4-12
weeks. If you need to expand your Proxmox cluster for a new customer deployment,
the hardware procurement timeline directly affects the Engagement timeline.

**WARRANTY & SUPPORT CONTRACT** — hardware vendors (Dell, HPE, Supermicro) provide
warranties and support contracts. These are similar to our SLA concept but for
hardware: "4-hour on-site replacement for failed disks." When the warranty expires,
you're responsible for replacement parts — this is a cost and risk that should be
tracked.

**END OF LIFE / END OF SUPPORT** — hardware vendors eventually stop supporting
old models. Running production workloads on unsupported hardware is a risk. The
model should track: when is this hardware asset end-of-support, and which
Deployments are running on it?

**PHYSICAL NETWORK** — for on-prem, the actual cables, switches, patch panels, and
physical network topology. We have Network Entity for logical networking, but
physical networking is a separate concern: which port on which switch connects to
which server's NIC? This matters when diagnosing network issues or planning physical
infrastructure changes.

**POWER & COOLING** — datacenter capacity is limited by power (kW per rack) and
cooling. Adding more servers to a rack might not be possible if the power budget is
exhausted. This is relevant for your Proxmox cluster capacity planning.

**Recommendation:** Hardware Asset is a sub-entity of Substrate for physical
infrastructure. It carries serial number, warranty, and EOL data. Procurement and
physical network are operational processes that reference hardware assets. Power
and cooling are properties on the datacenter Substrate.

---

### 3.2 Customer Hardware — THIN

For on-prem deployments, you're running on hardware YOU DON'T OWN. This creates unique
concerns.

**What's thin:**

**HARDWARE COMPATIBILITY MATRIX** — your software has minimum requirements (CPU cores,
RAM, disk, OS version, network bandwidth). The customer's hardware may or may not
meet them. The engagement team needs to verify compatibility before committing to
a deployment timeline. If the customer's server has 16GB RAM and you need 32GB,
that's a blocker.

**CUSTOMER INFRASTRUCTURE DISCOVERY** — when you first engage with an on-prem
customer, you need to discover and document their existing infrastructure. What
hypervisors, what OS versions, what network topology, what firewall rules, what
existing software might conflict. This is an Engagement deliverable that populates
Substrate and Host records in your inventory.

**SHARED HARDWARE** — the customer's server might run other software besides your
product. Their database server might host their ERP system alongside your Postgres
deployment. Resource contention on shared hardware causes performance issues that
look like your software's fault but aren't.

**Recommendation:** Hardware compatibility matrix is a property on the Offering
(minimum requirements for each deployment topology). Customer infrastructure
discovery is a phase of the Implementation Engagement. Shared hardware is a
risk flag on the Host entity.

---

## IV. THE DATA LAYER

Everything about data as a strategic asset, beyond just "where it's stored."

### 4.1 Data Governance — MISSING

We have Data Store with residency and retention properties, but data governance as a
practice is much broader.

**What's missing:**

**DATA CLASSIFICATION** — not all data is equally sensitive. Public data, internal
data, confidential data, and restricted/regulated data each have different handling
requirements. Every Data Store should have a classification level, and that
classification should drive encryption, access control, and retention policies.

**DATA LINEAGE** — where did this data come from, how was it transformed, and where
does it go? When your AI Data Analyst produces a report, the customer might ask
"where did these numbers come from?" Data lineage traces from the output back
through transformations to source data. This is especially important for regulated
industries and for trust in AI-generated insights.

**DATA OWNERSHIP** — distinct from Component ownership. The Platform team might own
the Postgres Component, but the customer OWNS their data in it. Data ownership
determines who can access it, who can delete it, and what happens to it when the
customer churns.

**DATA PORTABILITY** — when a customer leaves, they have a right (legal in some
jurisdictions, contractual in others) to export their data. Your model should know:
what data belongs to this customer, in what format can it be exported, and how long
do you retain it after churn?

**PII MAPPING** — which Data Stores contain personally identifiable information,
what PII fields exist, and where PII flows between systems. This is required for
GDPR compliance (data subject access requests, right to deletion) and is a
recurring audit item.

**Recommendation:** Data classification and PII mapping are properties on Data Store.
Data lineage is a practice supported by tooling (dbt, Great Expectations, custom).
Data ownership and portability are properties on the Customer ↔ Data Store
relationship.

---

### 4.2 AI/ML Specific Concerns — MISSING

You have AI capabilities (AI Data Analyst, Revenue Prediction). ML workloads have
fundamentally different lifecycle concerns than traditional software.

**What's missing:**

**MODEL** — a trained ML model is a different kind of Artifact. It has: training data
(which dataset, which version), training parameters (hyperparameters, epochs),
evaluation metrics (accuracy, precision, recall on a test set), and a lineage back
to the training pipeline. A model version might be promoted to production based on
evaluation metrics, not just "tests pass."

**MODEL DEPLOYMENT** — deploying a model is different from deploying code. You might
deploy the same code (inference service) but swap the model weights. The Deployment
entity needs to track both the code Artifact AND the model Artifact independently.
A model update that doesn't change code is still a deployment event.

**TRAINING INFRASTRUCTURE** — GPU hosts, training clusters, dataset storage. These
might be ephemeral (spin up a GPU cluster for training, tear it down after). They're
Workspaces with specific capabilities (GPU, large storage).

**MODEL MONITORING** — models degrade over time as the real world drifts from
training data. "Model drift" is the ML equivalent of configuration drift. You need
to monitor model performance in production and retrain when accuracy drops.

**CUSTOMER-SPECIFIC MODELS** — your Revenue Prediction module for Samsung uses
Samsung-specific training data and produces a Samsung-specific model. This is a
customer-specific Artifact. When you generalize the module, you might have both a
base model and per-customer fine-tuned models.

**Recommendation:** Model is a sub-type of Artifact with additional properties
(training data, eval metrics, lineage). Model deployment is a Deployment with both
code and model artifact references. Training infrastructure is Workspace with GPU
capability. Model monitoring is an SLO variant (accuracy SLO instead of latency SLO).

---

## V. THE ORGANIZATIONAL LAYER

Everything about how people, teams, and processes are structured.

### 5.1 Team Topology — THIN

We have Team and Person, but the way teams interact is unmodeled.

**What's thin:**

**TEAM TYPE** — we have `type` (product-team, platform-team, sre-team) but Team
Topologies (the book by Skelton & Pais) defines four canonical types with specific
interaction modes:

- **Stream-aligned team** — owns a System end-to-end, delivers value directly to
  customers. Your Trafficure Core team and SmartMarket team.
- **Platform team** — provides self-service infrastructure to stream-aligned teams.
  Your Platform/IAM team.
- **Enabling team** — helps stream-aligned teams adopt new practices. Might be
  temporary. "The team helping everyone adopt OTel tracing."
- **Complicated subsystem team** — owns a technically complex subsystem that requires
  deep specialist knowledge. Your RF Engine team, if it exists separately.

**INTERACTION MODE** — how teams relate to each other:

- **Collaboration** — working closely together on something (temporary, high-bandwidth)
- **X-as-a-service** — one team provides a service to another (stable, low-bandwidth)
- **Facilitating** — one team helps another improve (temporary, teaching-oriented)

**COGNITIVE LOAD** — how much a team can realistically own. If a team owns 15
Components, 8 Deployments across 4 customers, and is part of 3 active Engagements,
they're probably overloaded. The model should make team load visible: count of
Components owned, Deployments managed, active Engagements, on-call rotations.

**Recommendation:** Team type (using Team Topologies vocabulary) and interaction
mode are properties on Team and Team ↔ Team relationships. Cognitive load is
a derived metric from entity counts per team.

---

### 5.2 Knowledge Management — MISSING

We reference documentation URLs throughout the model, but the practice of maintaining
institutional knowledge is an unaddressed concern.

**What's missing:**

**RUNBOOK** — we have `runbook_url` but a runbook is more than a link. A good runbook
is: versioned (changes with the component), tested (someone ran through the steps
recently), owned (someone is responsible for keeping it current), and structured
(step-by-step with decision trees, not a wall of text). A stale runbook is worse
than no runbook — it gives false confidence.

**ONBOARDING GUIDE** — for each System and for the company as a whole, how does a new
developer get productive? What do they need to install, what access do they need, what
should they read first? This connects to Templates (which scaffold new projects) but
is broader — it includes understanding the vocabulary, the architecture, the deployment
model.

**TRIBAL KNOWLEDGE** — the stuff that's only in someone's head. "Ask Priya about the
Samsung VPN setup" or "the Ultratech deployment has a quirk where you need to restart
Redis after rotating certs." This is the most dangerous knowledge category because it's
invisible until the person leaves. The model can't capture tribal knowledge directly,
but it can make it visible: every entity without a runbook, every Deployment without
architecture docs, every frozen-legacy Deployment — these are likely tribal knowledge
risks.

**Recommendation:** Runbook should have properties (last_tested, owner, last_updated)
not just a URL. Onboarding is a Template concern. Tribal knowledge risk is a derived
metric: "entities without documentation."

---

### 5.3 Vendor & Third-Party Management — MISSING

We have Managed Dependency for third-party services, but vendor management is broader.

**What's missing:**

**VENDOR** — an organization you purchase from. Not just cloud services (AWS, Cloudflare)
but also: software licenses (JetBrains, Microsoft, Red Hat), hardware vendors (Dell,
Supermicro), SaaS tools your company uses (Slack, Jira, GitHub, Figma), and contractors/
agencies.

**VENDOR CONTRACT** — what you've purchased, at what terms, when it renews, what the
cancellation terms are. This is the inverse of YOUR License entity — it's a license
someone else grants to YOU. Vendor contracts expire, auto-renew, have usage limits,
and cost money. "Our GitHub Enterprise license renews in March for $X" is vendor
contract information.

**VENDOR RISK** — what happens if a vendor goes down, gets acquired, changes pricing,
or changes terms? For every Managed Dependency, there should be an assessment:
criticality (how bad if it's gone), substitutability (how hard to replace),
contractual protection (are you locked in), and data portability (can you get your
data out).

**SOFTWARE BILL OF MATERIALS (SBOM)** — what open-source and third-party libraries are
in each Artifact. This is a security and compliance requirement (US Executive Order
14028 requires SBOMs for software sold to government). We have `sbom` as a property
on Artifact, but it deserves emphasis: every Artifact should have an SBOM, and the
SBOM should be checked against known vulnerability databases (CVE, NVD) on every build.

**Recommendation:** Vendor is an entity if you want to track vendor relationships
centrally. Vendor contract is a lightweight entity or a property on Managed Dependency.
SBOM is a required property on every Artifact.

---

### 5.4 Security — THIN

We have Secret, compliance tags on Deployment, and SBOM on Artifact. But security as
a holistic concern has significant gaps.

**What's thin:**

**VULNERABILITY** — a known security flaw (CVE) in a Component, Artifact, or dependency.
Vulnerabilities have severity (CVSS score), affected versions, fix availability
(patched version exists or not), and exploitability (is it actively exploited in the
wild). A vulnerability propagates: if a library used by `trafficure-api` has a
critical CVE, then every Deployment of `trafficure-api` is affected, which means
every Customer with those Deployments is at risk.

**ACCESS REVIEW** — periodic verification that the right people have the right access
to the right things. "Who has SSH access to the Ultratech production server? Is that
still appropriate?" Access reviews should cover: Host access (SSH/RDP), Substrate
access (cloud console), Deployment configuration access, Secret access, and Customer
data access. This is a compliance requirement for most frameworks (SOC 2, ISO 27001).

**SECURITY INCIDENT** — distinct from operational incidents. A security incident
involves: unauthorized access, data breach, compromised credentials, or malicious
activity. It has different response procedures (containment, evidence preservation,
legal notification) and different stakeholders (security team, legal, potentially
regulators and affected customers).

**THREAT MODEL** — per System or Component, what are the known attack vectors, what
controls are in place, and what residual risks exist? Threat models should be reviewed
when the System architecture changes (informed by ADRs).

**Recommendation:** Vulnerability tracking is a security tooling concern (Snyk, Trivy,
Dependabot) that should link to Components and Artifacts. Access review is a process
that queries the model's Host, Substrate, and Secret entities. Security incidents are
a specialized Incident type.

---

## VI. THE FINANCIAL LAYER

Everything about money flowing in and out.

### 6.1 Cost Attribution — THIN

We have `cost_tag` on various entities, but cost attribution is a deep concern.

**What's thin:**

**COST MODEL** — how do you calculate the fully loaded cost of serving a customer?

```
Direct infrastructure:
  Substrate cost (cloud bill allocation, hardware amortization)
  + Host cost (VM/instance cost)
  + Managed Dependency cost (RDS, S3, etc.)
  + Network cost (bandwidth, VPN)

Direct people:
  + Engagement team time × rate
  + Support time × rate
  + On-call allocation × rate

Shared infrastructure (allocated):
  + Proportion of platform services (IAM, observability, CI/CD)
  + Proportion of shared hosting (multi-tenant clusters)

Shared people (allocated):
  + Proportion of platform team time
  + Proportion of management overhead
```

**MARGIN ANALYSIS** — revenue (from Customer's Subscription) minus cost (from the
cost model above) equals margin per customer. Some customers are profitable, some
aren't. This drives strategic decisions: which customers to invest in, which
Offerings to promote, where to automate to reduce cost.

**INFRASTRUCTURE SPEND TREND** — total infrastructure cost over time, broken down
by: cloud provider, by product, by customer tier, by environment (production vs
non-production). Non-production spend (dev, staging, preview environments) is often
50%+ of total spend and is the primary optimization target.

**Recommendation:** Cost attribution is derived from existing entities with cost
tags. The model provides the STRUCTURE for cost attribution; the actual calculation
happens in a financial analysis tool or dashboard.

---

### 6.2 Revenue Recognition — OUT OF SCOPE (but important interface)

When does revenue from a License/Subscription get recognized in your books? This is
an accounting concern (ASC 606 / IFRS 15) that your ERP handles. But the inventory
model provides the inputs:

- Subscription start/end dates → recognition period
- Engagement type (implementation = recognized on milestone completion,
  managed service = recognized monthly, perpetual license = recognized on delivery)
- Usage-based charges → recognized as usage occurs

**Recommendation:** Not in the inventory model, but the entities (Subscription,
Engagement, Usage Event) must be accessible to the finance system.

---

## VII. THE COMPLIANCE & GOVERNANCE LAYER

### 7.1 Compliance Frameworks — THIN

We have `compliance_tags` on Deployment, but compliance is a systematic concern.

**What's thin:**

**COMPLIANCE FRAMEWORK** — a named standard you're conforming to: SOC 2 Type II,
ISO 27001, GDPR, HIPAA, PCI-DSS, India's DPDP Act. Each framework defines a set
of controls that must be implemented and evidenced.

**CONTROL** — a specific requirement within a framework. "Access to production systems
must require multi-factor authentication." Controls map to technical implementations:
this control is satisfied by Ory Kratos's MFA configuration on production Deployments.

**EVIDENCE** — proof that a control is in place. Audit logs, access review reports,
configuration screenshots, penetration test results. Evidence is collected
periodically and presented during audits.

**AUDIT** — a periodic (annual, quarterly) review of your compliance posture by an
internal or external auditor. An audit examines controls and evidence across your
infrastructure and practices.

**Recommendation:** Compliance framework and control mapping is a GRC (governance,
risk, compliance) concern. The inventory model provides the EVIDENCE — the model
itself IS evidence of what exists, where it runs, who owns it, and how it's
configured. Making the model complete and accurate IS a compliance activity.

---

## VIII. THE CUSTOMER JOURNEY LAYER

### 8.1 Pre-Sales — MISSING

Everything before a customer buys.

**What's missing:**

**DEMO ENVIRONMENT** — a Workspace or Deployment specifically configured for
demonstrating the product to prospects. Demo environments need: representative data
(not customer data), a reset mechanism (restore to clean state after each demo),
and stability (nothing is more embarrassing than a demo failure).

**POC / PILOT** — a structured evaluation where a prospect tests your product with
their own data and scenarios. A POC is a short Engagement (type: poc-trial) that
produces a Deployment, runs for 2-4 weeks, and results in a go/no-go decision.
The POC deployment should be easy to tear down if they don't buy, or promote to
production if they do.

**COMPETITIVE DISPLACEMENT** — when a prospect is currently using a competitor's
product, the engagement needs to account for: data migration from the competitor,
feature parity gaps, and parallel running period. This is scope on the Implementation
Engagement that we haven't called out.

---

### 8.2 Customer Health — MISSING

Beyond support tickets, how do you know a customer is happy?

**What's missing:**

**ADOPTION METRICS** — per Customer per Capability, are they actually using what they
bought? Usage Events provide the raw data, but adoption is the derived insight:
"Samsung has 15 SmartMarket seats but only 3 users logged in this month — that's
a churn risk." Adoption should be tracked per Capability and compared to similar
customers.

**CUSTOMER HEALTH SCORE** — a composite metric combining: adoption (usage vs
entitlement), support ticket volume and severity, engagement completion rate,
contract renewal proximity, NPS score, and executive relationship strength.
This is the primary input for customer success decisions.

**EXPANSION SIGNALS** — indicators that a customer might want more: hitting quota
limits, adding users frequently, asking about capabilities they don't have. The
model provides these signals: Usage approaching Quota, Seat assignments near
capacity, support tickets mentioning unlisted Capabilities.

**Recommendation:** These are customer success metrics derived from existing entities,
not new entities themselves. But the vocabulary should exist so teams can talk about
them.

---

## IX. THE DEVELOPER EXPERIENCE LAYER

### 9.1 Internal Developer Platform — THIN

We have Templates and Workspaces, but the overall developer experience is unmodeled.

**What's thin:**

**GOLDEN PATH** — the recommended, supported way to do something. "To create a new
Java microservice, use the Java Service Template, which gives you hexagonal arch,
OTel instrumentation, a Justfile, and a CI pipeline." Golden paths are curated by
the platform team and reduce cognitive load on stream-aligned teams. They're
implemented via Templates, but the concept is broader — it includes documentation,
examples, and support.

**DEVELOPER PORTAL** — the single entry point for developers to discover services,
read docs, scaffold new projects, check build status, and understand the
architecture. This is what Backstage, Port, and OpsLevel provide. The inventory
model is the DATA that the developer portal presents. The portal is the UI;
the model is the backend.

**INNER SOURCE** — the practice of sharing Components across teams. When the
SmartMarket team builds a dataset management component, can the Trafficure team
use it? Inner source requires: discoverable Components (the catalog), clear
ownership (the Team), documented APIs (the API entity), and contribution guidelines.

**Recommendation:** Golden paths are documented Templates with accompanying guides.
Developer portal is the UI layer over the inventory model. Inner source is enabled
by the catalog's completeness and the API entity's documentation.

---

## SUMMARY: What's Missing, What's Thin, What's Solid

### New Entities to Consider Adding

| Entity                       | Where it lives                                            | Priority                                                        |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| **Incident**                 | Incident management system, references inventory entities | High — this is the pressure test for the whole model            |
| **Vulnerability**            | Security tooling, linked to Component/Artifact            | High — security is non-negotiable                               |
| **SLO**                      | Property on Component/Deployment                          | High — operational maturity requires this                       |
| **Change Request**           | Change management process                                 | Medium — critical for enterprise customers                      |
| **Hardware Asset**           | Below Substrate for physical infra                        | Medium — relevant for your Proxmox cluster and customer on-prem |
| **Vendor / Vendor Contract** | Administrative                                            | Medium — you depend on many vendors                             |
| **Model (ML)**               | Sub-type of Artifact                                      | Medium — relevant for AI capabilities                           |
| **Compliance Control**       | GRC system                                                | Low now, high when you pursue SOC 2                             |

### Properties to Add to Existing Entities

| Entity     | Missing Property                                                     | Why                     |
| ---------- | -------------------------------------------------------------------- | ----------------------- |
| Component  | `branch_strategy`, `code_review_policy`, `feature_flags`             | Development process     |
| Component  | `slo` (with SLI definition and error budget)                         | Operational maturity    |
| Component  | `threat_model_url`                                                   | Security                |
| Artifact   | `sbom` (required, not optional)                                      | Security and compliance |
| Artifact   | Model-specific properties for ML artifacts                           | AI workloads            |
| Deployment | `dr_plan`, `failover_target`                                         | Disaster recovery       |
| Deployment | `last_backup_verified` on associated Data Store                      | DR confidence           |
| Data Store | `classification` (public/internal/confidential/restricted)           | Data governance         |
| Data Store | `pii_fields`, `data_owner`                                           | GDPR/DPDP compliance    |
| Host       | `hardware_asset_ref` (for physical hosts)                            | Hardware lifecycle      |
| Customer   | `health_score`, `adoption_metrics`                                   | Customer success        |
| Engagement | `competitive_displacement` flag                                      | Pre-sales context       |
| Team       | `team_type` (stream-aligned/platform/enabling/complicated-subsystem) | Team Topologies         |
| Team       | `cognitive_load` (derived: entity count owned)                       | Organizational health   |

### Vocabulary That Needs to Exist (Not Entities, Just Words)

| Term                    | Definition                                                                | Used By                              |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| **Golden Path**         | The recommended way to build/deploy something                             | Platform team → dev teams            |
| **Error Budget**        | Allowable unreliability before freezing releases                          | SRE ↔ product teams                  |
| **Blast Radius**        | What's affected if this thing fails                                       | Incident response, change management |
| **Cognitive Load**      | How much a team is responsible for                                        | Engineering management               |
| **Data Lineage**        | Trace from output back to source data                                     | Data engineering, compliance         |
| **Adoption**            | Whether customers use what they bought                                    | Customer success                     |
| **Inner Source**        | Sharing components across teams internally                                | Engineering culture                  |
| **Toil**                | Repetitive manual work that could be automated                            | SRE, platform team                   |
| **Tech Debt**           | Accumulated shortcuts that slow future development                        | Engineering management               |
| **Configuration Drift** | Divergence of actual from declared config                                 | Operations                           |
| **Model Drift**         | Degradation of ML model accuracy over time                                | Data science                         |
| **Feature Parity**      | Whether your product matches competitor capabilities                      | Product, pre-sales                   |
| **Hypercare**           | Intensive support period after go-live                                    | Engagement management                |
| **Dogfooding**          | Using your own product internally                                         | Product development                  |
| **Canary**              | Deploying to a small subset before full rollout                           | Deployment strategy                  |
| **Paved Road**          | Synonym for Golden Path at Netflix                                        | Platform team                        |
| **Strangler Fig**       | Incrementally replacing legacy with new, routing traffic gradually        | Migration strategy                   |
| **Circuit Breaker**     | Pattern to prevent cascading failures by failing fast                     | Architecture                         |
| **Bulkhead**            | Pattern to isolate failures to a subset of resources                      | Architecture                         |
| **Sidecar**             | An auxiliary workload alongside the main workload                         | Deployment architecture              |
| **Cold Start**          | Latency spike when a serverless function or container starts from scratch | Operations                           |
| **Noisy Neighbor**      | One tenant consuming resources that affect other tenants                  | Multi-tenancy                        |
| **Runbook**             | Step-by-step operational procedures                                       | SRE, on-call                         |
| **Postmortem**          | Blameless analysis after an incident                                      | Engineering culture                  |
| **War Room**            | Dedicated space/channel for incident response                             | Incident management                  |
| **Bake Time**           | How long to wait after deployment before considering it stable            | Release management                   |
