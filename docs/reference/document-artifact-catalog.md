# The Document & Artifact Catalog

## Every document a software company produces, who creates it, and what it references

---

## The Document Lifecycle

Documents in a software company follow the same flow as the product itself:

```
THINK          →  BUILD           →  SHIP            →  RUN             →  SELL & SUPPORT
(Strategy &       (Design &         (Release &         (Operate &         (Commercial &
 Planning)         Engineering)       Deploy)            Observe)           Customer-facing)
```

Each phase produces specific document types. Each document references specific entities
from our infrastructure and commercial model. This catalog maps the entire landscape.

---

## Phase 1: THINK — Strategy & Planning Documents

These documents answer: *What should we build and why?*

### MRD — Market Requirements Document

| Property | Value |
|---|---|
| **Full name** | Market Requirements Document |
| **Created by** | Product Marketing, Product Management |
| **Consumed by** | Executives, Product Management, Sales |
| **Purpose** | Justifies WHY a product or capability should exist based on market analysis |
| **Contains** | Market size (TAM/SAM/SOM), competitive landscape, customer personas, market trends, product-market fit analysis |
| **References** | Product (which product this is for), Customer segments |
| **Lifecycle** | Created once at product inception, updated annually |
| **Format** | Narrative document, often with charts and data |

### BRD — Business Requirements Document

| Property | Value |
|---|---|
| **Full name** | Business Requirements Document |
| **Created by** | Business Analysts, Product Management, sometimes by the customer for custom engagements |
| **Consumed by** | Executives, Project Managers, Product Management |
| **Purpose** | Defines the business objectives, success criteria, and constraints for a project or capability |
| **Contains** | Business problem statement, stakeholders, success KPIs, scope boundaries, assumptions, constraints, risks, budget |
| **References** | Product, Capability (proposed), Engagement (if customer-driven), Customer |
| **Lifecycle** | Created at project/engagement inception, baselined before work begins |
| **Format** | Structured document with sections for each concern |

### PRD — Product Requirements Document

| Property | Value |
|---|---|
| **Full name** | Product Requirements Document |
| **Created by** | Product Manager |
| **Consumed by** | Engineering, Design, QA, Product Marketing |
| **Purpose** | Defines WHAT to build from the user's perspective — features, user stories, acceptance criteria, success metrics |
| **Contains** | Problem statement, user stories, functional requirements, non-functional requirements (performance, security, scalability), UX wireframes/mockups, success metrics, release criteria, assumptions, constraints, dependencies |
| **References** | Capability (being built), Component (affected), API (new or changed), System (context), Customer (if customer-driven via Engagement) |
| **Lifecycle** | Living document — evolves through the build phase, baselined at major milestones |
| **Format** | Structured doc, often in Notion/Confluence with embedded wireframes |
| **Lepton example** | Your SmartMarket PRD at smart-market-internal.vercel.app is exactly this |

### One-Pager / Pitch Document

| Property | Value |
|---|---|
| **Created by** | Product Manager or Engineering Lead |
| **Consumed by** | Leadership, for prioritization decisions |
| **Purpose** | Concise pitch for a proposed initiative — the "should we do this?" document |
| **Contains** | Problem (1 paragraph), proposed solution (1 paragraph), expected impact (metrics), effort estimate, risks, alternatives considered |
| **References** | Capability (proposed), Initiative (if internal), Customer (if customer request) |
| **Format** | 1-2 pages, deliberately brief |

### Amazon-style PR/FAQ

| Property | Value |
|---|---|
| **Created by** | Product Manager |
| **Consumed by** | Leadership, Engineering |
| **Purpose** | "Working backwards" — write the press release and FAQ as if the product already launched. Forces clarity about value proposition and customer experience. |
| **Contains** | Fictional press release (who, what, why, customer quote), FAQ section (both external customer questions and internal stakeholder questions) |
| **References** | Product, Capability |
| **Format** | Narrative document with prescribed structure |

---

## Phase 2: BUILD — Design & Engineering Documents

These documents answer: *How should we build it?*

### RFC — Request for Comments

