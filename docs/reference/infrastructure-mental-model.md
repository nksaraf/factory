# The Universal Infrastructure Mental Model

## A vocabulary and data model for companies with messy, diverse, real-world systems

---

## Part I — System Integrators & Services Companies

Before we synthesize, let's study the weirdest, most chaotic infrastructure operators on
earth: the big system integrators. They don't just run *their own* mess — they run
*everyone else's* mess simultaneously.

### Accenture / Deloitte / McKinsey Digital

**The "client environment you don't own" problem.** Accenture might be managing 200+
client environments simultaneously. Each client has different technology stacks, different
security policies, different change management windows. An Accenture engineer might need
access to Client A's Azure tenant at 9am and Client B's on-prem VMware cluster at 10am.

Edge case this surfaces: **Access Boundary.** Your inventory needs to track not just "where
is this deployed" but "who can touch this, through what mechanism, under what approval
process." For Lepton, this matters the moment you have customer on-prem deployments where
your engineers need VPN access or a jump box — that access mechanism is part of the
deployment record.

**The "transition / handover" problem.** SIs regularly take over operations from one vendor
or hand over to another. This means they inherit infrastructure they didn't build, with
incomplete documentation, unknown dependencies, and configuration drift from any known-good
state. The model needs a concept of **provenance** — who built this, when, from what
blueprint, and how far has it drifted?

### TCS / Infosys / Wipro / HCL

**The "managed operations" pattern.** These companies run Network Operations Centers (NOCs)
and Security Operations Centers (SOCs) that monitor thousands of heterogeneous systems
across dozens of clients. The critical abstraction isn't the individual host — it's the
**monitoring scope** and **SLA boundary.**

Edge case: **SLA as a first-class property.** A deployment isn't just running or not — it has
contractual obligations. Response time: 15 minutes. Uptime: 99.95%. Maintenance window:
Sunday 2-4am IST. These SLA properties affect operational decisions (can we restart this
now?) and should live on the deployment record, not in a separate spreadsheet.

**The "shared managed service across clients" pattern.** TCS might run a single SIEM
instance or monitoring platform that serves 50 clients. This is multi-tenancy at the
operational layer — the monitoring tool itself is a deployment with its own lifecycle, and
the client environments are its tenants. **Infrastructure tools are themselves services
with their own deployments.** Your Grafana instance, your GitLab runner fleet, your CI/CD
pipeline — these need to be in the inventory too.

### IBM Global Services / Kyndryl

**The "mainframe coexistence" problem.** IBM manages systems that literally span six decades
of computing. A single client might have COBOL batch jobs on z/OS, Java services on
WebSphere on AIX, containers on OpenShift on Linux, and serverless functions on AWS — all
as part of one business process.

Edge case: **Execution paradigm diversity.** Our "Runtime" concept needs to be broad enough
to cover: mainframe batch schedulers, application servers (WebSphere, Tomcat), OS-native
service managers (systemd, Windows Services, launchd), container runtimes (Docker, containerd),
container orchestrators (Kubernetes, Nomad, Docker Swarm), serverless platforms (Lambda,
Workers), and edge/IoT runtimes. These are fundamentally different beasts but they all
answer the same question: "how is this workload supervised and scheduled?"

**The "technology refresh" pattern.** IBM deals constantly with planned migrations where old
and new systems run in parallel for months or years. The deployment isn't just "running" —
it might be in a state like "source of migration," "target of migration," "running in
parallel with read comparison," or "cutover pending." **Migration is a first-class lifecycle
state**, not an ad-hoc note.

### Capgemini / Atos / DXC Technology

**The "multi-cloud management" pattern.** These SIs manage workloads across AWS, Azure, GCP,
Oracle Cloud, and private clouds simultaneously — often for a single client who ended up
multi-cloud through acquisition. The substrate layer fragments: which cloud, which region,
which account, which VPC/VNet.

Edge case: **Hierarchical substrate.** It's not just "a cloud" — it's
Cloud Provider → Account/Subscription → Region → VPC/VNet → Subnet → Host.
For on-prem it's:
Site/Data Center → Rack/Chassis → Hypervisor (Proxmox/VMware) → Host (VM).
The model needs composable substrate nesting, not a flat "substrate" field.

