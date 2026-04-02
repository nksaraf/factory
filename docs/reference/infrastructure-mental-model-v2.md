# The Universal Infrastructure Mental Model — V2

## A vocabulary for humans and AI agents operating complex, messy, real-world systems

---

## Why This Document Exists

You're a developer at a company that has accumulated 30 years of infrastructure decisions.
You have Windows servers, Linux VMs, Proxmox clusters, Kubernetes, Docker Compose stacks,
customer on-prem deployments, cloud accounts, preview environments, agent sandboxes, Traefik
gateways, Helm charts, native installers, and things nobody remembers setting up.

You need a vocabulary that is:
- **Unambiguous**: Every word means exactly one thing
- **Complete**: Covers every situation you'll encounter
- **Natural**: How developers actually think and talk
- **Machine-friendly**: An AI agent (Claude Code, Cursor, a future ops copilot) can reason
  about your infrastructure using these same terms

This is that vocabulary.

---

## The Complexity Landscape

Before defining terms, here's every axis of complexity a real company faces. Your
vocabulary must have a word for each of these, or you'll be ambiguous when it matters most
(incidents, planning, onboarding, audits).

### Complexity Axis 1 — Physical Diversity

Your stuff runs on things you own (bare metal in your office), things you rent (cloud VMs),
things your customers own (on-prem servers), and things nobody owns (serverless functions,
CDN edge nodes). The physical layer nests: a datacenter contains racks, racks contain
hypervisor hosts, hosts contain VMs, VMs contain container runtimes. Cloud has its own
nesting: provider → account → region → VPC → subnet → instance.

### Complexity Axis 2 — Runtime Diversity

The same logical software runs as a Docker Compose stack here, a Kubernetes deployment
there, a Windows Service on that server, a systemd unit on this VM, a Lambda function in
that account, and a .msi-installed native process on a customer's locked-down Windows box.
Each runtime has different deployment mechanisms, different monitoring hooks, different
failure modes, different scaling characteristics.

### Complexity Axis 3 — Tenancy Diversity

Some deployments serve your team only. Some serve all customers through shared
infrastructure. Some serve a single customer on dedicated infrastructure. Some serve a
customer on *their* infrastructure that you may or may not be able to access. The isolation
guarantees differ at every layer: shared database vs dedicated database, shared cluster vs
dedicated cluster, shared host vs dedicated host.

### Complexity Axis 4 — Lifecycle Diversity

Some deployments are ephemeral (preview environments for a PR, lasting hours). Some are
stable production serving paying customers. Some are frozen legacy that nobody dares touch.
Some are actively being migrated. Some are the target of that migration. Some exist only
to verify that old and new produce the same results. Some are scheduled jobs that run for
10 minutes at 3am and don't exist the rest of the time.

### Complexity Axis 5 — Deployment Mechanism Diversity

Docker Compose up. Helm install. Terraform apply. Ansible playbook. A bash script someone
wrote in 2019. Manual installation following a Confluence page. A customer's IT team
following your PDF installation guide. GitOps with Flux watching a repo. An MSI installer
executed via RDP. Each mechanism has different rollback characteristics, different drift
profiles, different auditability.

### Complexity Axis 6 — Dependency Diversity

Your service depends on your own other services (internal), on managed cloud services you
don't operate (RDS, S3, SendGrid), on open-source infrastructure you self-host (Postgres,
Redis, NATS), and on customer-provided integrations (their SSO, their data feeds). Some
dependencies are hard (service is useless without them), some are soft (service degrades
gracefully), some are build-time only, some are asynchronous. The failure of any dependency
has a blast radius that's different depending on which dependency and which direction.

### Complexity Axis 7 — Data & State Diversity

Some services are stateless compute. Some manage critical persistent state in databases.
Some use local disk as ephemeral cache. Some share a database with other services (hidden
coupling). Data has its own residency requirements (must stay in India), retention
requirements (keep 7 years for audit), isolation requirements (dedicated schema per
customer), and backup/recovery requirements (RPO 1 hour, RTO 4 hours). You can
decommission a deployment but you can't decommission its data on the same timeline.

### Complexity Axis 8 — Network & Connectivity Diversity

Services connect via load balancers, reverse proxies, VPN tunnels, direct network paths,
message queues, shared databases, file drops, or API gateways. Physical network
constraints (VLANs, firewall rules, VXLAN zones, IP allowlists) determine what can
actually reach what, independent of what the application code assumes. A TLS certificate
expiring at 3am takes down a service just as hard as the service crashing.

### Complexity Axis 9 — Organizational Diversity

Different teams own different services. Different customers have different SLAs, different
maintenance windows, different compliance requirements, different change approval
processes. Some deployments you can push to freely. Some require a change ticket. Some
require customer approval with a 2-week lead time. Ownership, permissions, and process
vary per deployment, not just per environment.

### Complexity Axis 10 — Temporal Diversity