| Property | Value |
|---|---|
| **Full name** | Request for Comments (also called Design Doc, Tech Spec, Engineering Design Document) |
| **Created by** | Engineer (usually senior/staff level) |
| **Consumed by** | Engineering team, architects, affected teams |
| **Purpose** | Proposes a technical solution, invites feedback before implementation |
| **Contains** | Context/background, problem statement (or reference to PRD), proposed solution, alternatives considered, trade-offs, risks, migration plan, open questions, timeline |
| **References** | Component (being modified), System (architecture context), API (new or changed), Deployment (affected), Data Store (schema changes), Managed Dependency (new integrations) |
| **Lifecycle** | Draft → In Review → Approved → Implemented → Superseded |
| **Format** | Structured doc; Uber-style or Google-style templates |
| **Lepton example** | Your workspace data architecture RFC for Trafficure |

### ADR — Architecture Decision Record

| Property | Value |
|---|---|
| **Full name** | Architecture Decision Record |
| **Created by** | Engineer who made the decision |
| **Consumed by** | Current and future engineers (institutional memory) |
| **Purpose** | Records a specific architectural decision with context and consequences — the WHY behind the HOW |
| **Contains** | Title, Date, Status (proposed/accepted/deprecated/superseded), Context (why this decision was needed), Decision (what was chosen), Consequences (trade-offs accepted) |
| **References** | Component or System it applies to |
| **Lifecycle** | Immutable once accepted. New ADRs supersede old ones (old ADRs are never edited, only superseded). |
| **Format** | Short, standardized template, stored in the code repo alongside the code |
| **Example** | "ADR-017: Use SpiceDB over Casbin for authorization. Context: We need ReBAC with performance at 10k checks/sec. Decision: SpiceDB. Consequences: Must maintain SpiceDB schema alongside app code." |

### HLD — High-Level Design Document

| Property | Value |
|---|---|
| **Full name** | High-Level Design |
| **Created by** | Architect, Senior Engineer |
| **Consumed by** | Engineering teams, product management, sometimes customers for enterprise engagements |
| **Purpose** | Architecture overview showing systems, components, data flow, and integration points at a conceptual level |
| **Contains** | System context diagram, component diagram, data flow diagram, integration points, technology choices, scalability approach, security model, deployment topology |
| **References** | System, Components, APIs, Managed Dependencies, Deployment topology, Network Entities |
| **Format** | Diagrams (C4 model, UML, or informal) with explanatory text |
| **Lepton example** | Your IAM platform HLD with 13 interactive sections |

### LLD — Low-Level Design Document

| Property | Value |
|---|---|
| **Full name** | Low-Level Design |
| **Created by** | Engineer implementing the feature |
| **Consumed by** | Engineering team, code reviewers |
| **Purpose** | Detailed technical design for a specific component — class diagrams, sequence diagrams, database schema, API contracts |
| **Contains** | Detailed class/module structure, sequence diagrams for key flows, database schema with indexes, API endpoint specifications, error handling strategy, configuration parameters |
| **References** | Component (specific), API (specific endpoints), Data Store (specific tables/schemas) |
| **Format** | Technical document with UML or informal diagrams |

### FRD — Functional Requirements Document

| Property | Value |
|---|---|
| **Full name** | Functional Requirements Document |
| **Created by** | Business Analyst or Product Manager, sometimes jointly with Engineering |
| **Consumed by** | Engineering, QA |
| **Purpose** | Translates user-facing requirements (from PRD) into system behaviors — what the system should DO in response to inputs |
| **Contains** | Use cases, input/output specifications, business rules, validation rules, error conditions, state transitions |
| **References** | Capability, Component, API |
| **Format** | Structured tables or use case narratives |

### SRS — Software Requirements Specification

| Property | Value |
|---|---|
| **Full name** | Software Requirements Specification (IEEE 830 standard) |
| **Created by** | Senior Engineer or Business Analyst |
| **Consumed by** | Engineering, QA, sometimes contractual (customer expects this deliverable) |
| **Purpose** | Comprehensive specification covering functional AND non-functional requirements with enough detail for implementation and testing |
| **Contains** | Functional requirements, performance requirements, security requirements, interface requirements (UI, API, hardware), design constraints, quality attributes, traceability matrix (requirement → test case) |
| **References** | Component, API, Data Store, Deployment (non-functional requirements like performance targets) |
| **Lifecycle** | Baselined before development, updated through change control |
| **When used** | Formal engagements, regulated industries, customer contracts that require it |

### API Specification