**The "client-specific toolchain" problem.** Client A uses Terraform. Client B uses Ansible.
Client C uses manual runbooks in Confluence. The *deployment mechanism* varies not just by
technology but by organizational context. You can't assume a uniform deployment pipeline.

### Cognizant / Tech Mahindra / L&T Technology Services

**The "regulated industry overlay" problem.** When you're serving pharma (GxP validation),
banking (SOX compliance), telecom (carrier-grade SLAs), and defense (security
classification), each deployment carries regulatory metadata that constrains everything:
where it can run, who can access it, how changes must be approved, how long logs must be
retained.

Edge case: **Compliance profile as a deployment property.** Not just one tag — a bundle of
constraints: data residency requirements, audit trail requirements, change approval
workflow, backup/DR requirements, encryption requirements. This profile gets inherited from
the tenant and the environment but can be overridden per deployment.

---

## Part II — What's Common Across All of Them

After studying big tech (Google, Amazon, Microsoft, Meta, Netflix, Uber, Apple, Stripe,
Cloudflare, Palantir) and the system integrators (Accenture, TCS, IBM, Capgemini, Cognizant),
the patterns converge on a surprisingly small set of universal truths.

### Universal Truth 1: Everything is a graph, not a table

No company's infrastructure is a flat list of servers. It's always a directed graph:
services depend on other services, deployments connect to managed dependencies, hosts live
inside substrates that nest inside larger substrates, and network paths connect everything.
**The inventory is a graph database problem**, even if you initially store it in Postgres
with foreign keys.

### Universal Truth 2: The "logical → physical" mapping is the hard part

Every company has logical things (services, APIs, business capabilities) that map onto
physical things (hosts, containers, network interfaces) through intermediate layers
(runtimes, orchestrators, load balancers). The mapping is many-to-many, it changes over
time, and it's the primary thing that breaks during incidents. **The model must keep
logical and physical identity strictly separate but linked.**

### Universal Truth 3: Lifecycle state is richer than "running or not"

Across every company studied, deployments go through states that simple monitoring can't
capture: provisioning, active, draining, migrating, frozen-legacy, deprecated-but-running,
decommissioning, archived. **Lifecycle state is an operational property, not a monitoring
property.**

### Universal Truth 4: Ownership is the most important metadata

In every incident, outage, and planning meeting, the first question is "who owns this?"
Not which server it's on, not which container runtime — who is the human being responsible?
**Owner (team, individual, and escalation path) must be a mandatory field on every entity
in the model.**

### Universal Truth 5: The same logical service takes radically different physical forms

This is Lepton's core challenge: Trafficure deployed as a Compose stack on one VM for a
small customer looks nothing like Trafficure on a Kubernetes cluster for your shared SaaS,
which looks nothing like Trafficure installed natively on a Windows Server for an enterprise
on-prem customer. **The data model must make this variation a feature, not an exception.**

### Universal Truth 6: You need both "what should be" and "what is"