Infrastructure isn't a snapshot — it's a timeline. What was deployed yesterday vs today?
Who changed what, when, and why? Which version was running when the incident started? When
was this customer's deployment last verified? How long has this host been drifting from its
declared configuration? Every entity has a history, and that history is the primary tool
for incident investigation, compliance audit, and understanding how you got here.

---

## The Vocabulary

Ten entity types. Every piece of your infrastructure is exactly one of these, or is a
property or relationship on one of these. No ambiguity.

---

### 1. SUBSTRATE

**Definition:** The physical or account-level resource you pay for. The foundation
everything else is built on. Substrates nest inside other substrates.

**Developer's intuition:** "Whose hardware or cloud bill is this?"

**Examples:**
- A physical server chassis in your office rack
- A Proxmox hypervisor cluster
- An AWS account
- An AWS region within that account
- A VPC within that region
- A customer's on-prem server room
- A colocation cage at a datacenter provider

**Key properties:**

| Property | Why it matters |
|---|---|
| `type` | `bare-metal`, `cloud-account`, `cloud-region`, `vpc`, `datacenter`, `rack`, `hypervisor-cluster`, `edge-site`, `customer-premises` |
| `parent` | Substrates nest: account → region → VPC → subnet |
| `provider` | `self-hosted`, `aws`, `azure`, `gcp`, `customer-managed` |
| `owner` | Who pays the bill, who has physical/account access |
| `location` | Physical location or cloud region identifier |
| `access_mechanism` | `direct`, `vpn`, `jump-box`, `customer-granted`, `no-access` |
| `network_topology` | VLANs, VXLAN zones, IP subnets allocated here |
| `licensing` | Windows Server licenses, VMware licenses tied to this substrate |
| `cost_center` | For cost attribution |
| `lifecycle_state` | `active`, `provisioning`, `decommissioning`, `archived` |

**Common confusion this resolves:**
- "The server" — do you mean the physical chassis (substrate) or the VM running on it (host)?
- "The cloud" — which account, which region, which VPC?
- "On-prem" — yours or the customer's?

---

### 2. HOST

**Definition:** An addressable machine with an operating system. You can SSH or RDP into it.
It has an IP address. Created from or placed on a substrate.

**Developer's intuition:** "The machine."

**Examples:**
- A VM on Proxmox
- An EC2 instance
- A bare-metal Linux server (where substrate and host are the same physical thing)
- A developer's VM
- A Windows Server running in a customer's VMware cluster
- A CI/CD build agent machine

**Key properties:**

| Property | Why it matters |
|---|---|
| `substrate` | Which substrate this lives on |
| `pool` | Optional grouping of fungible hosts (see below) |
| `hostname` | Network identity |
| `os` | `ubuntu-24.04`, `windows-server-2022`, `rhel-9`, `proxmox-ve-8` |
| `arch` | `x86_64`, `arm64` |
| `role` | `app-server`, `db-server`, `k8s-node`, `dev-vm`, `build-agent`, `jump-box`, `gateway` |
| `capabilities` | `gpu`, `high-memory`, `ssd`, `customer-network-access` |
| `resources_allocated` | CPU cores, RAM, disk, network bandwidth |
| `resources_consumed` | Current utilization (telemetry, not inventory — but the allocation is inventory) |
| `provisioned_by` | `terraform`, `ansible`, `manual`, `proxmox-ui`, `cloud-formation` |
| `iac_source` | Git repo + path + ref of the IaC that declares this host |
| `lifecycle_state` | `provisioning`, `active`, `draining`, `maintenance`, `frozen`, `decommissioning` |
| `owner_team` | Who is responsible |
| `cost_tag` | For cost attribution |

**Pool** — an optional grouping:

When hosts are interchangeable (K8s worker nodes, build agents, developer VMs), they form
a **pool**. Developers think about capacity at the pool level ("the build agent pool is
full"), not individual hosts. A pool has a name, a substrate, a scaling policy
(`fixed`, `auto-scaling`, `on-demand`), and min/max size.

**Common confusion this resolves:**
- "Instance" — always means host. Never means "an instance of our product" (that's a deployment).
- "Box" — informal but fine as a synonym for host.
- "Node" — a host that's part of a cluster or pool.

---

### 3. RUNTIME

**Definition:** The workload execution environment on a host. The thing that supervises,
schedules, starts, stops, and monitors processes. A host can run multiple runtimes.
Runtimes can nest.

**Developer's intuition:** "How does stuff run on this machine?"

**Examples:**
- `systemd` on a Linux host (OS-native runtime)
- Windows Services on a Windows Server host
- Docker Engine on a Linux host
- A Docker Compose project (a structured layer atop Docker Engine)
- A Kubernetes cluster (spans multiple hosts but is a single logical runtime)
- A Kubernetes namespace within a cluster
- A serverless platform (AWS Lambda, Cloudflare Workers — no host at all)
- A JVM application server (Tomcat, WebSphere — yes, these still exist)
- A batch scheduler (cron, Airflow, Windows Task Scheduler)

**Key properties:**

| Property | Why it matters |
|---|---|
| `type` | `os-native`, `docker-engine`, `docker-compose`, `kubernetes-cluster`, `k8s-namespace`, `lxc`, `application-server`, `serverless-platform`, `batch-scheduler` |
| `host` | Which host (null for serverless/managed) |
| `parent_runtime` | For nesting: k8s-namespace's parent is k8s-cluster; compose project's parent is docker-engine |
| `version` | Docker 24.0, K8s 1.29, etc. |
| `lifecycle_state` | `active`, `upgrading`, `deprecated` |

**Nesting example:**
```
Host: k8s-worker-03
  └── Runtime: docker-engine (containerd)
        └── Runtime: kubernetes-cluster "lepton-prod"
              ├── Runtime: k8s-namespace "trafficure-prod"
              ├── Runtime: k8s-namespace "smartmarket-prod"
              └── Runtime: k8s-namespace "monitoring"
```

**Common confusion this resolves:**
- "Docker" — the engine (runtime) or the container (workload)?
- "Kubernetes" — the cluster (runtime) or the deployment object within it (deployment)?
- "Environment" — never means runtime. Environment is a lifecycle stage (production, staging). Runtime is the technical execution layer.

---

### 4. SERVICE

**Definition:** A logical identity in your architecture. Exists independent of any
deployment. Has a name, an owner, a purpose, a source repository, and a version. Services
appear in your architecture diagrams, your API docs, your team ownership spreadsheets.

**Developer's intuition:** "The thing we build and maintain."

**Examples:**
- Trafficure API
- Trafficure Web UI
- SmartMarket Ingestion Pipeline
- Ory Kratos (yes — infrastructure tools are services too)
- Grafana
- Traefik Gateway

**Key properties:**

| Property | Why it matters |
|---|---|
| `name` | The canonical name everyone uses |
| `type` | `application`, `infrastructure-tool`, `data-store`, `message-bus`, `observability`, `ci-cd`, `library`, `job` |
| `owner_team` | Who builds and maintains this |
| `source_repo` | Git repository |
| `runtime_requirements` | `linux-only`, `jvm-17+`, `gpu-required`, `windows-dotnet-6` |
| `statefulness` | `stateless`, `stateful-ephemeral` (cache), `stateful-persistent` (database) |
| `communication_patterns` | How it talks to its dependencies: `sync-rest`, `sync-grpc`, `async-queue`, `event-pubsub`, `file-exchange`, `database-shared` |
| `current_version` | Latest released version |
| `runbook_url` | Link to operational documentation |
| `architecture_doc_url` | Link to design documentation |

**Dependencies on a service are typed:**

| Dependency property | Values |
|---|---|
| `target` | Another service_id or managed_dependency_id |
| `strength` | `hard` (cannot function without), `soft` (degrades gracefully), `optional` (used if available), `build-only` (compile time) |
| `pattern` | `sync`, `async`, `event-driven`, `file-based`, `database-shared` |
| `direction` | `calls`, `called-by`, `publishes-to`, `subscribes-from`, `reads-from`, `writes-to` |

This means you can express: "Trafficure API **hard-depends synchronously** on Postgres
and **soft-depends asynchronously** on the notification service via NATS." That's
operationally meaningful. A flat dependency list is not.

**Common confusion this resolves:**
- "Service" never means "a server" or "a daemon process." Those are hosts and workloads respectively.
- Infrastructure tools (Grafana, Traefik, Ory) are services. They have versions, deployments, owners, and dependencies — just like your application services.

---

### 5. ARTIFACT

**Definition:** The built, versioned, distributable package that gets deployed. The bridge
between source code and running deployment. An artifact is *what* gets deployed. A
deployment is *where and how* it runs.

**Developer's intuition:** "The thing CI produces."

**Examples:**
- A Docker image in a container registry
- A Helm chart in a chart repository
- A .deb or .rpm package
- A Windows .msi installer
- A compiled binary uploaded to a release page
- A firmware image
- A signed deployment bundle for air-gapped customer sites
- A tarball delivered on a USB drive (yes, really — for air-gapped Palantir-style deploys)

**Key properties:**

| Property | Why it matters |
|---|---|
| `service` | Which service this artifact packages |
| `version` | Semantic version, git tag, or commit SHA |
| `type` | `container-image`, `helm-chart`, `deb-package`, `rpm-package`, `msi-installer`, `binary`, `firmware`, `bundle`, `tarball` |
| `registry` | Where it's stored: Docker Hub, ECR, Nexus, GitHub Releases, S3, "hand-delivered" |
| `build_source` | Git repo + commit SHA + CI pipeline that produced it |
| `signature` | Checksum, GPG signature, or code signing cert for integrity verification |
| `os_arch_targets` | Which OS/arch combinations this runs on: `linux/amd64`, `windows/amd64` |
| `created_at` | When it was built |

**Why this entity is critical:** Without it, you can't answer:
- "What exact bits are running on Ultratech's server?" (security incident)
- "Is the image in our registry the same one that's on the customer's server?" (drift)
- "Which CI pipeline produced the artifact that's causing this bug?" (root cause)
- "Do we have a signed artifact ready for the air-gapped customer?" (release management)

---

### 6. DEPLOYMENT

**Definition:** A specific version of a service (via an artifact), running on a specific
runtime, for a specific tenant, in a specific environment. The deployment is the single
most important entity in the model — it's the join table that binds logical identity
(service) to physical reality (runtime, host, substrate).

**Developer's intuition:** "Our thing, running in that place, for that customer."

**Examples:**
- Trafficure API v2.3.1, Docker Compose, Ultratech's on-prem VM, production
- Trafficure API v2.4.0, Helm chart on lepton-prod k8s cluster, shared SaaS, production
- Trafficure API feature branch, Docker Compose on preview VM, internal, preview
- Grafana v10.2, Docker Compose on monitoring VM, internal, production
- SmartMarket Worker v1.1.0, Windows Service on win-server-05, internal, production

**Key properties:**

| Property | Why it matters |
|---|---|
| **Identity** | |
| `service` | Which service |
| `artifact` | Which built artifact (image, chart, package) with exact version |
| `runtime` | Where it runs |
| **Dimensions** (see next section) | |
| `environment` | Lifecycle stage |
| `tenant` | Who it's for |
| `topology` | What shape |
| `deployment_mode` | How traffic reaches it |
| `lifecycle_state` | Operational status |
| `statefulness` | Inherited from service but can be overridden per deployment |
| **Mechanism** | |
| `deployment_mechanism` | `docker-compose`, `helm-chart`, `ansible-playbook`, `terraform`, `native-installer`, `manual-runbook`, `gitops-flux`, `gitops-argo`, `customer-self-install` |
| `iac_source` | Git repo + path + ref of the IaC / Compose file / Helm values / Ansible playbook |
| **Configuration** | |
| `config_source` | Where base config comes from: git path, Vault path, ConfigMap |
| `config_overlays` | Tenant-specific or environment-specific overrides |
| `secrets_source` | Where secrets come from: `vault`, `aws-secrets-manager`, `k8s-secret`, `env-file`, `manual` |
| **Operations** | |
| `owner_team` | Team responsible for this deployment |
| `sla_tier` | `best-effort`, `business-hours`, `24x7-standard`, `24x7-critical` |
| `maintenance_window` | When changes are allowed |
| `change_process` | `continuous-deploy`, `manual-approval`, `change-ticket`, `customer-approval-required` |
| `compliance_tags` | `data-residency-india`, `sox`, `gdpr`, `hipaa`, `air-gapped`, `pci-dss` |
| `runbook_url` | Deployment-specific operational docs (overrides service-level runbook) |
| `cost_tag` | For cost attribution |
| **State tracking** | |
| `desired_state` | What should be running (from IaC source) |
| `observed_state` | What is actually running (from agent or last verification) |
| `drift_status` | `converged`, `drifted`, `unknown`, `unreachable` |
| `last_deployed_at` | When the artifact was last pushed |
| `last_verified_at` | When observed state was last checked against desired |
| `provenance` | Who created this deployment, when, from what blueprint, via what process |

**Lifecycle states:**

| State | Meaning | Typical trigger |
|---|---|---|
| `provisioning` | Being set up, not yet serving | New customer onboarding, new environment spin-up |
| `active` | Running, serving its purpose | Normal operations |
| `draining` | Still running, traffic being shifted away | Pre-migration, pre-decommission |
| `migrating-source` | Running in parallel with its replacement | Migration in progress |
| `migrating-target` | The replacement, receiving partial/shadow traffic | Migration in progress |
| `frozen-legacy` | Cannot update (risk/knowledge-loss), cannot remove (still needed) | Institutional knowledge loss, fear of breakage |
| `deprecated-but-running` | Marked for removal, timeline exists | Successor deployed, migration planned |
| `decommissioning` | Actively being torn down | Migration complete, customer churned |
| `archived` | Nothing running, record kept for audit | Post-decommission |

---

### 7. RELEASE BUNDLE

**Definition:** A group of artifacts that are deployed together as an atomic unit and must
be version-compatible with each other. A single release bundle is promoted as one through
environments.

**Developer's intuition:** "The set of things that ship together."

**Examples:**
- A Docker Compose file that brings up 5 containers (API, worker, UI, Redis, migration job)
- A Helm umbrella chart that deploys the API, the ingestion pipeline, and a sidecar
- "Trafficure Platform v2.4.0" = API v2.4.0 + UI v2.4.0 + Worker v2.4.0 + Migration v2.4.0

**Key properties:**

| Property | Why it matters |
|---|---|
| `name` | "Trafficure Platform", "SmartMarket Suite" |
| `version` | The bundle version (may differ from individual artifact versions) |
| `artifacts` | List of artifact_ids with their compatible versions |
| `compatibility_matrix` | Which artifact versions work together |
| `promotion_path` | `preview → staging → production` |
| `rollback_unit` | The whole bundle rolls back together or not at all |

**Why this matters:** Without it, you'll deploy Trafficure API v2.4.0 while the worker is
still on v2.3.0, the migration hasn't run, and the UI expects the old API contract. The
release bundle is how you prevent version skew across a multi-service deployment.

---

### 8. WORKLOAD

**Definition:** A single running process or container within a deployment. The most granular
unit of compute. Workloads are ephemeral — they come and go. Deployments are the stable
record; workloads are the transient reality.

**Developer's intuition:** "The actual process."

**Examples:**
- A running Docker container
- A Kubernetes pod
- A Windows Service process
- A systemd unit
- A Lambda function invocation
- A cron job execution

**Key properties:**

| Property | Why it matters |
|---|---|
| `deployment` | Which deployment this belongs to |
| `service` | Usually same as the deployment's service, but may differ for sidecars (see below) |
| `type` | `container`, `pod`, `os-process`, `serverless-invocation`, `batch-execution` |
| `replica_index` | For scaled deployments: which replica is this |
| `host` | Which host it's running on right now (may differ from deployment's declared runtime for k8s) |
| `status` | `running`, `starting`, `stopping`, `crashed`, `completed` |
| `started_at` | When this specific process/container started |

**Sidecar pattern:** A workload within deployment X can belong to a different service than
deployment X's primary service. Example: an OpenTelemetry collector sidecar (service:
"otel-collector", owner: platform team) running inside the Trafficure API deployment
(service: "trafficure-api", owner: product team). The workload's `service` field differs
from its `deployment`'s service, and that's the signal that it's a sidecar.