| Property | Value |
|---|---|
| **Created by** | Engineer |
| **Consumed by** | Frontend engineers, integration engineers, customer developers, API consumers |
| **Purpose** | Machine-readable definition of an API contract |
| **Contains** | Endpoints, methods, request/response schemas, authentication, error codes, rate limits, examples |
| **References** | API entity directly — this IS the API definition |
| **Format** | OpenAPI/Swagger (REST), Protocol Buffers (gRPC), GraphQL Schema, AsyncAPI (event-driven) |
| **Generated from** | Can be code-first (generated from code annotations) or spec-first (code generated from spec) |

### Database Schema / Migration

| Property | Value |
|---|---|
| **Created by** | Engineer |
| **Consumed by** | Engineering, DBA, ops |
| **Purpose** | Defines or modifies the structure of a Data Store |
| **Contains** | Table definitions, indexes, constraints, migrations (up and down), seed data |
| **References** | Data Store, Component (which component owns this schema) |
| **Format** | SQL migration files (golang-migrate, Flyway, Alembic), or ORM definitions |

---

## Phase 3: SHIP — Release & Deployment Documents and Artifacts

These documents/artifacts answer: *What exactly are we shipping and how?*

### SBOM — Software Bill of Materials

| Property | Value |
|---|---|
| **Full name** | Software Bill of Materials |
| **Created by** | CI/CD pipeline (automated) |
| **Consumed by** | Security team, compliance, customers (especially government/enterprise) |
| **Purpose** | Complete inventory of every component (library, framework, tool) included in an Artifact — the "ingredient list" of your software |
| **Contains** | Package name, version, license (MIT, Apache 2.0, GPL, proprietary), source URL, known vulnerabilities (CVE IDs), dependency tree (direct vs transitive) |
| **References** | Artifact (attached to each built artifact), Component (what was built) |
| **Format** | SPDX or CycloneDX (industry standards, machine-readable JSON/XML) |
| **Generated by** | Syft, Trivy, Grype, or language-specific tools (npm audit, pip-audit, govulncheck) |
| **Why critical** | US Executive Order 14028 requires SBOMs for software sold to government. Enterprise customers increasingly demand them. A CVE in a transitive dependency 4 levels deep is still YOUR vulnerability. |

### Dependency BOM / License BOM

| Property | Value |
|---|---|
| **Full name** | Dependency Bill of Materials / License Compliance Report |
| **Created by** | CI/CD pipeline (automated) + legal review |
| **Consumed by** | Legal, compliance, open source program office |
| **Purpose** | Identifies all open-source and third-party licenses in your software and flags incompatibilities |
| **Contains** | Every dependency with its license type, license compatibility analysis (e.g., GPL in a proprietary product = problem), attribution requirements (some licenses require you to include copyright notices), commercial license obligations |
| **References** | Artifact, Component |
| **Format** | Report generated by FOSSA, Snyk, WhiteSource/Mend, or license-checker tools |
| **Why critical** | Using a GPL-licensed library in your proprietary product without compliance can have legal consequences. Using a library with a SSPL or BSL license has different implications than MIT/Apache. |

### Infrastructure BOM

| Property | Value |
|---|---|
| **Full name** | Infrastructure Bill of Materials |
| **Created by** | Platform/infra team, partially automated from IaC |
| **Consumed by** | Ops, security, compliance, customer (for on-prem) |
| **Purpose** | Complete inventory of all infrastructure components in a deployment — the "what's running" document |
| **Contains** | Every Host (with OS version), every Runtime (with version), every Network Entity (load balancers, DNS, certs with expiry), every Managed Dependency (cloud services), every Workload (container images with versions), port mappings and firewall rules |
| **References** | Deployment, Host, Runtime, Network Entity, Managed Dependency, Substrate |
| **Format** | Generated from your inventory model (this is literally a query of your model), or from IaC (Terraform state, Helm values, Docker Compose files) |
| **Includes** | Port allow-list (which ports are open, to where, for what purpose), TLS certificate inventory (expiry dates!), DNS record inventory |

### Port Allow-List / Firewall Rules Document

| Property | Value |
|---|---|
| **Created by** | Network/security team |
| **Consumed by** | Customer IT team (for on-prem), security auditors, ops |
| **Purpose** | Defines every network port that must be open, in which direction, between which hosts, for what purpose |
| **Contains** | Source, destination, port, protocol, direction (ingress/egress), purpose, justification |
| **References** | Network Entity, Host, Deployment |
| **Format** | Table/spreadsheet, or firewall-as-code (Terraform security group rules, Calico network policies) |
| **Why critical** | On-prem customers need this to configure their firewalls before your deployment can work. Missing a port = deployment failure. |