Desired state (the Helm chart, the Compose file, the Ansible playbook) and observed state
(what's actually running, discovered by agents or probes) are two different things. In
well-managed environments they converge. In reality they drift. **Tracking both and
measuring the delta is the foundation of operational maturity.**

---

## Part III — The Unified Model

### Layer 0: Organization

The outermost container. For most companies this is just "us," but the moment you manage
customer environments or have subsidiaries, you need this.

| Field | Description |
|---|---|
| `org_id` | Unique identifier |
| `name` | "Lepton Software", "Ultratech (customer)", "Samsung India (customer)" |
| `type` | `self`, `customer`, `partner`, `vendor` |
| `compliance_profile` | Default regulatory/security requirements |

### Layer 1: Substrate

The physical or account-level resource you pay for. Substrates nest.

| Field | Description |
|---|---|
| `substrate_id` | Unique identifier |
| `parent_substrate_id` | For nesting (region inside cloud account, rack inside datacenter) |
| `org_id` | Who owns/pays for this |
| `type` | `bare-metal`, `cloud-account`, `cloud-region`, `datacenter`, `rack`, `hypervisor-cluster`, `edge-site`, `customer-premises` |
| `provider` | `self-hosted`, `aws`, `azure`, `gcp`, `oracle`, `customer-managed` |
| `location` | Physical location or cloud region identifier |
| `access_mechanism` | How engineers reach things here: `direct`, `vpn`, `jump-box`, `customer-granted`, `no-access` |
| `lifecycle_state` | `active`, `provisioning`, `decommissioning`, `archived` |

**Lepton examples:**
- Substrate: "Lepton Office Datacenter" (type: datacenter)
  - Child: "Proxmox Cluster Alpha" (type: hypervisor-cluster)
- Substrate: "AWS ap-south-1" (type: cloud-region)
  - Parent: "Lepton AWS Account" (type: cloud-account)
- Substrate: "Ultratech Pune Server Room" (type: customer-premises, access: vpn)

### Layer 2: Host

An addressable machine with an OS. Created from a substrate.

| Field | Description |
|---|---|
| `host_id` | Unique identifier |
| `substrate_id` | Which substrate this lives on |
| `pool_id` | Optional — which fungible pool this belongs to |
| `hostname` | Network hostname |
| `os` | `ubuntu-24.04`, `windows-server-2022`, `proxmox-ve-8`, `rhel-9` |
| `arch` | `x86_64`, `arm64` |
| `role` | `app-server`, `db-server`, `k8s-node`, `developer-vm`, `build-agent`, `jump-box`, `gateway` |
| `capabilities` | Tags: `gpu`, `high-memory`, `ssd-storage`, `customer-network-access` |
| `lifecycle_state` | `provisioning`, `active`, `draining`, `maintenance`, `frozen`, `decommissioning` |
| `owner_team` | Responsible team |
| `provisioned_by` | `terraform`, `ansible`, `manual`, `proxmox-ui`, `cloud-formation` |

**The Pool concept** (optional grouping):

| Field | Description |
|---|---|
| `pool_id` | Unique identifier |
| `name` | "Proxmox VM Pool", "K8s Worker Node Pool", "Developer VMs", "Build Agent Fleet" |
| `substrate_id` | Where this pool lives |
| `scaling_policy` | `fixed`, `auto-scaling`, `on-demand` |
| `min_size` / `max_size` | Pool boundaries |

### Layer 3: Runtime

The workload execution environment on a host. A host can have multiple runtimes.

| Field | Description |
|---|---|
| `runtime_id` | Unique identifier |
| `host_id` | Which host (or `null` for serverless/managed runtimes) |
| `type` | `os-native`, `docker-engine`, `docker-compose`, `kubernetes-cluster`, `k8s-namespace`, `lxc`, `application-server`, `serverless-platform`, `batch-scheduler` |
| `version` | Runtime version (Docker 24.0, K8s 1.29, etc.) |
| `orchestrator` | For k8s: which cluster. For Compose: which project. For native: `systemd` or `windows-services` |
| `lifecycle_state` | `active`, `upgrading`, `deprecated` |

**Key insight:** Kubernetes has two levels of runtime. The *cluster* is a runtime (it
schedules and supervises workloads). A *namespace* within the cluster is also a runtime
(it provides isolation and resource boundaries). The model should allow runtimes to nest:
k8s-cluster → k8s-namespace.

**Lepton examples:**
- Host "prod-vm-01" → Runtime: docker-compose (project: trafficure-stack)
- Host "k8s-worker-03" → Runtime: kubernetes-cluster (cluster: lepton-prod)
  - Child Runtime: k8s-namespace (namespace: trafficure-prod)
  - Child Runtime: k8s-namespace (namespace: smartmarket-prod)
- Host "win-server-05" → Runtime: os-native (orchestrator: windows-services)

### Layer 4: Network Fabric

The connective tissue between everything. This is the layer most teams forget to model.

| Field | Description |
|---|---|
| `network_entity_id` | Unique identifier |
| `type` | `load-balancer`, `reverse-proxy`, `dns-record`, `vpn-tunnel`, `firewall-rule`, `cdn-distribution`, `service-mesh`, `api-gateway`, `ip-allowlist`, `tls-certificate` |
| `name` | "Traefik Production Gateway", "Ultratech VPN", "*.trafficure.com wildcard cert" |
| `connects` | List of deployment_ids or host_ids this entity routes between |
| `owner_team` | Responsible team |
| `lifecycle_state` | `active`, `expiring-soon`, `deprecated` |
| `expiry` | For certs, DNS registrations, VPN agreements |

**Lepton examples:**
- Traefik gateway (type: reverse-proxy) → routes to multiple deployments
- Let's Encrypt wildcard cert for *.trafficure.com (type: tls-certificate, expiry: 90 days)
- VPN tunnel to Ultratech Pune (type: vpn-tunnel, connects: [ultratech-prod-deployment])

### Layer 5: Service (Logical Identity)

The thing in your architecture diagram. Runtime-agnostic, deployment-agnostic.

| Field | Description |
|---|---|
| `service_id` | Unique identifier |
| `name` | "Trafficure API", "Trafficure Web UI", "SmartMarket Ingestion Pipeline" |
| `type` | `application`, `library`, `infrastructure-tool`, `data-store`, `message-bus`, `observability`, `ci-cd` |
| `owner_team` | Responsible team |
| `source_repo` | Git repository URL |
| `runtime_requirements` | What it needs: `linux-only`, `jvm-11+`, `gpu-required`, `windows-dotnet` |
| `dependencies` | List of other service_ids it depends on |
| `api_contract` | OpenAPI spec, gRPC proto, or "none" |
| `current_version` | Latest released version |

**Important:** Infrastructure tools are services too. Your Grafana, your GitLab Runner,
your Ory Kratos, your SpiceDB — they all have versions, owners, dependencies, and
deployments. They belong in the inventory alongside your application services.

### Layer 6: Managed Dependency

Third-party services you use but don't deploy. These show up in your architecture and your
incidents but you have no workload to manage.

| Field | Description |
|---|---|
| `dependency_id` | Unique identifier |
| `name` | "AWS RDS Postgres (prod)", "Cloudflare DNS", "SendGrid", "GitHub Actions" |
| `provider` | "aws", "cloudflare", "sendgrid", "github" |
| `type` | `database`, `cache`, `queue`, `email`, `dns`, `cdn`, `ci-cd`, `auth`, `monitoring` |
| `substrate_id` | Which cloud account/region (if applicable) |
| `sla` | Vendor's published SLA |
| `used_by` | List of service_ids that depend on this |
| `owner_team` | Internal team responsible for the relationship and billing |

### Layer 7: Deployment (The Join Table)

This is the single most important entity in the model. It binds everything together:
a specific version of a service, running on a specific runtime, for a specific tenant,
in a specific environment.

| Field | Description |
|---|---|
| `deployment_id` | Unique identifier |
| `service_id` | What service |
| `version` | What version is deployed |
| `runtime_id` | Where it runs (which runtime on which host) |
| `environment` | `production`, `staging`, `preview`, `development`, `sandbox`, `dr` |
| `tenant` | `internal`, `shared-saas`, or specific customer org_id |
| `topology` | `single-node`, `clustered`, `managed-cloud`, `on-prem-managed`, `on-prem-unmanaged`, `edge`, `serverless` |
| `deployment_mode` | `live`, `canary`, `blue-green-active`, `blue-green-standby`, `shadow`, `dark-launch` |
| `deployment_mechanism` | `docker-compose`, `helm-chart`, `ansible-playbook`, `terraform`, `native-installer`, `manual`, `gitops-flux`, `gitops-argo` |
| `config_source` | Where configuration comes from: git path, Vault path, ConfigMap name |
| `config_overlays` | Tenant-specific or environment-specific configuration overrides |
| `lifecycle_state` | See below |
| `sla_tier` | `best-effort`, `business-hours`, `24x7-standard`, `24x7-critical` |
| `compliance_tags` | `data-residency-india`, `sox-compliant`, `gdpr-subject`, `air-gapped` |
| `owner_team` | Team responsible for this specific deployment |
| `last_deployed_at` | Timestamp |
| `last_verified_at` | Timestamp — when we last confirmed observed = desired state |
| `drift_status` | `converged`, `drifted`, `unknown` (for unmanaged/unreachable deployments) |
| `provenance` | Who created this deployment and from what blueprint |
| `blast_radius` | What tenants/services are affected if this deployment fails |

**Lifecycle States for Deployments:**

```
provisioning → active → [draining | migrating-source] → decommissioning → archived
                  ↓
            frozen-legacy (can't update, can't decommission)
                  ↓
            deprecated-but-running (scheduled for removal)
```

- `provisioning` — Being set up, not yet serving traffic
- `active` — Running and serving its intended purpose
- `draining` — Still running but being emptied of traffic
- `migrating-source` — Running in parallel with a replacement, being compared
- `migrating-target` — The replacement, receiving shadow or partial traffic
- `frozen-legacy` — Cannot be updated due to risk/knowledge-loss, but cannot be removed
- `deprecated-but-running` — Marked for removal, timeline exists
- `decommissioning` — Actively being torn down
- `archived` — Record kept for audit trail, nothing running

**Lepton deployment examples:**

```
Deployment: trafficure-api-ultratech-prod
  service: Trafficure API
  version: 2.3.1
  runtime: docker-compose on ultratech-pune-vm-01
  environment: production
  tenant: ultratech
  topology: single-node
  mechanism: docker-compose
  sla_tier: 24x7-standard
  access: vpn
  drift_status: unknown (last verified 2 weeks ago)

Deployment: trafficure-api-shared-saas-prod
  service: Trafficure API
  version: 2.4.0
  runtime: k8s-namespace "trafficure-prod" on lepton-prod-cluster
  environment: production
  tenant: shared-saas
  topology: clustered
  mechanism: helm-chart
  sla_tier: 24x7-critical
  deployment_mode: live
  drift_status: converged

Deployment: trafficure-api-pr-1847-preview
  service: Trafficure API
  version: branch/feature-network-planner-v2
  runtime: docker-compose on preview-pool-vm-03
  environment: preview
  tenant: internal
  topology: single-node
  mechanism: docker-compose (auto-deployed by CI)
  sla_tier: best-effort
  lifecycle_state: active (auto-expires in 48h)
```

---

## Part IV — The Vocabulary Card

A quick-reference glossary your team can pin to their wall or Slack channel.

### The Six Layers + Two Supporting Entities

| Term | One-liner | Example |
|---|---|---|
| **Substrate** | The thing you pay for. Physical or account-level. | Proxmox host, AWS account, customer's server room |
| **Host** | An addressable machine with an OS. | A VM, an EC2 instance, a bare-metal server |
| **Runtime** | How workloads get scheduled and supervised on a host. | Docker Compose project, K8s namespace, systemd, Windows Services |
| **Service** | A logical identity in your architecture. Deployment-agnostic. | "Trafficure API", "Grafana", "Ory Kratos" |
| **Deployment** | A specific service version running in a specific place for a specific purpose. | Trafficure API v2.3.1 on Ultratech's VM, production |
| **Workload** | A single running unit within a deployment. | A container, a pod, a Windows Service process, a systemd unit |
| **Network Fabric** | Connective entities: load balancers, DNS, VPNs, certs, gateways. | Traefik gateway, VPN to Ultratech, wildcard TLS cert |
| **Managed Dependency** | Third-party services you use but don't deploy. | RDS Postgres, Cloudflare DNS, SendGrid |

### The Five Dimensions

| Dimension | Values | Answers |
|---|---|---|
| **Environment** | `production`, `staging`, `preview`, `development`, `sandbox`, `dr` | "How scared should I be if this breaks?" |
| **Tenant** | `internal`, `shared-saas`, or a customer name | "Who is this for?" |
| **Topology** | `single-node`, `clustered`, `managed-cloud`, `on-prem-managed`, `on-prem-unmanaged`, `edge`, `serverless` | "What shape is this deployment?" |
| **Deployment Mode** | `live`, `canary`, `shadow`, `blue-green-active`, `blue-green-standby` | "How is traffic reaching this?" |
| **Lifecycle State** | `provisioning`, `active`, `draining`, `migrating`, `frozen-legacy`, `deprecated`, `decommissioning`, `archived` | "What's the operational status?" |

### Words to Stop Using (and What to Say Instead)

| Instead of... | Say... | Because... |
|---|---|---|
| "server" (ambiguous) | **substrate**, **host**, or **service** depending on context | "Server" conflates three layers |
| "instance" (ambiguous) | **host** (for VMs/machines) or **deployment** (for "an instance of our product") | Same word, two completely different concepts |
| "box" | **host** | Informal but clear |
| "cluster" (ambiguous) | **substrate cluster** (Proxmox), **runtime cluster** (K8s), or **service replicas** | Three different things called "cluster" |
| "environment" (meaning a server) | **host** or **deployment** | Environment is a lifecycle stage, not a machine |
| "container" (when you mean the service) | **workload** (runtime-agnostic) or **service** (if you mean the logical thing) | Not everything runs in containers |
| "stack" (ambiguous) | **deployment** (if you mean "our stuff running somewhere") or **runtime** (if you mean "the technology stack on a host") | "Stack" means everything and nothing |
| "infra" (as a catch-all) | Be specific: **substrate**, **host**, **runtime**, **network fabric** | Forces clarity about which layer you mean |

### Quick Decision Tree for Conversations

```
Someone mentions a thing. What is it?

Can you physically touch it or does it appear on a cloud bill?
  → SUBSTRATE (datacenter, rack, cloud account, hypervisor)

Does it have an IP address and an OS?
  → HOST (VM, bare-metal server, EC2 instance)

Is it what supervises/schedules processes on a host?
  → RUNTIME (Docker, K8s, systemd, Windows Services)

Is it a logical capability your system provides?
  → SERVICE (Trafficure API, auth service, monitoring)

Is it a specific version of a service running in a specific place?
  → DEPLOYMENT (v2.3.1 on Ultratech's server, production)

Is it a single running process/container within a deployment?
  → WORKLOAD (one container, one pod, one systemd unit)

Does it route traffic or connect things?
  → NETWORK FABRIC (load balancer, DNS, VPN, cert, gateway)

Is it something you pay for but don't operate?
  → MANAGED DEPENDENCY (RDS, S3, SendGrid, Cloudflare)
```

---

## Part V — The Relationship Map

```
Organization
  └── owns Substrates
        └── Substrates nest (cloud account → region → VPC)
              └── hosts Hosts
                    └── Hosts belong to Pools (optional)
                    └── Hosts run Runtimes
                          └── Runtimes nest (k8s cluster → namespace)
                                └── Runtimes host Deployments
                                      └── Deployments are instances of Services
                                      └── Deployments contain Workloads
                                      └── Deployments connect via Network Fabric
                                      └── Deployments depend on Managed Dependencies
                                      └── Deployments have Config Overlays per tenant

Services
  └── depend on other Services (dependency graph)
  └── depend on Managed Dependencies
  └── have multiple Deployments across environments/tenants
```

---

## Part VI — What This Enables

Once this model is internalized by your team, these conversations become trivial:

**Incident response:** "The Trafficure API deployment for Ultratech production is
returning 500s" → Look up deployment record → find host, runtime, access mechanism,
owner team, blast radius, dependencies. No guessing, no "wait which server is that on?"

**Capacity planning:** "How many deployments are running on single-node topology?" → Query
deployments by topology. "Which substrates are at capacity?" → Query hosts per substrate
with resource utilization.

**Migration planning:** "We want to move customer X from single-node Compose to Kubernetes."
→ Create new deployment record with `lifecycle_state: provisioning`, mark old one as
`migrating-source`, track both until cutover, then archive the old one.

**Audit & compliance:** "Show me all deployments with `data-residency-india` that are
running on substrates outside India." → Direct query across deployments and substrates.

**Developer onboarding:** "I'm new. Where does our stuff run?" → Browse the service
catalog, click any service, see all its deployments across every environment and tenant.

**Drift detection:** "Which customer deployments haven't been verified in 30+ days?" →
Query deployments where `last_verified_at < now() - 30 days`.