---

### 9. NETWORK ENTITY

**Definition:** The connective tissue between deployments. Things that route traffic,
enforce access, terminate TLS, bridge networks, or expire and take your service down at
3am.

**Developer's intuition:** "The plumbing between things."

**Examples:**
- A Traefik reverse proxy instance
- A cloud load balancer (ALB, NLB)
- A DNS record (A, CNAME, SRV)
- A VPN tunnel to a customer site
- A firewall rule or security group
- A TLS certificate
- An API gateway route
- A VXLAN zone in Proxmox SDN
- A VLAN configuration
- An IP subnet / IPAM allocation (from NetBox)
- A service mesh sidecar configuration (Envoy, Linkerd)
- A message queue / topic (NATS subject, Kafka topic — the queue is network, what publishes/subscribes is a service)

**Key properties:**

| Property | Why it matters |
|---|---|
| `type` | `load-balancer`, `reverse-proxy`, `dns-record`, `vpn-tunnel`, `firewall-rule`, `security-group`, `cdn`, `api-gateway-route`, `tls-certificate`, `vlan`, `vxlan-zone`, `ip-subnet`, `service-mesh-config`, `message-topic` |
| `name` | Human-readable identifier |
| `connects` | Which deployments, hosts, or substrates this links |
| `direction` | `ingress`, `egress`, `bidirectional`, `internal` |
| `protocol` | `https`, `grpc`, `tcp`, `amqp`, `nats`, `wireguard` |
| `owner_team` | Who manages this |
| `expiry` | For certs, DNS registrations, VPN agreements — nullable |
| `lifecycle_state` | `active`, `expiring-soon`, `expired`, `deprecated` |
| `iac_source` | What Terraform/Ansible/config declares this |