### Architecture Diagram Set

Not one diagram — a set of diagrams at different levels of abstraction. The C4 model
(by Simon Brown) provides the standard vocabulary:

| Diagram | Level | Shows | Audience | References |
|---|---|---|---|---|
| **System Context** | L1 | Your product as a box, surrounded by users and external systems it interacts with | Everyone including non-technical | Product, Managed Dependencies, Customer integrations |
| **Container** | L2 | The major runtime units (applications, databases, message queues) within your system and how they communicate | Technical leadership, architects | Components (of type service, website, worker), Data Stores, Network Entities (message queues, API gateways) |
| **Component** | L3 | The internal structure of a single container — modules, classes, key abstractions | Engineering team | Component internals (not in our model — below Component granularity) |
| **Code** | L4 | Class diagrams, sequence diagrams for specific flows | Individual engineers | Below our model's scope |
| **Deployment** | Special | How containers map onto infrastructure — which host, which runtime, which network path | Ops, SRE, customer IT (for on-prem) | Deployment, Host, Runtime, Substrate, Network Entity |
| **Dynamic** | Special | Sequence of interactions for a specific use case or flow — request flowing through services | Engineering, debugging | Components, APIs, Network Entities |

**Additional infrastructure diagrams:**

| Diagram | Shows | References |
|---|---|---|
| **Network Topology** | Subnets, VLANs, VPNs, firewall boundaries, traffic flow | Network Entity, Substrate, Host |
| **Data Flow** | How data moves through the system, crossing trust boundaries | Components, Data Stores, APIs, Network Entities |
| **Disaster Recovery** | Primary and standby deployments, failover paths, data replication | Deployment (primary and DR), Data Store (replication) |
| **Physical Rack Layout** | For on-prem: which server is in which rack position | Substrate (datacenter, rack), Hardware Asset, Host |

### Release Notes / Changelog

| Property | Value |
|---|---|
| **Created by** | Product Manager + Engineering |
| **Consumed by** | Customers, internal teams, support |
| **Purpose** | Communicates what changed in a release — new features, improvements, bug fixes, breaking changes, deprecations |
| **Contains** | Version number, date, categorized list (added/changed/fixed/deprecated/removed/security), migration notes for breaking changes, known issues |
| **References** | Release Bundle, Capabilities (new/changed), APIs (version changes), Components (affected) |
| **Format** | Markdown (Keep a Changelog format), or structured in a customer portal |

### Deployment Runbook

| Property | Value |
|---|---|
| **Created by** | Platform/SRE team |
| **Consumed by** | Ops team, customer IT team (for self-hosted) |
| **Purpose** | Step-by-step procedure for deploying, updating, and rolling back the product |
| **Contains** | Pre-deployment checklist, deployment steps, verification steps, rollback steps, troubleshooting common failures |
| **References** | Deployment, Artifact, Runtime, Host, Data Store (migration steps), Secret (credential requirements) |
| **Format** | Structured step-by-step document, ideally tested regularly |

### Installation Guide (Customer-Facing)

| Property | Value |
|---|---|
| **Created by** | Technical writing, platform team |
| **Consumed by** | Customer IT team (for self-hosted and on-prem) |
| **Purpose** | Customer-facing instructions for installing or updating the product on their infrastructure |
| **Contains** | Hardware/software prerequisites (minimum specs, supported OS, required ports), installation steps, initial configuration, verification, first-run setup |
| **References** | Offering (determines which installation guide), Artifact (what to download), Host (requirements), Network Entity (port allow-list) |
| **Format** | PDF or docs site, versioned per release |

---

## Phase 4: RUN — Operational Documents

These documents answer: *How do we keep it running and fix it when it breaks?*

### Operational Runbook

| Property | Value |
|---|---|
| **Created by** | SRE / ops team |
| **Consumed by** | On-call engineers |
| **Purpose** | Step-by-step procedures for handling operational scenarios — distinct from deployment runbook |
| **Contains** | Alert response procedures (for each alert, what to check and what to do), common troubleshooting trees, scaling procedures, backup/restore procedures, secret rotation procedures, certificate renewal procedures |
| **References** | Deployment, Component, Alert definitions, Data Store, Secret, Network Entity |
| **Format** | Living document, linked from alert descriptions so on-call can find it immediately |

