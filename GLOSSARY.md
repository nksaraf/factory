# Factory Glossary

> Canonical vocabulary for every concept in the Factory platform. Keep this file updated when domain language changes.
> Last updated: 2026-03-26

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Product Plane](#product-plane)
- [Build Plane](#build-plane)
- [Agent Plane](#agent-plane)
- [Commerce Plane](#commerce-plane)
- [Fleet Plane](#fleet-plane)
- [Infrastructure Plane](#infrastructure-plane)
- [Control Plane (Per-Site)](#control-plane)
- [Service Plane (Per-Site)](#service-plane)
- [Data Plane (Per-Site)](#data-plane)
- [Observability](#observability)
- [Cross-Plane Relationships](#cross-plane-relationships)
- [Terminology Decisions](#terminology-decisions)
- [Enums Reference](#enums-reference)

---

## Architecture Overview

**Factory** — The overarching software production system that designs, builds, commercializes, deploys, and operates all products. Organized into six Factory-level planes plus three per-Site planes.

| Level | Planes | Scope |
|-------|--------|-------|
| Factory | Product, Build, Agent, Commerce, Fleet, Infrastructure | Global system of record |
| Site | Control, Service, Data | Per-deployment runtime |

---

## Product Plane

> System of record for *what* gets built, *why*, and *when* it ships.
> Schema: `factory_product`

### Module

The fundamental unit of product capability and deployment, spanning all planes. A deployable product service (or group of services) providing a cohesive function.

- **Not** "Service" (overloaded K8s term), "Project" (repo context), or "Package" (too generic)
- Has its own code (GitHub repo), versioning, and runtime
- Can be enabled/disabled per customer
- Lifecycle: `active` → `deprecated` → `retired`
- Fields: `moduleId`, `name`, `slug`, `team`, `product`, `lifecycleState`
- Relationships: 1→N ComponentSpec, 1→N ModuleVersion, 1→N WorkItem

### ComponentSpec

A single deployable process within a Module. Maps 1:1 to a K8s workload (Deployment, StatefulSet, Job, CronJob) at runtime.

- **Not** "Service" (K8s network endpoint) or "Container" (built artifact)
- Kinds: `server` | `worker` | `task` | `scheduled` | `site` | `database` | `gateway`
- Fields: `componentId`, `moduleId`, `name`, `slug`, `kind`, `ports`, `healthcheck`, `isPublic`, `stateful`, `runOrder`, `defaultReplicas`, `defaultCpu`, `defaultMemory`
- Relationship: N→1 Module

### WorkItem

Unit of trackable work (synced from external trackers or created natively).

- Kinds: `epic` | `story` | `task` | `bug`
- Status: `backlog` → `ready` → `in_progress` → `in_review` → `done`
- Priority: `critical` | `high` | `medium` | `low` | `none`
- Fields: `workItemId`, `moduleId`, `title`, `status`, `kind`, `priority`, `description`, `labels`, `parentWorkItemId`, `assignee`, `externalId`, `externalKey`, `externalUrl`
- Relationships: N→1 Module, self-referential parent hierarchy, N→1 WorkTrackerProvider

### WorkTrackerProvider

Integration with an external issue tracker.

- Kinds: `jira` | `linear`
- Status: `active` | `inactive`
- Sync status: `idle` | `syncing` | `error`
- Fields: `workTrackerProviderId`, `name`, `slug`, `kind`, `apiUrl`, `credentialsRef`, `defaultProjectKey`, `syncEnabled`, `syncIntervalMinutes`

### WorkTrackerProjectMapping

Links a Module to an external project in a WorkTrackerProvider.

- Sync direction: `pull` | `push` | `bidirectional`
- Relationships: N→1 WorkTrackerProvider, N→1 Module

### Release Plan *(doc-level concept)*

Declaration of what will ship and when. Belongs to a Milestone, scoped to one or more Modules.

- Lifecycle: `draft` → `scoped` → `finalized` → `released` → `cancelled`
- Contains N:M relationship with WorkItems (stories can be rescheduled)

### Milestone *(doc-level concept)*

Time-bound target anchoring Release Plans. May be product-scoped or company-wide.

### ADR (Architecture Decision Record) *(doc-level concept)*

Versioned document recording significant architectural decisions. Stored in GitHub as Markdown in `/docs/adr/` directories.

- Lifecycle: `proposed` → `accepted` → `superseded` | `deprecated`

---

## Build Plane

> System governing how software is constructed, tested, versioned, signed, and packaged.
> Schema: `factory_build`

### GitHostProvider

Integration with a Git hosting service.

- Host types: `github` | `gitlab` | `gitea` | `bitbucket`
- Auth modes: `pat` | `github_app` | `oauth`
- Status: `active` | `inactive` | `error`
- Sync status: `idle` | `syncing` | `error`
- Fields: `gitHostProviderId`, `name`, `slug`, `hostType`, `apiBaseUrl`, `authMode`, `credentialsEnc`

### Repo

A versioned source code repository.

- Kinds: `product-module` | `platform-module` | `library` | `vendor-module` | `client-project` | `infra` | `docs` | `tool`
- Fields: `repoId`, `name`, `slug`, `kind`, `moduleId`, `gitHostProviderId`, `gitUrl`, `defaultBranch`
- Relationships: N→1 Module, N→1 GitHostProvider

### ModuleVersion

A specific, buildable, deployable snapshot of a Module with semantic versioning.

- Fields: `moduleVersionId`, `moduleId`, `version`, `compatibilityRange`, `schemaVersion`
- Relationships: N→1 Module, 1→N ComponentArtifact, 1→N ReleaseModulePin

### Artifact

Immutable, deployable output of a build. Content-addressable (digest-based).

- **Not** "Deployment" or "Build Output"
- Kinds: `container_image` | `binary` | `archive` | `package` | `bundle`
- Fields: `artifactId`, `kind`, `imageRef`, `imageDigest`, `sizeBytes`, `builtAt`

### ComponentArtifact

Junction table mapping a ComponentSpec to its built Artifact for a specific ModuleVersion.

- Relationships: N→1 ModuleVersion, N→1 ComponentSpec, N→1 Artifact

### GithubAppInstallation

OAuth app installation connecting a GitHostProvider to GitHub.

- Fields: `installationId`, `gitHostProviderId`, `githubAppId`, `githubInstallationId`, `privateKeyEnc`, `webhookSecret`
- Relationship: N→1 GitHostProvider

### WebhookEvent

Incoming event from a Git host (push, PR open, etc.).

- Status: `pending` | `processing` | `completed` | `failed`
- Relationship: N→1 GitHostProvider

### GitRepoSync

Tracks sync state between a Repo and its external Git host representation.

- Relationships: N→1 Repo, N→1 GitHostProvider

### GitUserSync

Maps external Git user accounts to internal auth users.

- Relationship: N→1 GitHostProvider

---

## Agent Plane

> Infrastructure for designing, registering, executing, and governing AI agents.
> Schema: `factory_agent`

### Agent

Autonomous software entity — a first-class principal (like users and service accounts).

- **Not** an assistant; is an autonomous worker
- Types: `engineering` | `qa` | `product` | `security` | `ops` | `external-mcp`
- Status: `active` | `disabled`
- Fields: `agentId`, `name`, `slug`, `agentType`, `status`, `capabilities` (JSON)
- Relationship: 1→N AgentExecution

### AgentExecution

A single invocation of an Agent to perform a task.

- Status: `pending` | `running` | `succeeded` | `failed`
- Fields: `executionId`, `agentId`, `task`, `costCents`, `startedAt`, `completedAt`
- Relationship: N→1 Agent

### Agent Memory *(doc-level concept)*

Persistent knowledge accumulated across executions.

- Layers: ephemeral (within execution), task (within single task), agent (across executions), shared (cross-agent knowledge graph)
- Hybrid: vector embeddings + structured knowledge graphs

### Tool *(doc-level concept)*

External capability an Agent can invoke, registered in a Tool Registry, exposed via MCP (Model Context Protocol).

---

## Commerce Plane

> System of record for commercial governance: who gets what, through whom, at what price.
> Schema: `factory_commerce`

### CustomerAccount

The buyer entity. One account per customer across all products.

- Status: `trial` | `active` | `suspended` | `terminated`
- Fields: `customerId`, `name`, `slug`, `status`
- Relationships: 1→N Entitlement, 1→N EntitlementBundle

### Plan (CommercePlan)

A pricing tier / subscription offering.

- Fields: `planId`, `name`, `slug`, `includedModules`

### Entitlement

Authorization record granting a customer access to a specific Module.

- Status: `active` | `suspended` | `revoked`
- Fields: `entitlementId`, `customerId`, `moduleId`, `status`, `quotas` (JSON), `expiresAt`, `siteId`
- Relationships: N→1 CustomerAccount, N→1 Module

### EntitlementBundle

Signed blob delivered to a Site containing all entitlement grants for a customer.

- Fields: `bundleId`, `customerId`, `siteId`, `payload` (JSON), `signature`, `issuedAt`, `expiresAt`, `gracePeriodDays`
- Relationship: N→1 CustomerAccount

### License *(doc-level concept)*

Deployable authorization record bound to a Subscription. Scoped to one or more Sites. Contains module entitlements, seat limits, quota definitions. Produces signed EntitlementBundles.

### Subscription *(doc-level concept)*

Commercial agreement between company and customer. References a Plan, has billing cycle, produces invoices.

### Partner Account *(doc-level concept)*

Channel entity (MSP, Reseller, SI) managing customers on behalf of the company.

---

## Fleet Plane

> Deployment and lifecycle governance: manages *where* software runs.
> Schema: `factory_fleet`

### Site (FleetSite)

A running instance of a product in a specific customer environment. Self-governing at runtime.

- **Not** "Deployment" (overloaded) or "Environment" (overloaded)
- Status: `provisioning` | `active` | `suspended` | `decommissioned`
- Deployment types *(doc-level)*: `shared_saas` | `dedicated_saas` | `self_hosted_connected` | `self_hosted_airgapped`
- Fields: `siteId`, `name`, `slug`, `product`, `clusterId`, `status`, `lastCheckinAt`, `currentManifestVersion`
- Relationships: N→1 Cluster, 1→N DeploymentTarget, 1→N Route, 1→N Domain

### Release

Deployable bundle: a collection of ModuleVersions tested together and approved for deployment.

- **Not** "Deployment" — Release = what ships; Rollout = the act of shipping it
- Status: `draft` | `staging` | `production` | `superseded` | `failed`
- Fields: `releaseId`, `version`, `status`, `createdBy`
- Relationships: 1→N ReleaseModulePin, 1→N Rollout, 1→N ReleaseBundle

### ReleaseModulePin

Pins a specific ModuleVersion into a Release.

- Relationships: N→1 Release, N→1 ModuleVersion

### DeploymentTarget

Runtime environment where Workloads run.

- Kinds: `production` | `staging` | `sandbox` | `dev`
- Runtimes: `kubernetes` | `compose` | `systemd` | `windows_service` | `iis` | `process`
- Triggers: `manual` | `pr` | `release` | `agent` | `ci`
- Status: `provisioning` | `active` | `suspended` | `destroying` | `destroyed`
- Fields: `deploymentTargetId`, `name`, `slug`, `kind`, `runtime`, `hostId`, `vmId`, `siteId`, `clusterId`, `namespace`, `ttl`, `expiresAt`, `tierPolicies`, `labels`
- Relationships: N→1 Site, N→1 Cluster, N→1 Host, N→1 VM, 1→N Workload, 1→N DependencyWorkload, 1→N Rollout

### Workload

A running instance of a ComponentSpec in a DeploymentTarget — the actual deployed process.

- Status: `provisioning` | `running` | `degraded` | `stopped` | `failed` | `completed`
- Fields: `workloadId`, `deploymentTargetId`, `moduleVersionId`, `componentId`, `artifactId`, `replicas`, `envOverrides`, `resourceOverrides`, `desiredImage`, `actualImage`, `driftDetected`, `lastReconciledAt`
- Relationships: N→1 DeploymentTarget, N→1 ModuleVersion, N→1 ComponentSpec, N→1 Artifact

### DependencyWorkload

External service dependency (database, cache, etc.) deployed alongside Workloads.

- Status: `provisioning` | `running` | `failed` | `stopped`
- Relationship: N→1 DeploymentTarget

### Rollout

The act of deploying a Release to a DeploymentTarget.

- Status: `pending` | `in_progress` | `succeeded` | `failed` | `rolled_back`
- Relationships: N→1 Release, N→1 DeploymentTarget

### Sandbox

Interactive development environment (ephemeral).

- Runtime types: `container` | `vm`
- Owner types: `user` | `agent`
- Fields: `sandboxId`, `deploymentTargetId`, `name`, `slug`, `runtimeType`, `vmId`, `ownerId`, `ownerType`, `repos`, `cpu`, `memory`, `storageGb`, `sshHost`, `sshPort`, `webTerminalUrl`
- Relationships: N→1 DeploymentTarget, 1→N SandboxSnapshot

### SandboxTemplate

Reusable blueprint for creating Sandboxes.

- Fields: `sandboxTemplateId`, `name`, `slug`, `runtimeType`, `image`, `defaultCpu`, `defaultMemory`, `defaultStorageGb`, `defaultTtlMinutes`, `preInstalledTools`

### SandboxSnapshot

Point-in-time capture of a Sandbox's state for cloning/restoring.

- Status: `creating` | `ready` | `failed` | `deleted`
- Relationship: N→1 Sandbox

### SiteManifest

Versioned desired-state declaration for a Site.

- Fields: `manifestId`, `siteId`, `manifestVersion`, `manifestHash`, `releaseId`, `content`
- Relationships: N→1 Site, N→1 Release

### InstallManifest

Installation state report from a Site back to Factory.

- Roles: `site` | `factory`
- Install modes: `connected` | `offline`
- Relationship: N→1 Site

### ReleaseBundle

Packaged release artifacts for distribution (especially for air-gapped sites).

- Status: `building` | `ready` | `failed` | `expired`
- Arch: `amd64` | `arm64`
- Relationship: N→1 Release

### Route

HTTP/gRPC traffic routing configuration.

- **Not** "Alias" — Route is a clear networking term
- Kinds: `ingress` | `sandbox` | `preview` | `tunnel` | `custom_domain`
- Protocols: `http` | `grpc` | `tcp`
- TLS modes: `auto` | `custom` | `none`
- Status: `pending` | `active` | `error` | `expired`
- Relationships: N→1 Site, N→1 DeploymentTarget, N→1 Cluster

### Domain

DNS domain associated with a Site.

- Kinds: `primary` | `alias` | `custom` | `wildcard`
- Status: `pending` | `verified` | `active` | `error`
- Relationship: N→1 Site

### Tunnel

Reverse tunnel connection for exposing local services.

- Status: `connecting` | `active` | `disconnected`
- Relationship: N→1 Route

### WorkloadOverride

Audit trail for manual configuration changes to a Workload.

- Fields: `overrideId`, `workloadId`, `field`, `previousValue`, `newValue`, `reason`, `createdBy`, `revertedAt`, `revertedBy`

### Intervention

Manual administrative action on a deployment.

- Fields: `interventionId`, `deploymentTargetId`, `workloadId`, `action`, `principalId`, `reason`, `details`

### ConnectionAuditEvent

Audit log of terminal/resource access sessions.

- Fields: `eventId`, `principalId`, `deploymentTargetId`, `connectedResources`, `readonly`, `startedAt`, `endedAt`, `reason`

---

## Infrastructure Plane

> Substrate that every other plane runs on. Provides compute, storage, networking, PKI, secrets.
> Schema: `factory_infra`

### Provider

Infrastructure source (cloud account, hypervisor cluster, etc.).

- Types: `proxmox` | `hetzner` | `aws` | `gcp`
- Kinds: `internal` | `cloud` | `partner`
- Status: `active` | `inactive`
- Fields: `providerId`, `name`, `slug`, `providerType`, `url`, `credentialsRef`, `providerKind`
- Relationships: 1→N Region, 1→N Cluster, 1→N Host, 1→N VM, 1→N ProxmoxCluster

### Region

Geographic grouping within a Provider.

- Fields: `regionId`, `name`, `displayName`, `slug`, `country`, `city`, `timezone`, `providerId`
- Relationships: N→1 Provider, 1→N Datacenter

### Datacenter

Physical data center location.

- Fields: `datacenterId`, `name`, `displayName`, `slug`, `regionId`, `availabilityZone`, `address`
- Relationships: N→1 Region, 1→N Host, 1→N Subnet

### Cluster

Kubernetes cluster spanning one or more VMs.

- Status: `provisioning` | `ready` | `degraded` | `destroying`
- Fields: `clusterId`, `name`, `slug`, `providerId`, `status`, `kubeconfigRef`
- Relationships: N→1 Provider, 1→N KubeNode, 1→N Site

### Host

Physical or bare-metal machine.

- Status: `active` | `maintenance` | `offline` | `decommissioned`
- OS types: `linux` | `windows`
- Access methods: `ssh` | `winrm` | `rdp`
- Fields: `hostId`, `name`, `slug`, `hostname`, `providerId`, `datacenterId`, `ipAddress`, `ipmiAddress`, `cpuCores`, `memoryMb`, `diskGb`, `rackLocation`
- Relationships: N→1 Provider, N→1 Datacenter, 1→N VM

### VM (Virtual Machine)

Virtual machine instance on any provider.

- Status: `provisioning` | `running` | `stopped` | `destroying`
- VM types: `qemu`
- OS types: `linux` | `windows`
- Access methods: `ssh` | `winrm` | `rdp`
- Fields: `vmId`, `name`, `slug`, `providerId`, `datacenterId`, `hostId`, `clusterId`, `proxmoxClusterId`, `proxmoxVmid`, `cpu`, `memoryMb`, `diskGb`, `ipAddress`
- Relationships: N→1 Provider, N→1 Datacenter, N→1 Host, N→1 Cluster, N→1 ProxmoxCluster

### KubeNode

Individual Kubernetes node.

- Roles: `server` | `agent`
- Status: `ready` | `not_ready` | `paused` | `evacuating`
- Relationships: N→1 Cluster, N→1 VM

### ProxmoxCluster

Proxmox hypervisor cluster (manages VMs via Proxmox API).

- Sync status: `idle` | `syncing` | `error`
- Fields: `proxmoxClusterId`, `name`, `slug`, `providerId`, `apiHost`, `apiPort`, `tokenId`, `tokenSecret`, `sslFingerprint`
- Relationship: N→1 Provider

### Subnet

Network segment within a Datacenter.

- Types: `management` | `storage` | `vm` | `public` | `private` | `other`
- Fields: `subnetId`, `cidr`, `gateway`, `netmask`, `vlanId`, `vlanName`, `datacenterId`, `subnetType`, `dnsServers`, `dnsDomain`
- Relationships: N→1 Datacenter, 1→N IpAddress

### IpAddress (IPAM)

Managed IP address with allocation tracking.

- Status: `available` | `assigned` | `reserved` | `dhcp`
- Assigned to types: `vm` | `host` | `kube_node` | `cluster` | `service`
- Relationship: N→1 Subnet

---

## Control Plane

> Per-Site runtime governance: identity, access control, tenancy, policy, quotas, audit.

### Principal

Security subject — the "who" in every authorization decision.

- Types: User, Service Account, Group, AI Agent
- Authenticated and authorized as first-class identity

### Namespace

Tenancy boundary within a Site. Owns data and access; does not own identity.

- **Not** "Project" (repo checkout) or "Workspace" (UI term)
- Relationships: N→1 Site, 1→N ModuleInstance, 1→N Dataset

### Organization (Org)

Identity container. May configure SSO, own multiple Namespaces.

- Types: `personal` | `team` | `enterprise` | `vendor_namespace`

### Role

DAG-structured permission lattice. Child roles inherit the union of all parents' permissions. Org-scoped.

- Permission format: `<product>:<module>:<resource>:<action>`

### RoleBinding

Assignment of a Role to a Principal or Group, scoped to an Org/Namespace/Deployment.

### Classification

Mandatory sensitivity label on resources. **Cannot** be bypassed by discretionary grants (mandatory > discretionary).

- Four clearance slots per Org, mapped to org-specific meanings
- Examples: `VIP_OPS`, `SUBSCRIBER_PII`, `FINANCIAL`, `TRAI_REGULATED`

### Scope Node

Node in an org-defined hierarchy of arbitrary depth. Principals assigned at nodes; access inherits downward.

- Scope types (all use same underlying model): Region, Topology, Channel, Department, Skill Family
- Effective access = intersection of ALL applicable scopes

### Relationship Tuple (ReBAC)

Graph edge representing a specific resource relationship (owner, team member, shared viewer/editor, assignee, approver). Distinct from Roles: Roles = "can do X in general"; Relationships = "has connection Y to resource Z specifically."

### Constraint *(doc-level concept)*

Runtime-evaluated condition: time window, workflow state, skill/certification, financial authority, multi-party approval, explicit deny, priority elevation, break-glass.

### QuotaBucket

Limit + counters scoped to a Namespace (and optionally a ModuleInstance). Supports concurrency-safe atomic operations.

### AuditEvent

Log of every access decision and action, traceable to Principal, resource, policy, and context.

### API Key

Token for service account authentication with scoped permissions.

---

## Service Plane

> Per-Site: executes business logic, provides APIs, runs jobs, manages events.

### ModuleInstance

Runtime incarnation of an enabled Module in a specific Namespace/Site. Binds a ModuleVersion to a Namespace with configuration.

- Relationships: N→1 Namespace, N→1 ModuleVersion

### Job / TaskRun *(doc-level concept)*

Unit of async work execution within a ModuleInstance.

### WorkflowRun *(doc-level concept)*

Temporal-like workflow execution within a ModuleInstance.

### EventStream *(doc-level concept)*

Named channel for event publication. ModuleInstances publish/subscribe to event streams.

### IntegrationConnector *(doc-level concept)*

Connection to an external system (webhook endpoint, external API).

---

## Data Plane

> Per-Site: manages storage, analytics, indexing, backup, replication.

### Dataset *(doc-level concept)*

Logical data collection scoped to a Namespace.

### BackupSnapshot *(doc-level concept)*

Point-in-time backup of tenant data with retention policies.

### Pipeline *(doc-level concept)*

Data processing workflow with scheduled or triggered runs.

---

## Observability

> Cross-cutting: logs, traces, metrics, alerts. Adapter-based (no dedicated DB tables).

### Alert *(as implemented in Trafficure)*

Traffic/operational incident notification.

- Types: `CONGESTION` | `RAPID_DETERIORATION`
- Severity: `WARNING` | `EMERGENCY`
- Key metrics: `currentTravelTimeSec`, `typicalTimeSec`, `liveSpeedKmph`, `velocityDecay`, `saturationIndex`, `deviationIndex`, `impactCostSec`

### Observability APIs

- **Logs**: query by module, component, site, sandbox, level, grep, time range
- **Traces**: distributed tracing with trace IDs, spans, duration
- **Metrics**: time-series via PromQL
- **Alerts**: alert rules, instances, acknowledgment, resolution

---

## Cross-Plane Relationships

These are the critical bridges connecting the planes into a coherent system.

```
Product → Build
  WorkItem ←N:M→ PullRequest (traceability from work to code)
  Module 1→N Repo (code lives here)

Build → Fleet
  ModuleVersion 1→N ReleaseModulePin ←N:1 Release
  Artifact → Workload (what's actually running)

Commerce → Fleet → Site(Control)
  Entitlement → EntitlementBundle → Site
  EntitlementBundle controls which Modules are enabled

Fleet → Infrastructure
  Site N→1 Cluster N→1 Provider
  DeploymentTarget N→1 Cluster | Host | VM

Site(Control) → Site(Service)
  Namespace 1→N ModuleInstance
  RoleBinding controls access to ModuleInstance and Dataset

Site(Service) → Site(Data)
  ModuleInstance ←N:M→ Dataset (read/write grants)
  WorkflowRun 1→N RunArtifact → Dataset/Object
```

---

## Terminology Decisions

These vocabulary choices are intentional. Use the Factory term, not the alternatives.

| Factory Term | NOT | Why |
|---|---|---|
| **Module** | Service, Project, Package | "Service" is overloaded (K8s), "Project" is a repo checkout, "Package" is too generic |
| **ComponentSpec** | Service, Container | "Service" is a K8s network endpoint; "Container" is a built artifact (image) |
| **Artifact** | Deployment, Build Output | Clear distinction: immutable built output from the Build Plane |
| **Release** | Deployment | Release = collection of module version pins; Deployment is overloaded |
| **Rollout** | Deployment | Rollout = the act of deploying a Release to a Site |
| **Site** | Deployment, Environment | Running instance of a product; unique and unambiguous |
| **Namespace** | Project, Workspace | Runtime tenancy boundary, not a repo checkout or UI context |
| **Route** | Alias | Standard networking term, not Vercel-style mutable DNS |
| **DeploymentTarget** | Environment | Specific runtime target with kind (production/staging/sandbox/dev) |
| **Factory** | Platform, System | The overall software production system across all six planes |

---

## Enums Reference

Quick lookup for all status and type enumerations.

### Lifecycle & Status Enums

| Entity | Enum | Values |
|---|---|---|
| Module | lifecycleState | `active`, `deprecated`, `retired` |
| WorkItem | status | `backlog`, `ready`, `in_progress`, `in_review`, `done` |
| WorkItem | kind | `epic`, `story`, `task`, `bug` |
| WorkItem | priority | `critical`, `high`, `medium`, `low`, `none` |
| Site | status | `provisioning`, `active`, `suspended`, `decommissioned` |
| Release | status | `draft`, `staging`, `production`, `superseded`, `failed` |
| DeploymentTarget | status | `provisioning`, `active`, `suspended`, `destroying`, `destroyed` |
| Workload | status | `provisioning`, `running`, `degraded`, `stopped`, `failed`, `completed` |
| Rollout | status | `pending`, `in_progress`, `succeeded`, `failed`, `rolled_back` |
| Cluster | status | `provisioning`, `ready`, `degraded`, `destroying` |
| Host | status | `active`, `maintenance`, `offline`, `decommissioned` |
| VM | status | `provisioning`, `running`, `stopped`, `destroying` |
| KubeNode | status | `ready`, `not_ready`, `paused`, `evacuating` |
| Provider | status | `active`, `inactive` |
| CustomerAccount | status | `trial`, `active`, `suspended`, `terminated` |
| Entitlement | status | `active`, `suspended`, `revoked` |
| Agent | status | `active`, `disabled` |
| AgentExecution | status | `pending`, `running`, `succeeded`, `failed` |
| WebhookEvent | status | `pending`, `processing`, `completed`, `failed` |
| Sandbox | status | via DeploymentTarget |
| SandboxSnapshot | status | `creating`, `ready`, `failed`, `deleted` |
| ReleaseBundle | status | `building`, `ready`, `failed`, `expired` |
| Route | status | `pending`, `active`, `error`, `expired` |
| Domain | status | `pending`, `verified`, `active`, `error` |
| Tunnel | status | `connecting`, `active`, `disconnected` |
| IpAddress | status | `available`, `assigned`, `reserved`, `dhcp` |

### Type/Kind Enums

| Entity | Enum | Values |
|---|---|---|
| ComponentSpec | kind | `server`, `worker`, `task`, `scheduled`, `site`, `database`, `gateway` |
| Repo | kind | `product-module`, `platform-module`, `library`, `vendor-module`, `client-project`, `infra`, `docs`, `tool` |
| Artifact | kind | `container_image`, `binary`, `archive`, `package`, `bundle` |
| DeploymentTarget | kind | `production`, `staging`, `sandbox`, `dev` |
| DeploymentTarget | runtime | `kubernetes`, `compose`, `systemd`, `windows_service`, `iis`, `process` |
| DeploymentTarget | trigger | `manual`, `pr`, `release`, `agent`, `ci` |
| Provider | providerType | `proxmox`, `hetzner`, `aws`, `gcp` |
| Provider | providerKind | `internal`, `cloud`, `partner` |
| GitHostProvider | hostType | `github`, `gitlab`, `gitea`, `bitbucket` |
| GitHostProvider | authMode | `pat`, `github_app`, `oauth` |
| WorkTrackerProvider | kind | `jira`, `linear` |
| Agent | agentType | `engineering`, `qa`, `product`, `security`, `ops`, `external-mcp` |
| Route | kind | `ingress`, `sandbox`, `preview`, `tunnel`, `custom_domain` |
| Route | protocol | `http`, `grpc`, `tcp` |
| Route | tlsMode | `auto`, `custom`, `none` |
| Domain | kind | `primary`, `alias`, `custom`, `wildcard` |
| Subnet | subnetType | `management`, `storage`, `vm`, `public`, `private`, `other` |
| KubeNode | role | `server`, `agent` |
| Host/VM | osType | `linux`, `windows` |
| Host/VM | accessMethod | `ssh`, `winrm`, `rdp` |
| Sandbox | runtimeType | `container`, `vm` |
| Sandbox | ownerType | `user`, `agent` |
| ReleaseBundle | arch | `amd64`, `arm64` |
| InstallManifest | role | `site`, `factory` |
| InstallManifest | installMode | `connected`, `offline` |

### Database Schemas

| Schema | Plane | Contains |
|---|---|---|
| `factory_product` | Product | Modules, ComponentSpecs, WorkItems, WorkTrackerProviders |
| `factory_build` | Build | Repos, ModuleVersions, Artifacts, GitHostProviders, Webhooks |
| `factory_fleet` | Fleet | Sites, Releases, DeploymentTargets, Workloads, Rollouts, Sandboxes, Routes, Domains, Tunnels |
| `factory_infra` | Infrastructure | Providers, Regions, Datacenters, Clusters, Hosts, VMs, KubeNodes, Subnets, IpAddresses |
| `factory_agent` | Agent | Agents, AgentExecutions |
| `factory_commerce` | Commerce | CustomerAccounts, Plans, Entitlements, EntitlementBundles |

---

## Conventions

- **Slug-based lookups**: Always use slugs (not IDs) when resolving references between entities
- **ID prefixes**: Entity types use prefixes in generated IDs (e.g., `mod_`, `mv_`, `art_`, `dt_`)
- **Timestamps**: All timestamps use `WITH TIMEZONE`
- **JSONB flexibility**: Extensible metadata stored as JSONB (capabilities, labels, configs, policies, quotas)
- **Soft deletes**: Where applicable, tracked via `deletedAt`/`deletedBy` timestamps
- **Audit trails**: Critical operations tracked with principal IDs and timestamps
