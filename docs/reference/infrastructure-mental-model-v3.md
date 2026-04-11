# The Universal Infrastructure Mental Model — V3

## A complete vocabulary for humans and AI agents operating complex, real-world systems

---

## What Changed from V2

V2 had a solid infrastructure foundation but the software side was thin. This revision:

1. **Decomposes "Service" into a proper software catalog** using lessons from Backstage
   (Spotify), OpsLevel, Cortex, Port, and real-world developer portal implementations.
2. **Adds the Workspace entity** — the missing concept for developer environments, agent
   sandboxes, CI runners, and preview hosts that blur the line between host and workload.
3. **Adds software distribution vocabulary** from product-service hybrid companies (GitLab,
   HashiCorp, Elastic, Confluent) who ship their software the same way Lepton ships
   Trafficure: SaaS + self-hosted + on-prem + managed.
4. **Adds API as a first-class entity** — the primary discovery and integration surface
   between components.
5. **Adds Domain and System as organizational groupings** above individual components.
6. **Adds Template/Blueprint** — the scaffolding concept that enables self-service.

---

## Part I — The Complete Entity Model

### The Full Entity List (16 entities)

**Software Catalog (what we build):**

1. Domain
2. System
3. Component
4. API
5. Artifact
6. Release Bundle
7. Template

**Infrastructure (where it runs):** 8. Substrate 9. Host 10. Workspace 11. Runtime 12. Network Entity