---

### 10. MANAGED DEPENDENCY

**Definition:** A third-party service you use but don't deploy. Shows up in your
architecture diagrams and incident investigations but you have no workload to manage and
no artifact to version.

**Developer's intuition:** "Someone else's problem, until it isn't."

**Examples:**
- AWS RDS Postgres instance
- AWS S3 bucket
- Cloudflare DNS
- SendGrid email API
- GitHub Actions CI/CD
- Stripe payment processing
- A customer-provided SSO / SAML endpoint
- A customer-provided data feed (SFTP, API)

**Key properties:**

| Property | Why it matters |
|---|---|
| `name` | Specific instance: "Trafficure prod RDS", not just "RDS" |
| `provider` | `aws`, `cloudflare`, `sendgrid`, `customer-provided` |
| `type` | `database`, `object-store`, `cache`, `queue`, `email`, `dns`, `cdn`, `ci-cd`, `auth`, `payment`, `customer-integration` |
| `substrate` | Which cloud account/region, if applicable |
| `vendor_sla` | Their published availability guarantee |
| `used_by` | Which services depend on this |
| `owner_team` | Internal team owning the relationship, billing, and credential rotation |
| `cost_tag` | For cost attribution |

**"Customer-provided" is a special case:** When your deployment integrates with a
customer's SSO, data feed, or API, that's a managed dependency you depend on but the
customer manages. It has its own availability characteristics and its own failure modes
that are outside your control. Model it explicitly.

---

### 11. DATA STORE

**Definition:** A persistent collection of data with its own lifecycle, residency, isolation,
backup, and retention requirements. The data store is distinct from the compute that
serves it — you might decommission a Postgres deployment but the data must be archived for
7 years.

**Developer's intuition:** "The actual data, not the database engine."