### Incident Report / Postmortem

| Property | Value |
|---|---|
| **Full name** | Post-Incident Review (PIR) or Blameless Postmortem |
| **Created by** | Incident commander / SRE |
| **Consumed by** | Engineering leadership, affected teams, sometimes customer (summary version) |
| **Purpose** | What happened, why, what was the impact, what will we do to prevent recurrence |
| **Contains** | Timeline (what happened when), root cause analysis (5 whys or fishbone), impact (which customers, which SLAs affected), contributing factors, remediation actions (with owners and deadlines), lessons learned |
| **References** | Incident, Deployment (affected), Component (root cause), Customer (impacted), Engagement (SLA implications), Change Log (what changed before the incident) |
| **Format** | Standardized template, stored in an incident knowledge base |

### SLO Document

| Property | Value |
|---|---|
| **Created by** | SRE + product team jointly |
| **Consumed by** | Engineering, product management, sometimes customer (as SLA backing) |
| **Purpose** | Defines reliability targets and error budgets for a service |
| **Contains** | SLIs (what we measure), SLOs (target values), error budget calculation, error budget policy (what happens when budget is exhausted — e.g., freeze feature releases), review cadence |
| **References** | Component, Deployment, Engagement (SLAs that the SLO supports) |
| **Format** | Short structured document, reviewed quarterly |

### Capacity Plan

| Property | Value |
|---|---|
| **Created by** | SRE / platform team |
| **Consumed by** | Engineering leadership, finance (for budget) |
| **Purpose** | Projects future infrastructure needs based on growth trends |
| **Contains** | Current resource utilization, growth projections (customer count, usage volume), scaling triggers (at what load do we need more capacity?), cost projections, procurement lead times for hardware |
| **References** | Host (current capacity), Substrate (expansion options), Customer (growth), Usage (trends), Managed Dependency (cloud service limits) |
| **Format** | Periodic report (quarterly), with dashboards for ongoing monitoring |

### DR Plan — Disaster Recovery Plan

| Property | Value |
|---|---|
| **Created by** | SRE / platform team |
| **Consumed by** | Ops, engineering leadership, compliance auditors |
| **Purpose** | Documents how to recover from a catastrophic failure |
| **Contains** | Recovery scenarios (single host failure, full datacenter loss, cloud region outage, data corruption), recovery procedures per scenario, RPO/RTO per Data Store, failover topology, communication plan (who to notify, in what order), DR test schedule and results |
| **References** | Deployment (primary and DR), Data Store (RPO/RTO), Host, Substrate, Customer (impact and priority order for recovery) |
| **Format** | Structured document, tested at least annually via DR drills |

---

## Phase 5: SELL & SUPPORT — Commercial & Customer Documents

These documents answer: *How do we sell, deliver, and support it?*

### SOW — Statement of Work