**Operational (how it's connected and deployed):** 13. Deployment 14. Workload 15. Managed Dependency 16. Data Store 17. Secret

**Organizational (who):** 18. Team 19. Person

---

## THE SOFTWARE CATALOG

This is where V2 was weakest. Backstage taught the industry that a service catalog needs
more structure than a flat list of services. Here's the hierarchy, from broadest to most
granular.

---

### DOMAIN

**Definition:** A business area or bounded context that groups related systems. Domains
map to business capabilities, not technology boundaries.

**Developer's intuition:** "The part of the business this belongs to."

**Why it matters:** Without domains, a catalog of 200 components is an undifferentiated
wall of names. Domains give structure and help new developers navigate.

**Examples:**

- "Traffic Planning" — all systems related to Trafficure's core traffic analysis
- "Network Intelligence" — RF planning, signal propagation, network modeling
- "Market Intelligence" — SmartMarket and its supporting systems
- "Platform" — IAM, observability, developer tooling, CI/CD
- "Customer Operations" — deployment management, support tools, billing

| Property            | Description                              |
| ------------------- | ---------------------------------------- |
| `name`              | Business-meaningful name                 |
| `owner_team`        | Domain steward team                      |
| `description`       | What business capability this represents |
| `systems`           | Systems that belong to this domain       |
| `documentation_url` | Link to domain-level architecture docs   |

**Prior art:** Backstage calls this "Domain." DDD (Domain-Driven Design) calls it
"Bounded Context." Port calls it a custom Blueprint. The concept is universal.

---

### SYSTEM

**Definition:** A collection of components, APIs, and resources that cooperate to perform
a higher-level function. The system is the natural boundary for encapsulation — its
internals can evolve without consumers noticing.

**Developer's intuition:** "The product or feature area as a deployable whole."

**Why it matters:** Components are too granular for most conversations. "The Trafficure
planning system" is more useful in a planning meeting than "the planning API, the planning
worker, the planning UI, and the planning database." Systems are also the natural unit for
your release bundle — things that ship together belong to the same system.

**Examples:**

- "Trafficure Core Platform" — API, UI, worker, database, search index
- "SmartMarket" — ingestion pipeline, analysis engine, reporting UI
- "IAM System" — Ory Kratos, Ory Hydra, SpiceDB, custom runtime layer
- "Observability Stack" — Grafana, Loki, Tempo, OTel collectors, ClickHouse

| Property            | Description                                   |
| ------------------- | --------------------------------------------- |
| `name`              | System name                                   |
| `domain`            | Which domain this belongs to                  |
| `owner_team`        | Team responsible for the system as a whole    |
| `components`        | Components that make up this system           |
| `public_apis`       | APIs exposed to consumers outside this system |
| `release_bundle`    | The release bundle that ships this system     |
| `description`       | What function this system performs            |
| `documentation_url` | System-level architecture doc                 |

**Backstage lesson:** Backstage explicitly recommends against having separate catalog
entries for "my-service-dev" and "my-service-prod." A System is one logical thing.
Different deployed versions in different environments are tracked as Deployments, not as
separate Systems. This is critical — it prevents catalog bloat.

---

### COMPONENT

**Definition:** A unit of software. What a developer considers "one thing I can build, test,
and deploy." Usually maps 1:1 to a source repository (or a directory in a monorepo) and
to a deployable artifact.

**Developer's intuition:** "The thing I `git clone` and work on."

**This replaces V2's "Service."** The word "service" is overloaded in the industry
(microservice, Windows Service, managed service, SaaS service, "service" as in customer
service). "Component" is more precise for the software catalog entity.

**Component types** (non-exhaustive, extensible):

| Type             | Description                                                                 | Examples                                            |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| `service`        | A long-running backend process serving requests                             | Trafficure API, SmartMarket ingestion worker        |
| `website`        | A user-facing frontend application                                          | Trafficure Web UI, admin dashboard                  |
| `library`        | A shared package consumed by other components at build time                 | Trafficure SDK, shared auth middleware              |
| `worker`         | A background process consuming from a queue                                 | Notification worker, data sync processor            |
| `job`            | A scheduled or triggered batch process                                      | Nightly data export, migration script, ETL pipeline |
| `cli`            | A command-line tool                                                         | Trafficure CLI, deployment helper scripts           |
| `agent`          | Software deployed on customer or remote premises to collect/push data       | Trafficure data agent, monitoring agent             |
| `bot`            | An automated process interacting with external services                     | Slack bot, CI/CD bot                                |
| `infrastructure` | A component that IS infrastructure (self-hosted Postgres, Traefik, Grafana) | Ory Kratos, SpiceDB, Grafana                        |
| `ml-model`       | A machine learning model or pipeline                                        | Network demand predictor, signal propagation model  |
| `documentation`  | A documentation site or TechDocs site                                       | API docs, user guides, architecture docs            |
| `plugin`         | An extension or module for a larger system                                  | Grafana dashboards, Backstage plugins               |

**Key properties:**

| Property                 | Description                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `name`                   | Canonical name: `trafficure-api`, `smartmarket-ui`                                                           |
| `type`                   | From the type table above                                                                                    |
| `system`                 | Which system this belongs to                                                                                 |
| `owner_team`             | Team that builds and maintains this                                                                          |
| `lifecycle`              | `experimental`, `production`, `deprecated` (this is the component lifecycle, not the deployment lifecycle)   |
| `source_repo`            | Git repository URL                                                                                           |
| `source_path`            | Path within the repo (for monorepos)                                                                         |
| `language`               | Primary language: `java`, `python`, `go`, `typescript`, `rust`                                               |
| `framework`              | Primary framework: `spring-boot`, `fastapi`, `next.js`, `gin`                                                |
| `tier`                   | Criticality: `tier-1` (revenue-critical), `tier-2` (important), `tier-3` (internal), `tier-4` (experimental) |
| `provides_apis`          | APIs this component exposes                                                                                  |
| `consumes_apis`          | APIs this component depends on                                                                               |
| `depends_on`             | Other components or resources this needs (typed dependencies — see below)                                    |
| `runtime_requirements`   | `linux-only`, `jvm-17+`, `gpu`, `windows-dotnet-8`, `docker-in-docker`                                       |
| `statefulness`           | `stateless`, `stateful-ephemeral`, `stateful-persistent`                                                     |
| `communication_patterns` | `sync-rest`, `sync-grpc`, `async-nats`, `event-kafka`, `file-sftp`, `database-shared`                        |
| `runbook_url`            | Operational documentation                                                                                    |
| `architecture_doc_url`   | Design documentation                                                                                         |

**Typed dependencies** (richer than V2):

```
dependency:
  target: component:postgres-db          # what it depends on
  strength: hard                         # hard | soft | optional | build-only
  pattern: sync                          # sync | async | event | file | database-shared
  direction: calls                       # calls | called-by | reads | writes | publishes | subscribes
  description: "Primary data store"
```

**Software lifecycle** (on the component, not the deployment):

| State          | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `experimental` | Under active development, not yet production-ready, API unstable |
| `production`   | Stable, maintained, serving users                                |
| `deprecated`   | Scheduled for removal, successor exists, no new features         |

This is distinct from deployment lifecycle. A component can be `production` lifecycle
while having deployments in `preview`, `staging`, and `production` environments
simultaneously.

---

### API

**Definition:** A contract boundary between components. The primary way to discover and
integrate with existing functionality. APIs are first-class citizens — not just a property
on a component.

**Developer's intuition:** "The interface I call or implement against."

**Why it's a separate entity (lesson from Backstage):** A component might provide multiple
APIs (a REST API and a gRPC API and a WebSocket API). Different consumers might use
different APIs from the same component. Modeling APIs separately lets you track who
consumes what, detect breaking changes, and generate documentation per API.

**API types:**

| Type            | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `openapi`       | REST API described by OpenAPI/Swagger spec                                     |
| `grpc`          | gRPC API described by .proto files                                             |
| `graphql`       | GraphQL API described by schema                                                |
| `async-api`     | Async/event-driven API (Kafka topics, NATS subjects, WebSocket channels)       |
| `webhook`       | Outgoing webhook callbacks                                                     |
| `file-exchange` | File-based interface (SFTP, S3 drops, NFS)                                     |
| `database-view` | Shared database table or view used as an interface (an anti-pattern, but real) |

| Property              | Description                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `name`                | `trafficure-planning-api`, `smartmarket-events`                                                  |
| `type`                | From the type table above                                                                        |
| `system`              | Which system this belongs to                                                                     |
| `owner_team`          | Who maintains the contract                                                                       |
| `provided_by`         | Which component(s) implement this API                                                            |
| `consumed_by`         | Which component(s) depend on this API                                                            |
| `definition_url`      | Link to OpenAPI spec, .proto file, AsyncAPI spec, etc.                                           |
| `lifecycle`           | `experimental`, `production`, `deprecated`                                                       |
| `visibility`          | `public` (external consumers), `internal` (within the system), `private` (implementation detail) |
| `versioning_strategy` | `url-path` (/v1/), `header`, `query-param`, `semantic`, `none`                                   |
| `current_version`     | Latest API version                                                                               |

**Why this matters for Trafficure:** When Samsung India integrates with Trafficure's API,
they're consuming a specific API version. When you deprecate an API version, you need to
know exactly which customers and which of their deployments are still on the old version.
Without API as a first-class entity, this is a manual spreadsheet exercise.

---

### ARTIFACT

_(Unchanged from V2, repeated for completeness)_

**Definition:** The built, versioned, distributable package. What CI produces. The bridge
between source code and running deployment.

**Developer's intuition:** "The thing in the registry."

| Property          | Description                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `component`       | Which component this packages                                                                                                        |
| `version`         | Semver, git tag, or commit SHA                                                                                                       |
| `type`            | `container-image`, `helm-chart`, `deb`, `rpm`, `msi`, `binary`, `firmware`, `bundle`, `tarball`, `npm-package`, `pip-package`, `jar` |
| `registry`        | Docker Hub, ECR, Nexus, GitHub Releases, S3, npm registry, "hand-delivered"                                                          |
| `build_source`    | Git repo + commit SHA + CI pipeline run ID                                                                                           |
| `signature`       | Checksum, GPG signature, cosign signature                                                                                            |
| `os_arch_targets` | `linux/amd64`, `windows/amd64`, `linux/arm64`                                                                                        |
| `sbom`            | Software Bill of Materials (for security/compliance scanning)                                                                        |
| `created_at`      | Build timestamp                                                                                                                      |

---

### RELEASE BUNDLE

_(Enhanced from V2)_

**Definition:** A group of versioned artifacts that ship together as a coordinated release.
Mapped to a System — the release bundle is how a system moves through environments.

**Developer's intuition:** "The release we're cutting."

| Property               | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `name`                 | "Trafficure Platform v2.4.0"                                                       |
| `system`               | Which system this release represents                                               |
| `version`              | Bundle version                                                                     |
| `artifacts`            | List of component artifacts with their compatible versions                         |
| `compatibility_matrix` | Which combinations of artifact versions are known-good                             |
| `promotion_path`       | `preview → staging → production`                                                   |
| `changelog_url`        | Link to release notes                                                              |
| `rollback_unit`        | `atomic` (all or nothing) or `independent` (components can roll back individually) |

**Distribution context** (new — from studying GitLab, HashiCorp, Elastic):

| Property                | Description                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editions`              | Which product editions include this release: `community`, `professional`, `enterprise`                                                                         |
| `distribution_channels` | How customers can get this: `saas`, `self-hosted-docker`, `self-hosted-k8s`, `self-hosted-native`, `marketplace`, `air-gapped-bundle`, `customer-self-install` |
| `entitlements`          | Feature flags or license keys required per edition                                                                                                             |

This matters because Trafficure as a product likely has (or will have) different
feature tiers for different customers. The release bundle is where edition and
entitlement metadata lives.

---

### TEMPLATE

**Definition:** A scaffolding pattern for creating new components, systems, or
deployments. Templates encode organizational standards and best practices into
reproducible starting points.

**Developer's intuition:** "The thing I use to bootstrap a new service."

**Why it's a first-class entity:** Without templates, every new component starts from
scratch (or by copying an existing one and ripping out specifics). Templates are how you
enforce your hexagonal architecture pattern, your Justfile-based task abstraction,
your OTel instrumentation standards.

**Examples:**

- "Java Spring Boot Microservice" — creates a new Java service with hexagonal arch, OTel, health checks, Justfile
- "Python FastAPI Service" — same patterns in Python
- "React Frontend App" — Vite, Tailwind, module federation, Storybook
- "Customer On-Prem Deployment" — Compose file, install guide, monitoring agent config
- "Preview Environment" — Compose template for PR preview deployments

| Property      | Description                                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| `name`        | Template name                                                                          |
| `type`        | `component-template`, `deployment-template`, `workspace-template`, `pipeline-template` |
| `owner_team`  | Platform team that maintains this                                                      |
| `source_repo` | Where the template lives                                                               |
| `parameters`  | What the user fills in when instantiating                                              |
| `produces`    | What entity types this creates (component + repo + CI pipeline + deployment)           |
| `version`     | Template version                                                                       |

**Backstage connection:** Backstage has "Software Templates" (scaffolding) and "TechDocs"
(documentation as code). Both are template-adjacent concepts that encode institutional
knowledge into self-service tools.

---

## THE INFRASTRUCTURE LAYER

Largely carried forward from V2, with one critical addition: **Workspace**.

---

### SUBSTRATE

_(Unchanged from V2)_

The physical or account-level resource you pay for. Substrates nest hierarchically.

```
Cloud Provider (AWS)
  └── Account (lepton-production)
        └── Region (ap-south-1)
              └── VPC (trafficure-prod-vpc)
                    └── Subnet (app-tier-subnet)

On-Prem
  └── Datacenter (Lepton Office)
        └── Rack (rack-01)
              └── Hypervisor (proxmox-node-01)
```

Key properties: type, parent, provider, owner, location, access_mechanism,
network_topology, licensing, cost_center, lifecycle_state.

---

### HOST

_(Unchanged from V2)_

An addressable machine with an OS. Has an IP. You can SSH/RDP into it.

Key properties: substrate, pool, hostname, os, arch, role, capabilities,
resources_allocated, provisioned_by, iac_source, lifecycle_state, owner_team, cost_tag.

**Pool** — optional grouping of fungible hosts (K8s nodes, build agents, dev VMs).

---

### WORKSPACE (New Entity)

**Definition:** An ephemeral or semi-persistent, purpose-built compute environment that
behaves like a host (has an OS, you can get a shell) but is provisioned on-demand from a
template and is managed as a higher-level abstraction than a raw VM.

**Developer's intuition:** "My dev box / the agent's sandbox / the preview instance / the
CI runner."

**Why this is a distinct entity from Host:** A workspace is created from a template,
scoped to a purpose and often a person or task, and has a defined lifespan. A host is
long-lived infrastructure. The operational model is fundamentally different: you
troubleshoot a host; you destroy and recreate a workspace.

Workspaces are the fast-growing category that Gitpod, Coder, GitHub Codespaces, and
DevPod have established. They also cover your CI/CD build agents, your agent sandboxes
for Claude Code / Cursor, and your preview environments.

**Workspace types:**

| Type                  | Description                                    | Lifespan         | Example                                                  |
| --------------------- | ---------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `developer-workspace` | Full dev environment for a human               | Hours to weeks   | Ubuntu container with DinD, VS Code, full toolchain      |
| `agent-sandbox`       | Isolated execution environment for AI agents   | Minutes to hours | Claude Code sandbox with repo access and Docker          |
| `preview-environment` | Running instance of the app for PR review      | Hours to days    | Compose stack spun up per PR, auto-destroyed on merge    |
| `ci-runner`           | Ephemeral build/test execution environment     | Minutes          | GitHub Actions runner, GitLab runner, self-hosted runner |
| `test-environment`    | Isolated environment for integration/E2E tests | Minutes to hours | Full stack spun up for test suite, torn down after       |
| `playground`          | Sandbox for experimentation, demos, training   | Hours to days    | Demo instance for customer presentation                  |

**Key properties:**

| Property            | Description                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `type`              | From the type table above                                                                                                    |
| `template`          | Which workspace template this was created from                                                                               |
| `runtime_substrate` | What it runs on: `k8s-pod`, `lxc-container`, `docker-container`, `vm`, `cloud-instance`                                      |
| `host_behavior`     | `full-host` (has systemd, can run Docker, acts like a machine) or `container` (single-process-ish)                           |
| `docker_in_docker`  | Whether this workspace can run containers itself                                                                             |
| `purpose_ref`       | What triggered it: a PR number, a branch name, a person, an agent task ID                                                    |
| `owner`             | Person or automation that created it                                                                                         |
| `lifespan`          | `ephemeral` (auto-destroyed), `semi-persistent` (survives restarts, destroyed on schedule), `persistent` (long-lived dev VM) |
| `ttl`               | Time to live: "48 hours after last activity", "destroyed on PR merge", "manual"                                              |
| `resources`         | CPU, RAM, disk, GPU allocated                                                                                                |
| `network_access`    | What can this workspace reach: `internet`, `internal-only`, `customer-vpn`, `air-gapped`                                     |
| `tools_installed`   | Docker, Docker Compose, kubectl, node, python, java, claude-code, cursor                                                     |
| `source_repo`       | For PR previews and dev workspaces: which repo/branch                                                                        |
| `created_at`        | When provisioned                                                                                                             |
| `last_active_at`    | For TTL calculation                                                                                                          |
| `lifecycle_state`   | `provisioning`, `active`, `suspended`, `destroying`, `destroyed`                                                             |

**How workspaces are implemented in practice:**

```
On Kubernetes:
  Workspace = a Pod (or StatefulSet) with a full Ubuntu image, DinD sidecar,
  mounted volumes for persistence, ingress for web IDE access.
  Managed by: Coder, Gitpod, DevPod, or a custom operator.

On Proxmox (LXC):
  Workspace = an LXC container with a full Ubuntu userspace, nested container
  support, bind mounts for shared storage.
  Managed by: Proxmox API + custom scripts.

On Docker Compose:
  Workspace = a docker-compose.yml that brings up the full app stack plus a
  "workspace" container the developer shells into.
  Managed by: CI/CD pipeline, custom tooling.

On Cloud VMs:
  Workspace = an EC2/GCE instance created from a golden AMI/image.
  Managed by: Terraform + auto-shutdown scripts.
```

**The key insight:** Regardless of implementation, developers and agents think of a
workspace as "a machine I can use." The vocabulary abstracts over whether it's a k8s pod,
an LXC container, a VM, or a Docker-in-Docker container. It's a Workspace.

**Common confusion this resolves:**

- "Dev environment" — is it the development _environment_ (lifecycle stage) or the
  developer's _workspace_ (compute environment)? Now you say: "a developer-workspace in
  the development environment."
- "Container" used for a workspace — it's a workspace that happens to be implemented as a
  container. The developer doesn't care about the implementation.
- "CI runner" — it's a workspace of type `ci-runner`.
- "Preview deployment" — it's a deployment running on a workspace of type
  `preview-environment`.

---

### RUNTIME

_(Unchanged from V2)_

The workload execution environment on a host or workspace. Runtimes nest.

```
Host → docker-engine → docker-compose-project → individual containers
Host → containerd → kubernetes-cluster → k8s-namespace → pods
Host → systemd → native processes
Host → windows-services → .NET services
Workspace → docker-engine → compose project (for preview envs)
```

---

### NETWORK ENTITY

_(Unchanged from V2)_

Connective tissue: load balancers, DNS records, VPN tunnels, TLS certificates, firewall
rules, VLANs, VXLAN zones, API gateway routes, message topics, service mesh configs.

---

## OPERATIONAL ENTITIES

---

### DEPLOYMENT

_(Enhanced from V2 with software catalog linkage)_

A specific version of a **component** (via an **artifact**), running on a specific
**runtime** (on a **host** or **workspace** in a **substrate**), for a specific **tenant**,
in a specific **environment**.

**Change from V2:** Deployments reference components (not the old "service" term) and
artifacts (explicit build provenance).

All V2 deployment properties carry forward. Additional software-catalog-aware properties:

| Property                  | Description                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `component`               | Which component (replaces V2's `service`)                                                                                         |
| `artifact`                | Which specific built artifact, with exact version and registry                                                                    |
| `api_versions_exposed`    | Which API versions this deployment serves (e.g., v1 and v2 simultaneously)                                                        |
| `feature_flags`           | Which feature flags are enabled in this deployment                                                                                |
| `edition`                 | Which product edition: `community`, `professional`, `enterprise`                                                                  |
| `license_key_ref`         | Reference to the license/entitlement for this deployment                                                                          |
| `customer_config_overlay` | Customer-specific configuration (Samsung India might have different planning parameters than Ather)                               |
| `integration_points`      | Customer-provided integrations this deployment connects to (their SSO, their data feeds)                                          |
| `upstream_channel`        | For self-managed deployments: which update channel: `stable`, `nightly`, `lts`, `manual`                                          |
| `update_mechanism`        | How updates reach this deployment: `auto-gitops`, `manual-helm`, `customer-initiated`, `air-gapped-bundle`, `no-updates` (frozen) |

**Deployment dimensions** (carried forward from V2):

1. **Environment:** production, staging, preview, development, sandbox, dr
2. **Tenant:** internal, shared-saas, or customer-specific
3. **Topology:** single-node, clustered, managed-cloud, on-prem-managed, on-prem-unmanaged, edge, serverless, hybrid
4. **Deployment mode:** live, canary, shadow, blue-green-active, blue-green-standby, dark-launch
5. **Lifecycle state:** provisioning, active, draining, migrating-source, migrating-target, frozen-legacy, deprecated-but-running, decommissioning, archived

---

### WORKLOAD

_(Updated to include sidecar and workspace-hosted patterns)_

A single running process or container within a deployment. Workloads can run on hosts
directly or inside workspaces.

Additional property from V2:
| Property | Description |
|---|---|
| `component` | Usually matches the deployment's component, but differs for sidecars (OTel collector sidecar inside a Trafficure API deployment belongs to the "otel-collector" component, owned by platform team) |
| `hosted_on` | `host` or `workspace` — distinguishes between workloads on stable infrastructure vs ephemeral environments |

---

### MANAGED DEPENDENCY, DATA STORE, SECRET

_(Unchanged from V2)_

---

## ORGANIZATIONAL ENTITIES

---

### TEAM

**Definition:** An organizational unit that owns and maintains components, systems,
deployments, and other entities.

**Developer's intuition:** "The team responsible."

| Property          | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `name`            | "Trafficure Core Team", "Platform Team", "SmartMarket Team"   |
| `type`            | `product-team`, `platform-team`, `sre-team`, `security-team`  |
| `parent_team`     | For organizational hierarchy                                  |
| `members`         | List of people                                                |
| `slack_channel`   | Primary communication channel                                 |
| `oncall_schedule` | PagerDuty/Opsgenie rotation                                   |
| `owns`            | Components, systems, deployments this team is responsible for |

**Backstage lesson:** Ownership is the single most important metadata in any catalog.
Every entity must have an owner. If an entity doesn't have an explicit owner, it should
inherit ownership up the graph (component inherits from system, system from domain). An
entity without an owner is an orphan — and orphans cause incidents.

---

### PERSON

**Definition:** A human or named AI agent identity that interacts with the system.

| Property        | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `name`          | Human name or agent identifier                                             |
| `type`          | `developer`, `sre`, `manager`, `ai-agent`                                  |
| `team`          | Which team(s) they belong to                                               |
| `identity_refs` | Cross-system identity mapping: GitHub handle, Slack ID, Jira user, LDAP DN |

---

## Part II — Software Distribution Vocabulary

This section captures the vocabulary that product-service hybrid companies use to describe
how their software reaches customers. Directly relevant to how Trafficure gets deployed
across SaaS, managed cloud, on-prem, and customer self-install scenarios.

### EDITION

The product tier that determines feature availability.

| Edition              | Description                                     | Trafficure analogy                                 |
| -------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `community` / `free` | Core functionality, limited support             | Free tier or trial                                 |
| `professional`       | Standard commercial features                    | Standard Trafficure license                        |
| `enterprise`         | Advanced features: SSO, audit, compliance, SLAs | Trafficure Enterprise with IAM, advanced analytics |

### DISTRIBUTION CHANNEL

How the software reaches the deployment target.

| Channel                   | Description                                                       | Who deploys          | Who manages                  |
| ------------------------- | ----------------------------------------------------------------- | -------------------- | ---------------------------- |
| `saas`                    | Multi-tenant hosted by you                                        | You                  | You                          |
| `managed-cloud`           | Single-tenant in your cloud, customer's data                      | You                  | You                          |
| `managed-customer-cloud`  | Deployed in customer's cloud account, you manage                  | You                  | You                          |
| `self-hosted-managed`     | On customer's infrastructure, you have access                     | You                  | You + Customer               |
| `self-hosted-supported`   | On customer's infrastructure, you advise                          | Customer             | Customer (with your support) |
| `self-hosted-unsupported` | OSS or community edition, no support commitment                   | Customer             | Customer                     |
| `marketplace`             | Through cloud marketplace (AWS, Azure)                            | Customer (one-click) | Shared                       |
| `air-gapped-bundle`       | Signed bundle delivered out-of-band for disconnected environments | Customer             | Customer                     |

### UPDATE CHANNEL

How deployments receive updates.

| Channel      | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `continuous` | GitOps or auto-deploy, always latest                     |
| `stable`     | Tested releases, deployed on a cadence (weekly, monthly) |
| `lts`        | Long-term support, security patches only                 |
| `manual`     | Customer pulls updates when ready                        |
| `frozen`     | No updates — either by policy or by inability            |

### ENTITLEMENT

A feature or capability unlocked by a license key or subscription tier. Entitlements are
checked at runtime (feature flags) and tracked in the deployment record.

| Property           | Description                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `feature`          | "sso-integration", "advanced-analytics", "api-access", "custom-branding"                                |
| `edition_required` | Which edition unlocks this                                                                              |
| `enforcement`      | `runtime-check` (code checks license), `deployment-config` (feature omitted from build), `honor-system` |

---

## Part III — The Relationship Map (Complete)

```
DOMAIN
  └── contains → SYSTEMS
        └── SYSTEM contains → COMPONENTS + APIs
              └── COMPONENT
                    ├── provides → APIs
                    ├── consumes → APIs
                    ├── depends on → other COMPONENTS (typed: hard/soft, sync/async)
                    ├── depends on → MANAGED DEPENDENCIES
                    ├── built as → ARTIFACTS
                    ├── scaffolded from → TEMPLATES
                    ├── owns → DATA STORES
                    ├── has lifecycle → experimental | production | deprecated
                    └── has tier → tier-1 through tier-4
              └── API
                    ├── provided by → COMPONENT(s)
                    ├── consumed by → COMPONENT(s)
                    └── has visibility → public | internal | private

ARTIFACTS
  └── grouped into → RELEASE BUNDLES
        └── associated with → EDITIONS and DISTRIBUTION CHANNELS
              └── deployed as → DEPLOYMENTS

SUBSTRATE (nests hierarchically)
  └── contains → HOSTS and WORKSPACES
        └── HOST runs → RUNTIMES
        └── WORKSPACE runs → RUNTIMES (for previews, dev envs, CI)
              └── RUNTIMES (nest: k8s-cluster → namespace)
                    └── host → DEPLOYMENTS
                          ├── of → COMPONENT (via ARTIFACT)
                          ├── for → TENANT
                          ├── in → ENVIRONMENT
                          ├── shaped as → TOPOLOGY
                          ├── mode → DEPLOYMENT MODE
                          ├── state → LIFECYCLE STATE
                          ├── connected via → NETWORK ENTITIES
                          ├── consuming → MANAGED DEPENDENCIES
                          ├── reading/writing → DATA STORES
                          ├── authenticated by → SECRETS
                          ├── configured by → base config + overlays + feature flags
                          └── containing → WORKLOADS

TEAM
  └── owns → DOMAINS, SYSTEMS, COMPONENTS, DEPLOYMENTS
  └── contains → PERSONS

TEMPLATES
  └── produce → COMPONENTS, WORKSPACES, DEPLOYMENTS, PIPELINES

CHANGE LOG
  └── records every mutation to every entity above
```

---

## Part IV — The Complete Vocabulary Card

### The Entity Types (19)

| Entity                 | One-liner                                           | Answers                                           |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------- |
| **Domain**             | A business capability area                          | "What part of the business is this?"              |
| **System**             | A cooperating group of components                   | "What product/feature does this belong to?"       |
| **Component**          | A unit of software you build and deploy             | "What's the thing I `git clone`?"                 |
| **API**                | A contract boundary between components              | "How do I integrate with this?"                   |
| **Artifact**           | A built, versioned package in a registry            | "What exact bits are running?"                    |
| **Release Bundle**     | Artifacts that ship together                        | "What's in this release?"                         |
| **Template**           | A scaffolding pattern for new things                | "How do I create a new service?"                  |
| **Substrate**          | Physical or account-level resource you pay for      | "Whose hardware / cloud bill?"                    |
| **Host**               | A machine with an OS and an IP                      | "Which machine?"                                  |
| **Workspace**          | Ephemeral purpose-built compute environment         | "My dev box / the agent sandbox / the PR preview" |
| **Runtime**            | How workloads are supervised on a host/workspace    | "How does stuff run here?"                        |
| **Network Entity**     | Connective tissue (LB, DNS, VPN, cert, VLAN, topic) | "How do things connect?"                          |
| **Deployment**         | Component version + runtime + tenant + environment  | "What's running where, for whom?"                 |
| **Workload**           | A single running process or container               | "The actual process"                              |
| **Managed Dependency** | Third-party service you use but don't deploy        | "Someone else's problem (until it isn't)"         |
| **Data Store**         | Persistent data with its own lifecycle              | "Where's the data, and what are the rules?"       |
| **Secret**             | Credential, key, or token                           | "What grants access?"                             |
| **Team**               | Organizational unit that owns things                | "Who's responsible?"                              |
| **Person**             | Human or AI agent identity                          | "Who did this?"                                   |

### The Five Deployment Dimensions

| Dimension           | Values                                                                                                                               | Answers                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Environment**     | production, staging, preview, development, sandbox, dr                                                                               | "How scared if it breaks?"       |
| **Tenant**          | internal, shared-saas, {customer-name}                                                                                               | "Who is this for?"               |
| **Topology**        | single-node, clustered, managed-cloud, on-prem-managed, on-prem-unmanaged, edge, serverless, hybrid                                  | "What shape?"                    |
| **Deployment Mode** | live, canary, shadow, blue-green-active, blue-green-standby, dark-launch                                                             | "How does traffic reach this?"   |
| **Lifecycle State** | provisioning, active, draining, migrating-source, migrating-target, frozen-legacy, deprecated-but-running, decommissioning, archived | "What's the operational status?" |

### The Banned Words List (Expanded)

| Instead of...                | Say...                                                                                        | Because...                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **server**                   | substrate, host, or component                                                                 | Three different layers                       |
| **service** (ambiguous)      | component (the software), deployment (the running instance), managed dependency (third party) | "Service" means everything                   |
| **instance**                 | host (VM/machine), deployment (of our product), managed dependency instance (RDS)             | Same word, three concepts                    |
| **environment** (as a place) | host, workspace, or "all {env} deployments"                                                   | Environment = lifecycle stage, not a machine |
| **container** (as a service) | workload (runtime-agnostic) or component (the software)                                       | Not everything runs in containers            |
| **cluster** (naked)          | substrate cluster (Proxmox), runtime cluster (K8s), component replicas                        | Three different things                       |
| **stack**                    | system (group of components), runtime (tech on a host), IaC template                          | "Stack" means nothing specific               |
| **infra**                    | substrate, host, runtime, network entity, or managed dependency                               | Which layer?                                 |
| **platform**                 | product name (Trafficure), runtime (K8s), cloud provider (AWS)                                | Three meanings                               |
| **deploy** (noun)            | deployment (entity), pipeline (CI/CD), or release (the act)                                   | Three concepts                               |
| **dev environment**          | workspace (the compute) or development environment (the lifecycle stage)                      | Two very different things                    |
| **box**                      | host (fine as informal synonym)                                                               | Acceptable                                   |
| **node**                     | host (if K8s/cluster member)                                                                  | Acceptable when context is clear             |
| **app**                      | component (the software) or system (the product)                                              | Vague                                        |
| **config**                   | config source, config overlay, feature flag, secret, or environment variable — be specific    | "Config" hides what kind                     |

### The Decision Tree

```
Someone mentions a thing in your infrastructure. What entity is it?

WHAT PART OF THE BUSINESS?
  → DOMAIN (traffic planning, market intelligence, platform)

WHAT PRODUCT/FEATURE AREA?
  → SYSTEM (Trafficure Core, SmartMarket, IAM)

WHAT SINGLE PIECE OF SOFTWARE?
  → COMPONENT (trafficure-api, smartmarket-worker, grafana)

WHAT INTERFACE DOES IT EXPOSE?
  → API (planning-api v2, smartmarket-events)

WHAT DID CI BUILD?
  → ARTIFACT (container image, Helm chart, .msi installer)

WHAT SHIPS TOGETHER?
  → RELEASE BUNDLE (Trafficure Platform v2.4.0)

HOW DO WE BOOTSTRAP NEW THINGS?
  → TEMPLATE (java-service-template, preview-env-template)

WHOSE HARDWARE/CLOUD BILL?
  → SUBSTRATE (Proxmox cluster, AWS account, customer's server room)

WHICH MACHINE (LONG-LIVED)?
  → HOST (VM, bare-metal server, EC2 instance)

WHICH MACHINE (EPHEMERAL, PURPOSE-BUILT)?
  → WORKSPACE (dev environment, agent sandbox, PR preview, CI runner)

HOW DO THINGS RUN ON A MACHINE?
  → RUNTIME (Docker Compose, K8s namespace, systemd, Windows Services)

HOW DO THINGS CONNECT?
  → NETWORK ENTITY (Traefik, DNS, VPN, cert, VLAN, NATS topic)

WHAT VERSION IS RUNNING WHERE FOR WHOM?
  → DEPLOYMENT (the central join table)

WHAT ACTUAL PROCESS IS RUNNING RIGHT NOW?
  → WORKLOAD (a container, a pod, a systemd unit)

SOMEONE ELSE'S SERVICE WE DEPEND ON?
  → MANAGED DEPENDENCY (RDS, S3, SendGrid, customer's SSO)

WHERE'S THE DATA?
  → DATA STORE (database contents, S3 bucket, with residency and backup rules)

WHAT GRANTS ACCESS?
  → SECRET (credential, key, token, with rotation and blast radius)

WHO'S RESPONSIBLE?
  → TEAM + PERSON
```

---

## Part V — What This Enables for AI Agents

When Claude Code, Cursor, or a future ops copilot operates on your infrastructure using
this vocabulary, it can:

**Parse ambiguous instructions:**

> "Deploy the latest to Ultratech"

→ Find the SYSTEM (Trafficure Core)
→ Find the latest RELEASE BUNDLE
→ Find the ARTIFACTS in that bundle
→ Locate the DEPLOYMENT for tenant: ultratech, environment: production
→ Check the DEPLOYMENT's update_mechanism and change_process
→ Check the maintenance_window and SLA tier
→ Execute using the deployment_mechanism specified in the deployment record

**Navigate the software catalog:**

> "What services does the planning system expose?"

→ Find SYSTEM "Trafficure Planning"
→ List its COMPONENTS
→ For each component, list its provided APIs with visibility: public
→ Return API names, types, and definition URLs

**Reason about blast radius:**

> "What happens if this database goes down?"

→ Find the DATA STORE
→ Find which DEPLOYMENTS serve it (via served_by)
→ For each deployment, find its TENANT and SLA tier
→ Follow the dependency graph: which COMPONENTS hard-depend on this data store?
→ Which APIS would be affected?
→ Report: "Ultratech production (24x7-critical SLA) and shared SaaS production
(24x7-standard SLA) would lose the planning API entirely. SmartMarket would
degrade but continue functioning (soft dependency)."

**Create things from templates:**

> "Spin up a preview environment for PR #1847"

→ Find TEMPLATE "preview-env-template"
→ Create a WORKSPACE of type preview-environment with TTL 48h
→ Instantiate DEPLOYMENTS on that workspace for the relevant components
→ Configure NETWORK ENTITIES (DNS record, Traefik route) for the preview URL
→ Report the preview URL to the PR

**Enforce safety constraints:**

- LIFECYCLE STATE frozen-legacy → never auto-update
- CHANGE PROCESS customer-approval-required → halt and ask
- COMPLIANCE TAG air-gapped → cannot pull from public registry
- COMPONENT TIER tier-1 → require staging validation before production
- WORKSPACE TTL expired → destroy, don't ask

---

_Version 3.0 — Synthesized from Backstage (Spotify), OpsLevel, Cortex, Port, Gitpod/Ona,
Coder, GitHub Codespaces, GitLab, HashiCorp, Elastic, Confluent, and the infrastructure
patterns of Google, Amazon, Microsoft, Meta, Netflix, Uber, Apple, Stripe, Cloudflare,
Palantir, Accenture, TCS, IBM/Kyndryl, Capgemini, and Cognizant._