**Examples:**
- The Trafficure production database (schemas, tables, the actual data)
- A customer-specific data shard
- An S3 bucket containing map tiles
- A Redis cache that's ephemeral (still worth tracking — its loss has operational impact)
- File system storage on a customer's NFS share

**Key properties:**

| Property | Why it matters |
|---|---|
| `name` | "Trafficure prod database", "Ultratech data shard" |
| `type` | `relational-db`, `document-db`, `object-store`, `file-system`, `cache`, `search-index`, `time-series`, `graph-db` |
| `engine` | `postgres-16`, `redis-7`, `elasticsearch-8`, `s3`, `nfs` |
| `served_by` | deployment_id (self-hosted Postgres) or managed_dependency_id (RDS) |
| `tenant_isolation` | `shared-schema` (orgId column), `schema-per-tenant`, `database-per-tenant`, `instance-per-tenant` |
| `data_residency` | `india`, `eu`, `us`, `customer-premises`, `any` |
| `backup_schedule` | Frequency and mechanism |
| `retention_policy` | How long data must be kept and why |
| `rpo` | Recovery Point Objective: maximum acceptable data loss |
| `rto` | Recovery Time Objective: maximum acceptable downtime |
| `encryption` | `at-rest`, `in-transit`, `both`, `none` |
| `owner_team` | Who is responsible for this data |
| `pii_classification` | Does this contain personal data? What kind? |

---

### 12. SECRET

**Definition:** A credential, key, certificate, or token that grants access to something.
Secrets have their own lifecycle: creation, rotation, distribution, revocation. A leaked
or expired secret is an incident.

**Developer's intuition:** "The password / key / token."

**Examples:**
- Database connection string with password
- API key for SendGrid
- OAuth client secret for a customer's SSO integration
- TLS private key
- Service account token for inter-service auth
- SSH key for accessing customer on-prem servers
- Encryption key for data at rest

**Key properties:**

| Property | Why it matters |
|---|---|
| `name` | "Trafficure prod DB password", "Ultratech VPN cert" |
| `type` | `database-credential`, `api-key`, `oauth-secret`, `tls-private-key`, `ssh-key`, `service-token`, `encryption-key` |
| `stored_in` | `vault`, `aws-secrets-manager`, `k8s-secret`, `env-file`, `config-file`, `manual` |
| `used_by` | Which deployments consume this secret |
| `grants_access_to` | Which data stores, managed dependencies, or hosts |
| `rotation_schedule` | Every 90 days, annually, never (bad but real) |
| `last_rotated` | When it was last changed |
| `expires_at` | Hard expiration, if any |
| `blast_radius` | If leaked: what's compromised? One deployment or twenty? |
| `owner_team` | Who rotates and manages this |

---

## The Five Dimensions

Every **deployment** sits at the intersection of five orthogonal dimensions.
These are not tags. They're structural properties that determine operational behavior.

### Dimension 1: ENVIRONMENT

**What it answers:** "How scared should I be if this breaks?"

| Value | Meaning |
|---|---|
| `production` | Serving real users or customers. Breaking this has business impact. |
| `staging` | Pre-production validation. Should mirror production. |
| `preview` | Ephemeral, per-PR or per-branch. Auto-expires. |
| `development` | Shared dev environment for integration testing. |
| `sandbox` | Isolated experimentation. No expectations of stability. |
| `dr` | Disaster recovery standby. Not serving traffic, but must be ready. |

**Never** use environment to mean a host, a runtime, or a substrate. "The production
environment" means all deployments with `environment: production`, not a specific server.

### Dimension 2: TENANT

**What it answers:** "Who is this for?"

| Value | Meaning |
|---|---|
| `internal` | For your own team's use |
| `shared-saas` | Multi-tenant, serving all SaaS customers |
| A customer identifier | Dedicated for a specific customer: `ultratech`, `samsung-india`, `ather`, `vbl` |

**Tenant isolation** varies per layer and should be tracked on the deployment:

| Layer | Isolation options |
|---|---|
| Substrate | Shared hosts vs dedicated hosts |
| Runtime | Shared namespace vs dedicated namespace vs dedicated cluster |
| Data | Shared-schema vs schema-per-tenant vs database-per-tenant |
| Network | Shared gateway vs dedicated gateway / VPN |

### Dimension 3: TOPOLOGY

**What it answers:** "What shape is this deployment?"

| Value | Meaning |
|---|---|
| `single-node` | Everything on one host, typically Compose |
| `clustered` | Multiple hosts, orchestrated (K8s, multi-node Compose) |
| `managed-cloud` | You run it in your cloud account for the customer |
| `on-prem-managed` | Customer's hardware, you have access and manage it |
| `on-prem-unmanaged` | Customer's hardware, installed and handed off, limited or no access |
| `edge` | Running at CDN/edge locations |
| `serverless` | No host, function-based execution |
| `hybrid` | Components split across topologies (e.g., compute in cloud, data on-prem) |

### Dimension 4: DEPLOYMENT MODE

**What it answers:** "How is traffic reaching this?"