| Property | Value |
|---|---|
| **Full name** | Statement of Work |
| **Created by** | Sales / delivery management |
| **Consumed by** | Customer (for approval), delivery team, finance |
| **Purpose** | Contractual definition of what will be delivered in an Engagement |
| **Contains** | Scope of work, deliverables, timeline, milestones, acceptance criteria, team composition, pricing, payment schedule, assumptions, exclusions, change management process |
| **References** | Engagement (this IS the engagement's scope document), Customer, Offering, Capabilities (in scope) |
| **Format** | Formal document, signed by both parties |

### SLA — Service Level Agreement

| Property | Value |
|---|---|
| **Full name** | Service Level Agreement |
| **Created by** | Legal / delivery management |
| **Consumed by** | Customer, ops team, customer success |
| **Purpose** | Contractual commitment on service reliability and support responsiveness |
| **Contains** | Uptime commitment (99.5%, 99.9%), measurement methodology, exclusions (scheduled maintenance, force majeure), response time by severity (P1: 30min, P2: 2hr), resolution time targets, service credits for SLA misses, reporting cadence |
| **References** | Engagement (managed service or support), Deployment (what's covered), SLO (internal target backing the SLA) |
| **Format** | Legal document, attached to or part of the contract |

### Customer Architecture Document

| Property | Value |
|---|---|
| **Created by** | Solutions architect / delivery team |
| **Consumed by** | Customer IT team, delivery team |
| **Purpose** | Documents how the product is deployed in THIS customer's specific environment |
| **Contains** | Customer-specific deployment diagram, integration architecture (how it connects to customer's systems), network topology in customer environment, authentication/SSO configuration, data flow with customer systems, port allow-list for customer's firewall |
| **References** | Customer, Deployment (customer-specific), Substrate (customer-premises), Host, Network Entity (VPN, customer integrations), Managed Dependency (customer-provided systems) |
| **Format** | Tailored document, one per customer for enterprise deployments |

### Customer Onboarding Guide

| Property | Value |
|---|---|
| **Created by** | Customer success / technical writing |
| **Consumed by** | Customer admin and end users |
| **Purpose** | Getting the customer's team productive with the product |
| **Contains** | First login steps, admin setup (user invitations, seat assignment, SSO config), initial data import, guided tour of key workflows, where to get help |
| **References** | Offering (determines which guide), Capability (feature walkthrough), Seat types |
| **Format** | Interactive guide, docs site, or video series |

### Training Materials

| Property | Value |
|---|---|
| **Created by** | Training / enablement team |
| **Consumed by** | Customer end users |
| **Purpose** | Teaching customers to use the product effectively |
| **Contains** | Per-capability training modules, exercises with sample data, certification curriculum (if applicable), admin training (separate from user training) |
| **References** | Capability (one training module per major capability), Offering (training depth varies by edition) |
| **Format** | Video, interactive walkthrough, documentation, workshops |

### Support Knowledge Base

| Property | Value |
|---|---|
| **Created by** | Support team, engineering (for technical articles) |
| **Consumed by** | Customers (self-service), support engineers |
| **Purpose** | Answers to common questions, troubleshooting guides, how-to articles |
| **Contains** | FAQ, troubleshooting decision trees, known issues and workarounds, configuration guides |
| **References** | Component (per-component troubleshooting), Capability (per-feature how-to), Deployment (environment-specific issues) |
| **Format** | Searchable knowledge base (Zendesk, Intercom, docs site) |

---

## The Complete Document Flow

How documents chain together through the product lifecycle:

```
STRATEGY:
  MRD (market analysis)
    → BRD (business justification)
      → PRD (product requirements)         ←── Customer input via Engagement SOW
        ↓                                     ↓
DESIGN:                                    COMMERCIAL:
  RFC (technical solution)                   SOW (scope of work)
    → ADR (decisions made)                   SLA (service commitment)
    → HLD (architecture)                     Customer Architecture Doc
      → LLD (detailed design)
      → API Spec (interface contracts)
      → DB Schema (data design)
        ↓
BUILD & TEST:
  Source Code (the implementation)
    → SBOM (dependency inventory)
    → License BOM (license compliance)
    → Test Reports
      ↓
SHIP:
  Artifacts (container images, Helm charts, installers)
    → Release Notes / Changelog
    → Infrastructure BOM (what's deployed)
    → Port Allow-List (network requirements)
    → Deployment Runbook (how to deploy)
    → Installation Guide (customer-facing)
      ↓
RUN:
  Operational Runbook (how to operate)
  SLO Document (reliability targets)
  Capacity Plan (growth projection)
  DR Plan (disaster recovery)
  Incident Reports / Postmortems (lessons learned)
      ↓
SUPPORT:
  Customer Onboarding Guide
  Training Materials
  Support Knowledge Base
  Customer Health Reports
```

---

## The Planning Terminology Dictionary

Every term used during product evolution and planning:

### Product Discovery & Strategy

| Term | Definition | Who uses it |
|---|---|---|
| **Discovery** | Research phase to understand user needs before building. Includes interviews, prototyping, data analysis. | Product Manager |
| **Product Vision** | Long-term aspirational statement of what the product will become. Stable over years. | PM, Leadership |
| **Product Strategy** | How we'll achieve the vision. Which markets, which segments, which capabilities to invest in. Updates quarterly/annually. | PM, Leadership |
| **Roadmap** | Time-horizon view of planned work. Typically: Now (committed), Next (planned), Later (aspirational). | PM → Engineering, Sales |
| **OKR** | Objective and Key Results. Quarterly goal-setting: "Objective: Make SmartMarket indispensable for Samsung. KR1: DAU > 50. KR2: AI query volume > 1000/week." | All teams |
| **North Star Metric** | The single metric that best captures the value your product delivers. "Monthly active planning sessions" or "Network plans generated." | PM, Leadership |
| **TAM / SAM / SOM** | Total Addressable Market / Serviceable Addressable Market / Serviceable Obtainable Market. Concentric circles of market opportunity. | PM, Sales, Investors |
| **Jobs to be Done (JTBD)** | Framework for understanding user needs: "When I am [situation], I want to [motivation], so I can [expected outcome]." | PM, Design |
| **User Persona** | Fictional character representing a user type: "Rajesh, Network Planning Lead at a mid-size telecom, 15 years experience, frustrated with Excel-based planning." | PM, Design, Marketing |

### Product Development & Execution

| Term | Definition | Who uses it |
|---|---|---|
| **Epic** | A large body of work decomposed into Stories. Maps to a Capability or a significant feature within one. | PM → Engineering |
| **Story / User Story** | A single unit of user-visible functionality: "As a network planner, I want to see coverage overlap between two towers so I can optimize placement." | PM → Engineering |
| **Task** | A unit of engineering work that delivers part of a Story. "Implement coverage overlap calculation algorithm." | Engineering |
| **Spike** | A time-boxed investigation to reduce uncertainty. "Spike: Can rf-engine compute coverage overlap in under 2 seconds for 50 towers?" | Engineering |
| **Sprint** | A time-boxed iteration (1-4 weeks) in which a team delivers increment of work. | Engineering |
| **Standup / Daily Scrum** | Brief daily sync: what I did, what I'll do, what's blocking me. | Engineering |
| **Retrospective** | End-of-sprint reflection: what went well, what didn't, what to change. | Engineering |
| **Backlog** | Prioritized list of work to be done. Product backlog (all work) vs sprint backlog (this sprint's work). | PM → Engineering |
| **MVP** | Minimum Viable Product — smallest version of a Capability that delivers value and enables learning. | PM, Engineering |
| **PoC / Proof of Concept** | Quick implementation to validate technical feasibility, not production-ready. | Engineering |
| **Prototype** | Interactive mockup to validate UX, not functional. | Design |
| **Alpha** | Internal testing release. Incomplete, buggy, not for customers. | Engineering |
| **Beta** | Limited external release. Feature-complete but may have issues. Selected customers. | PM → select Customers |
| **GA** | General Availability. Production-ready, supported, available to all customers. | All |
| **Feature Flag** | Code-level toggle to enable/disable a feature without deploying new code. Engineering concern, distinct from Entitlement (commercial access). | Engineering |
| **Dogfooding** | Using your own product internally before releasing to customers. | All |

### Architecture & Technical Planning

| Term | Definition | Who uses it |
|---|---|---|
| **RFC** | Request for Comments — proposed technical solution seeking feedback. | Engineering |
| **ADR** | Architecture Decision Record — documented decision with context and consequences. | Engineering |
| **HLD / LLD** | High-Level Design / Low-Level Design — architecture at different zoom levels. | Engineering |
| **Tech Debt** | Accumulated shortcuts that slow future development. Tracked, prioritized, paid down via Initiatives. | Engineering |
| **Spike** | Time-boxed research to answer a specific technical question. | Engineering |
| **PoC** | Proof of Concept — validate feasibility of an approach. | Engineering |
| **Trade-off** | Explicit choice between competing concerns (speed vs safety, flexibility vs simplicity). Documented in ADRs. | Engineering |
| **Strangler Fig** | Pattern for incrementally replacing a legacy system by routing traffic gradually from old to new. | Engineering |
| **Migration** | Moving from one technology/architecture/vendor to another. Always an Initiative, sometimes an Engagement. | Engineering + PM |

### Release & Deployment Planning

| Term | Definition | Who uses it |
|---|---|---|
| **Release Train** | Regular cadence for shipping: "First Tuesday monthly" or "Continuous." | Engineering, PM |
| **Code Freeze** | Period before a release where no new features merge — only bug fixes. | Engineering |
| **Release Candidate (RC)** | A build believed to be ready for GA, undergoing final validation. | Engineering, QA |
| **Bake Time** | Duration after deployment before considering it stable. "Deploy on Monday, bake until Wednesday, then deploy to next batch." | SRE |
| **Canary** | Deploying to a small subset (1-5%) of traffic before full rollout. | SRE |
| **Blue-Green** | Two identical environments; deploy to inactive, swap traffic, keep old as rollback target. | SRE |
| **Rolling Update** | Updating instances one at a time (K8s default). Some old, some new simultaneously. | SRE |
| **Rollback** | Reverting to the previous version when the new one fails. | SRE |
| **Hotfix** | Emergency fix deployed outside the normal release cycle. | Engineering |
| **Patch** | Small fix (security or bug) applied to an existing release without full feature update. | Engineering |
| **LTS** | Long-Term Support version — receives security patches but no new features. For stable on-prem customers. | Engineering, PM |
| **Deprecation** | Formal notice that a Capability, API version, or Component will be removed. Includes timeline and migration path. | PM, Engineering |
| **EOL** | End of Life — no further updates of any kind. Distinct from deprecated (still receiving patches). | PM |
| **SemVer** | Semantic Versioning — MAJOR.MINOR.PATCH. Major = breaking changes. Minor = new features. Patch = bug fixes. | Engineering |

### Customer & Engagement Planning

| Term | Definition | Who uses it |
|---|---|---|
| **SOW** | Statement of Work — contractual scope for an Engagement. | Sales, Delivery |
| **SLA** | Service Level Agreement — contractual reliability promise. | Sales, SRE |
| **KT** | Knowledge Transfer — structured handover of information between teams or to/from customer. | Delivery |
| **UAT** | User Acceptance Testing — customer validates that the delivery meets requirements before go-live. | Delivery, Customer |
| **Go-Live** | The moment a deployment starts serving real users/traffic. An event, not a state. | Delivery |
| **Hypercare** | Intensive monitoring period immediately after go-live. Implementation team remains actively engaged. | Delivery, SRE |
| **Handover** | Transfer of operational responsibility from implementation team to managed service team, with criteria. | Delivery → SRE |
| **Steady State** | Normal operations after hypercare. Managed service engagement takes over. | SRE |
| **QBR** | Quarterly Business Review — structured meeting with customer to review usage, incidents, roadmap, and relationship health. | Customer Success, PM |
| **NPS** | Net Promoter Score — "How likely are you to recommend us?" Survey-based customer satisfaction metric. | Customer Success |
| **Churn** | Customer leaving or not renewing. The thing everyone is trying to prevent. | Customer Success, Sales |
| **Expansion** | Customer buying more — more seats, more capabilities, more products. The thing everyone is trying to cause. | Sales, Customer Success |
| **Upsell** | Selling a higher plan to an existing customer (Starter → Professional). | Sales |
| **Cross-sell** | Selling additional products to an existing customer (Trafficure customer buys SmartMarket). | Sales |

---

## Generating Documents from the Model

Here's the key insight: if your inventory model is complete and accurate, most of these
documents can be GENERATED rather than manually written.

| Document | Generated from | Automation level |
|---|---|---|
| **SBOM** | Artifact build process | Fully automated (CI pipeline) |
| **License BOM** | SBOM + license database | Fully automated |
| **Infrastructure BOM** | Deployment + Host + Runtime + Network Entity queries | Fully automated |
| **Port Allow-List** | Network Entity (type: firewall-rule) + Deployment port mappings | Fully automated |
| **Architecture Diagrams (L1-L2)** | System → Component → API → Managed Dependency relationships | Semi-automated (generate from model, human polishes) |
| **Deployment Diagram** | Deployment → Runtime → Host → Substrate relationships | Fully automated |
| **Network Topology Diagram** | Network Entity + Host + Substrate relationships | Semi-automated |
| **Customer Architecture Doc** | Filter all entities by Customer/Tenant + customer-specific config | Semi-automated (template + data fill) |
| **Release Notes** | Change Log entries between two Release Bundle versions | Semi-automated (aggregate changes, human writes narrative) |
| **Capacity Report** | Host utilization + growth trends from Usage data | Semi-automated |
| **SLA Compliance Report** | SLO metrics + Incident data vs Engagement SLA commitments | Fully automated |
| **Dependency Graph** | Component depends-on relationships + Capability dependency graph | Fully automated |
| **Vulnerability Report** | SBOM + CVE database scan | Fully automated |
| **Cost Attribution Report** | Deployment cost tags + Substrate costs + Managed Dependency costs | Semi-automated |

**The ones you must write by hand:**
MRD, BRD, PRD, RFC, ADR, SOW, SLA, Runbooks, Training Materials, Knowledge Base articles.
These require human judgment, domain knowledge, and communication skill. AI can assist
(drafting, reviewing, formatting) but humans own the content.