| Value | Meaning |
|---|---|
| `live` | Receiving production traffic |
| `canary` | Receiving a small percentage of production traffic for validation |
| `blue-green-active` | The currently active side of a blue-green deployment |
| `blue-green-standby` | The standby side, ready for traffic switch |
| `shadow` | Receiving a copy of production traffic, results discarded |
| `dark-launch` | Deployed but not receiving any external traffic, for internal testing |

### Dimension 5: LIFECYCLE STATE

**What it answers:** "What's the operational status?"

(See the lifecycle states table under Deployment above.)

---

## The Three Cross-Cutting Concerns

These aren't entities or dimensions — they're properties and behaviors that apply across
all entities. They represent the operational metabolism of your infrastructure.

### Concern 1: CHANGE LOG (Temporal History)

Every entity in the model carries a change log. Not just "last modified" — a full audit
trail.

```
WHAT changed: field-level diff
WHEN: timestamp
WHO: person or automation that made the change
WHY: linked Jira ticket, PR, incident, or deployment pipeline
HOW: which mechanism (Terraform apply, Helm upgrade, manual SSH, etc.)
```

**Why this is critical:** "What changed in the last 24 hours?" is the first question in
every incident. Without a change log, you're grepping through Slack messages and git logs
and praying.

### Concern 2: COST ATTRIBUTION

Every substrate, host, managed dependency, and deployment should be taggable for cost
attribution. The question "how much does customer X cost us to serve?" should be
answerable by summing:
- Substrate costs allocated to their dedicated hosts
- Host costs for their dedicated VMs
- Proportional share of shared infrastructure (by workload resource consumption)
- Managed dependency costs attributed to their usage
- Licensing costs for software running on their deployments

### Concern 3: COMPLIANCE PROFILE

An inheritable bundle of constraints that flows from organization → tenant → deployment,
with each level able to override or tighten:

| Constraint | Example values |
|---|---|
| Data residency | Must stay in India, EU only, no restrictions |
| Audit trail retention | 1 year, 7 years, indefinite |
| Change approval process | Continuous deploy, manual approval, CAB review, customer sign-off |
| Encryption requirements | At rest + in transit, at rest only, none |
| Access control | Role-based, need-to-know, air-gapped |
| Backup requirements | Daily, hourly, real-time replication |
| Penetration testing | Annual, quarterly, continuous |
| Licensing compliance | Windows per-core, SQL Server per-CAL, open source only |

---

## The Relationship Map

```
ORGANIZATION
  └── owns/manages → SUBSTRATES (nest hierarchically)
  └── has → TENANTS (internal + customers)

SUBSTRATE
  └── contains → HOSTS
  └── hosts → MANAGED DEPENDENCIES (cloud services in this account/region)
  └── has → NETWORK ENTITIES (VLANs, subnets, firewall rules at this level)

HOST
  └── belongs to → POOL (optional, for fungible groups)
  └── runs → RUNTIMES (one or more per host; runtimes nest)

SERVICE
  └── depends on → other SERVICES (typed: hard/soft, sync/async)
  └── depends on → MANAGED DEPENDENCIES
  └── is packaged as → ARTIFACTS
  └── is grouped into → RELEASE BUNDLES (for coordinated deployment)
  └── has → DATA STORES (the data it owns)
  └── has documentation → runbook, architecture doc

ARTIFACT
  └── packages → SERVICE (specific version)
  └── stored in → registry / repository
  └── deployed as → DEPLOYMENTS

DEPLOYMENT (the central join)
  ├── of → SERVICE (what)
  ├── via → ARTIFACT (which build)
  ├── on → RUNTIME → HOST → SUBSTRATE (where, physically)
  ├── for → TENANT (who)
  ├── in → ENVIRONMENT (lifecycle stage)
  ├── shaped as → TOPOLOGY
  ├── receiving traffic via → DEPLOYMENT MODE
  ├── in state → LIFECYCLE STATE
  ├── connected through → NETWORK ENTITIES
  ├── consuming → MANAGED DEPENDENCIES
  ├── using data in → DATA STORES
  ├── authenticated by → SECRETS
  ├── containing → WORKLOADS (running processes)
  └── configured by → config source + overlays

RELEASE BUNDLE
  └── contains → ARTIFACTS (versioned together)
  └── promoted through → ENVIRONMENTS as a unit
  └── corresponds to → a set of DEPLOYMENTS that must be updated together

CHANGE LOG
  └── tracks every mutation to every entity above
  └── linked to → Jira tickets, PRs, incidents, pipelines
```

---

## The Banned Words List

These words are ambiguous in infrastructure conversations. Replace them with specific
vocabulary from this model.

| Word | Problem | Replace with |
|---|---|---|
| **server** | Means substrate? Host? Service? The HTTP daemon? | Specify: substrate, host, service, or workload |
| **instance** | EC2 instance = host. "Instance of our product" = deployment. DB instance = managed dependency. | Specify which one |
| **environment** (as a place) | "The staging environment" — do you mean all staging deployments, or a specific host? | Use "all staging deployments" or name the specific host |
| **cluster** (naked) | Proxmox cluster (substrate). K8s cluster (runtime). Service cluster (replicas). | Prefix it: substrate cluster, runtime cluster, service replicas |
| **stack** | "Our stack" = all services? The tech stack on a host? A CloudFormation stack? A Docker Compose stack? | Specify: service catalog, runtime, IaC template, or Compose project |
| **container** (when you mean the service) | The container is a workload. The thing it runs is a service. | Use workload (runtime-agnostic) or service (logical identity) |
| **infra** | Everything below the application. Too vague. | Specify: substrate, host, runtime, network entity, or managed dependency |
| **deploy** (as a noun) | "The deploy" = the deployment? The deployment mechanism? The CI pipeline? | Deployment (the entity), pipeline (the CI/CD mechanism), or release (the act of shipping) |
| **machine** | Physical machine (substrate) or virtual machine (host)? | Substrate for physical, host for virtual, or just be explicit: "the physical server" or "the VM" |
| **platform** | Your product platform? Your infrastructure platform? The cloud platform? | Be specific: "Trafficure platform" (product), "our k8s platform" (runtime), "AWS" (cloud provider) |
| **resource** | CPU resource? Cloud resource? REST resource? HR resource? | Use the specific vocabulary: host (compute), substrate (cloud), endpoint (API), or just say what you mean |
| **system** | The vaguest word in technology. | Name the actual service, deployment, host, or substrate |

---

## Quick Reference Decision Tree

```
Someone mentions a thing. What entity is it?

"We're paying for this"
  → SUBSTRATE (physical hardware, cloud account, colo, customer premises)

"It has an IP and an OS"
  → HOST (VM, bare-metal server, EC2 instance, developer machine)

"It supervises how processes run on a machine"
  → RUNTIME (Docker, K8s, systemd, Windows Services, Lambda)

"We build and maintain this"
  → SERVICE (logical identity — Trafficure API, Grafana, Ory Kratos)

"CI built this, it's in a registry"
  → ARTIFACT (container image, Helm chart, .deb, .msi, binary)

"These artifacts ship together"
  → RELEASE BUNDLE (Trafficure Platform v2.4.0)

"This version of this service is running in this place for this customer"
  → DEPLOYMENT (the central join table)

"This actual process/container is running right now"
  → WORKLOAD (ephemeral — the container, the pod, the process)

"This routes traffic or connects things"
  → NETWORK ENTITY (load balancer, DNS, VPN, cert, firewall, VLAN, message topic)

"We use this but don't deploy it"
  → MANAGED DEPENDENCY (RDS, S3, SendGrid, customer's SSO)

"This is the actual data"
  → DATA STORE (database contents, S3 bucket, file share — with residency, retention, backup)

"This grants access to something"
  → SECRET (credential, key, token, cert — with rotation schedule and blast radius)
```

---

## What This Vocabulary Enables For AI Agents

When Claude Code or any AI coding agent operates on your infrastructure, it needs to:

1. **Parse an ambiguous instruction into precise entities.**
   "Deploy the latest to Ultratech" → Create/update a DEPLOYMENT of SERVICE "Trafficure"
   using the latest ARTIFACT, on the RUNTIME at HOST in SUBSTRATE "Ultratech premises",
   ENVIRONMENT production, TENANT ultratech, checking the MAINTENANCE WINDOW and CHANGE
   PROCESS first.

2. **Reason about blast radius.**
   "Can I restart this?" → Look up the DEPLOYMENT's tenant, SLA tier, deployment mode, and
   any other deployments sharing the same HOST or RUNTIME. If it's a shared K8s namespace,
   restarting might affect other deployments.

3. **Trace failures across the graph.**
   "Why is Ultratech's dashboard slow?" → DEPLOYMENT → depends on SERVICE (API) → depends
   on DATA STORE (Postgres) → served by MANAGED DEPENDENCY (RDS) or DEPLOYMENT (self-hosted
   Postgres). Also check NETWORK ENTITIES (VPN tunnel latency, cert expiry, DNS).

4. **Generate correct deployment commands.**
   The DEPLOYMENT record tells the agent: use Docker Compose (mechanism), with this
   Compose file (iac_source), pull credentials from Vault (secrets_source), apply Ultratech
   overlay (config_overlays), and verify via this health check (runbook).

5. **Avoid dangerous operations.**
   LIFECYCLE STATE frozen-legacy → never auto-update. CHANGE PROCESS customer-approval →
   don't deploy without confirmation. COMPLIANCE TAG air-gapped → can't pull from public
   registry. The vocabulary encodes operational constraints that prevent AI agents from
   doing damage.

---

*Version 2.0 — Synthesized from patterns observed across Google, Amazon, Microsoft, Meta,
Netflix, Uber, Apple, Stripe, Cloudflare, Palantir, SpaceX, Accenture, Deloitte, TCS,
Infosys, Wipro, IBM/Kyndryl, Capgemini, Cognizant, Tech Mahindra, and 30 years of
accumulated infrastructure decisions at real companies.*
