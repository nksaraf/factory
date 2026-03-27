# Infrastructure Plane — Product Requirements Document

**Document Owner:** Nikhil
**Version:** 0.1 (Draft)
**Last Updated:** March 2026
**Status:** RFC — Request for Comments

---

## 1. Purpose

The Infrastructure Plane is the substrate that every other plane runs on. It is the only plane that spans both Factory and Site. It provides compute, storage, networking, PKI, and secrets to all other planes — and it does so through contracts, never by exposing primitives directly.

At Factory scope, it provisions and manages global infrastructure — clusters, networks, registries, and certificate authorities. At Site scope, it operates the local runtime — ingress, service routing, compute scheduling, storage, and secrets.

Both scopes are the same plane operating at different scales with different authority boundaries.

---

## 2. Design Principles

1. **Contract-driven.** No plane interacts with infrastructure primitives directly. Every plane consumes Infrastructure through named contracts with defined inputs and outputs.
2. **Site autonomy is non-negotiable.** Site Infrastructure must operate fully without Factory connectivity. Air-gapped and sovereign deployments are first-class.
3. **Substrate agnosticism.** The same contracts work whether the substrate is cloud Kubernetes, Proxmox bare-metal, or a customer-managed cluster. The contract is the abstraction boundary.
4. **Infrastructure is not policy.** Infrastructure executes policies declared by Control Plane. It never decides what policy should be — it decides how to implement it.
5. **Idempotent and declarative.** All Factory-to-Site pushes are idempotent. Desired state is declared, not imperatively mutated.
6. **Observable by default.** Every infrastructure component emits metrics, logs, and traces in OpenTelemetry format. Control Plane collects — Infrastructure produces.
7. **Minimal blast radius.** Failure in one Site's infrastructure does not propagate to other Sites or to the Factory.

---

## 3. Scope Boundary

### What Infrastructure Plane owns

- Cluster lifecycle (provisioning, upgrades, decommissioning)
- Compute scheduling (Kubernetes pod scheduling, autoscaling, resource quotas)
- Ingress and API gateway (Traefik)
- Service-to-service networking and routing
- Object storage (MinIO)
- Block/volume storage provisioning
- PKI and certificate management
- Secrets management and injection
- Container registry operations
- DNS management
- Egress control
- Network segmentation and security groups

### What Infrastructure Plane does not own

- Database lifecycle (Data Plane owns Postgres/PostGIS — Infrastructure provides the compute and storage underneath)
- Tenant resolution or identity (Control Plane)
- Business logic or module execution (Service Plane)
- Billing, licensing, or entitlements (Commerce Plane)
- Deployment orchestration decisions (Fleet Plane decides what goes where — Infrastructure executes)
- Caching layer lifecycle (Data Plane owns Redis — Infrastructure provides the substrate)

### The boundary with Data Plane

Infrastructure provisions the raw substrate — a Kubernetes namespace, persistent volumes, compute resources. Data Plane owns everything above that: database instances, schemas, RLS policies, replication, backups, indexes. Infrastructure does not know or care that PostgreSQL is running. It provides a PersistentVolumeClaim, CPU, and memory. Data Plane takes it from there.

---

## 4. Architecture

### 4.1 Two Scopes, One Plane

```
Infrastructure Plane

┌─────────────────────────────────────────────────────────┐
│                    Factory Scope                         │
│                                                          │
│  Cluster provisioning    Container registry               │
│  Global networking       PKI / Root CA                    │
│  Cross-site mesh         Capacity planning                │
│  Fleet infra ops         Image scanning                   │
│                                                          │
│  Substrate: Cloud K8s (SaaS) + Proxmox (on-prem/self)   │
└──────────────────────────┬──────────────────────────────┘
                           │ provisions, configures,
                           │ pushes certs/configs
                           │ (async, idempotent)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Site Scope                           │
│                                                          │
│  Ingress (Traefik)       Compute scheduling (K8s)        │
│  Service routing         Volume provisioning              │
│  Object storage (MinIO)  Local secrets                    │
│  Egress control          Certificate distribution         │
│  Network policies        Observability substrate          │
│                                                          │
│  Operates independently of Factory at runtime             │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Substrate Model

The Infrastructure Plane abstracts over two substrate families:

| Substrate                | Used For                                              | Technology                  |
| ------------------------ | ----------------------------------------------------- | --------------------------- |
| Cloud Kubernetes         | SaaS shared Sites, SaaS dedicated Sites               | EKS / GKE / AKS             |
| Proxmox + bare-metal K8s | On-premise, self-hosted, air-gapped, partner-operated | Proxmox VE + k3s or kubeadm |

The contract layer makes this invisible to all other planes. A `VolumeRequest` contract works identically whether it results in an AWS EBS volume or a Proxmox LVM allocation. The consuming plane never knows.

### 4.3 Service Naming

Following Platform Fabric convention:

```
Factory:
  factory-infra-api
  factory-infra-cluster-manager
  factory-infra-cert-manager
  factory-infra-registry
  factory-infra-network-manager

Site:
  site-infra-api
  site-infra-gateway
  site-infra-storage
  site-infra-secrets
  site-infra-network
```

---

## 5. Factory Infrastructure

### 5.1 Cluster Management

Factory Infrastructure provisions and manages the Kubernetes clusters that Sites run on.

**Responsibilities:**

- Cluster creation for new Sites (cloud or Proxmox)
- Kubernetes version upgrades and patching
- Node pool management and autoscaling policies
- Cluster decommissioning
- Cluster health monitoring

**For cloud SaaS Sites:**

- Provision managed Kubernetes clusters (EKS/GKE/AKS)
- Configure node pools with appropriate instance types
- Set up cluster autoscaler
- Integrate with cloud IAM for initial bootstrap

**For Proxmox / on-prem Sites:**

- Provision VMs on Proxmox
- Bootstrap Kubernetes (k3s for lightweight, kubeadm for full control)
- Manage node lifecycle (add, drain, remove)
- Storage class provisioning on local disks or SAN

**For customer-managed clusters (self-hosted):**

- Produce cluster specification documents (minimum requirements, networking prerequisites, storage classes needed)
- Validate cluster readiness before Site bootstrap
- Provide diagnostic tooling

**Contract: ClusterProvision**

```
Input:
  site_id: string
  substrate: cloud | proxmox | customer_managed
  region: string
  provider: aws | gcp | azure | proxmox | customer
  node_pools:
    - name: string
      instance_type: string
      min_nodes: int
      max_nodes: int
      labels: map
  kubernetes_version: string

Output:
  cluster_id: string
  kubeconfig_ref: secret_ref
  api_endpoint: string
  status: provisioning | ready | failed
```

**Contract: ClusterUpgrade**

```
Input:
  cluster_id: string
  target_kubernetes_version: string
  strategy: rolling | blue_green
  node_pool_overrides: optional

Output:
  upgrade_id: string
  status: scheduled | in_progress | completed | rolled_back
```

---

### 5.2 Container Registry

Factory operates the container registry that stores all module artifacts.

**Responsibilities:**

- Registry hosting and availability
- Image replication across regions (for multi-region SaaS)
- Image scanning and vulnerability reporting
- Garbage collection and retention policies
- Access control (Build Plane pushes, Sites pull)
- Mirror support for air-gapped deployments (export images to tarball)

**For air-gapped Sites:**

- Produce offline image bundles as part of the release process
- Include registry bootstrap tooling in the offline installer
- Customer loads images into their local registry (which Site Infrastructure then uses)

**Contract: ImagePull**

```
Input:
  image: string (e.g., registry.platform.io/geoanalytics-service)
  tag_or_digest: string
  site_id: string (for access control)

Output:
  image_ref: string (pullable reference)
  verified: bool
  sbom_ref: optional string
```

**Contract: OfflineBundleExport**

```
Input:
  release_id: string
  modules: list[module_version_id]

Output:
  bundle_path: string
  bundle_checksum: string
  manifest: list[image_ref]
```

---

### 5.3 Global Networking

Factory manages cross-site and Factory-to-Site network connectivity.

**Responsibilities:**

- VPC / network provisioning for cloud Sites
- Cross-site connectivity mesh (for multi-site customers that need it)
- Factory-to-Site management channel (TLS, mTLS)
- Global DNS zone management
- Firewall rules and security group templates
- CDN configuration (if applicable for static assets)

**For air-gapped Sites:**

- No persistent network connectivity
- Management happens through offline bundles and one-way data export
- Factory never assumes real-time reachability to any Site

**Contract: SiteNetworkProvision**

```
Input:
  site_id: string
  substrate: cloud | proxmox | customer_managed
  cidr_range: string (suggested, may be overridden)
  connectivity_mode: connected | air_gapped
  dns_zone: optional string

Output:
  network_id: string
  assigned_cidr: string
  dns_entries: list[dns_record]
  management_channel: optional endpoint
```

---

### 5.4 PKI and Certificate Management

Factory operates the root and intermediate certificate authorities.

**Responsibilities:**

- Root CA management (offline, hardware-secured)
- Intermediate CA issuance per Site
- Certificate issuance for Site ingress, service mesh, and inter-plane communication
- Certificate rotation policies
- mTLS certificate distribution to Sites
- CRL / OCSP for connected deployments

**For air-gapped Sites:**

- Intermediate CA and initial certificates bundled in the offline release package
- Certificate renewal bundled with upgrade packages
- Site can operate with long-lived certificates (configurable expiry)

**Contract: CertificateIssue**

```
Input:
  site_id: string
  cert_type: ingress | mesh | management
  common_name: string
  san: list[string]
  validity_days: int

Output:
  certificate_ref: secret_ref
  expiry: datetime
  issuer: string
  fingerprint: string
```

**Contract: CertificateRotation**

```
Input:
  site_id: string
  cert_type: ingress | mesh | management
  strategy: in_place | blue_green

Output:
  new_certificate_ref: secret_ref
  old_certificate_expiry: datetime
  rotation_status: scheduled | in_progress | completed
```

---

### 5.5 Capacity Planning and Cost Monitoring

Factory Infrastructure tracks resource utilization across all Sites.

**Responsibilities:**

- Resource utilization tracking per Site (CPU, memory, storage, network)
- Capacity forecasting (when will a shared Site need more nodes?)
- Cost monitoring and allocation per Site, per namespace, per product
- Alerting on capacity thresholds
- Right-sizing recommendations

**Contract: SiteCapacityReport**

```
Input:
  site_id: string
  period: time_range

Output:
  cpu_utilization: percentage
  memory_utilization: percentage
  storage_utilization: percentage
  node_count: int
  cost_estimate: decimal (for cloud substrates)
  recommendations: list[recommendation]
```

---

## 6. Site Infrastructure

### 6.1 Ingress and API Gateway

**Technology:** Traefik

Site Infrastructure operates the ingress layer that all external traffic enters through.

**Responsibilities:**

- TLS termination
- HTTP/HTTPS routing
- Load balancing across Service Plane pods
- Rate limiting execution (policy from Control Plane)
- Request size limits
- WebSocket support
- DDoS protection (basic — cloud-level DDoS protection is outside scope)
- Health check endpoints
- CORS configuration

**Policy-execution pattern:**

Control Plane declares: "Rate limit tenant X to 100 req/min on /api/\*"
Infrastructure configures: Traefik middleware with the rate limit rule.

Control Plane declares: "Block IP range 10.0.0.0/8 from external access"
Infrastructure configures: Traefik IP allowlist/denylist.

**Contract: IngressRouteRequest**

```
Input:
  service_name: string
  namespace: string
  match_rule: string (e.g., "Host(`api.platform.com`) && PathPrefix(`/v1`)")
  tls: bool
  middlewares: list[middleware_ref]
  priority: optional int

Output:
  route_id: string
  status: active | pending | error
  external_url: string
```

**Contract: RateLimitPolicy (consumed from Control Plane)**

```
Input:
  scope: tenant | namespace | global
  scope_id: string
  path_pattern: string
  requests_per_minute: int
  burst: optional int

Output:
  middleware_ref: string
  status: applied | pending
```

---

### 6.2 Service Routing and Discovery

In Phase 1, service-to-service communication uses Kubernetes-native networking. Phase 2 introduces a service mesh.

**Phase 1 — Kubernetes-native:**

- ClusterIP services for internal routing
- Kubernetes DNS for service discovery
- Network policies for inter-namespace isolation
- No mTLS between services (TLS terminates at ingress)

**Phase 2 — Service mesh (technology TBD, evaluate Linkerd vs Istio):**

- Service-to-service mTLS
- Traffic splitting (canary, blue-green)
- Circuit breakers and retries
- Distributed tracing injection
- Fine-grained traffic policies

**Contract: ServiceExpose**

```
Input:
  service_name: string
  namespace: string
  port: int
  protocol: http | grpc | tcp
  visibility: cluster_internal | site_internal | external

Output:
  service_endpoint: string (e.g., site-service-api.service-plane.svc.cluster.local:8080)
  dns_name: string
```

**Contract: NetworkPolicyRequest**

```
Input:
  source_namespace: string
  target_namespace: string
  allowed_ports: list[int]
  direction: ingress | egress | both

Output:
  policy_id: string
  status: applied | pending
```

---

### 6.3 Compute Scheduling

Site Infrastructure manages Kubernetes workload scheduling.

**Responsibilities:**

- Kubernetes namespace provisioning per plane (fleet-plane, service-plane, data-plane)
- Pod scheduling and placement
- Horizontal Pod Autoscaler (HPA) configuration
- Resource quotas per namespace (CPU, memory limits)
- Node affinity and anti-affinity rules
- Priority classes for critical workloads (Control Plane pods get highest priority)
- Pod disruption budgets

**Contract: NamespaceProvision**

```
Input:
  namespace_name: string
  plane: control | service | data
  resource_quota:
    cpu_limit: string (e.g., "8")
    memory_limit: string (e.g., "16Gi")
    storage_limit: string (e.g., "100Gi")
    pod_limit: int
  labels: map
  network_policies: list[policy_ref]

Output:
  namespace: string
  quota_applied: bool
  status: active | pending
```

**Contract: WorkloadDeploy**

```
Input:
  namespace: string
  workload_name: string
  workload_type: deployment | statefulset | job | cronjob
  image: string
  replicas: int
  resources:
    cpu_request: string
    cpu_limit: string
    memory_request: string
    memory_limit: string
  env_from_secrets: list[secret_ref]
  volumes: list[volume_ref]
  health_check:
    path: string
    port: int
    interval_seconds: int

Output:
  workload_id: string
  status: running | pending | failed
  endpoints: list[string]
```

---

### 6.4 Storage

Site Infrastructure provides two storage tiers.

#### Object Storage (MinIO)

**Responsibilities:**

- MinIO instance lifecycle within the Site
- Bucket creation and access policies
- Tenant-scoped bucket prefixes (policy from Control Plane)
- Storage quota enforcement
- Lifecycle rules (expiry, archival)
- Replication configuration (if cross-site replication is needed)

**Contract: BucketRequest**

```
Input:
  bucket_name: string
  namespace_id: string
  access_policy: private | read_only | read_write
  quota_gb: optional int
  lifecycle_rules: optional list[rule]
  versioning: bool

Output:
  bucket_endpoint: string
  access_key_ref: secret_ref
  secret_key_ref: secret_ref
  status: created | pending
```

#### Block / Volume Storage

**Responsibilities:**

- PersistentVolume provisioning
- Storage class management (SSD, HDD, network-attached)
- Volume expansion
- Snapshot support (for Data Plane backup workflows)
- Storage performance tiers

**Contract: VolumeRequest**

```
Input:
  name: string
  namespace: string
  storage_class: ssd | hdd | network
  size_gb: int
  access_mode: read_write_once | read_write_many | read_only_many
  snapshot_policy: optional policy_ref

Output:
  pvc_name: string
  bound: bool
  actual_size_gb: int
  storage_class_used: string
```

---

### 6.5 Secrets Management

Site Infrastructure manages secrets injection and encryption keys.

**Phase 1:** Kubernetes Secrets with encryption at rest (EncryptionConfiguration).
**Phase 2:** Evaluate HashiCorp Vault or equivalent for advanced use cases.

**Responsibilities:**

- Secret creation and storage
- Secret injection into pods (via environment variables or volume mounts)
- Encryption key management (data-at-rest keys for Data Plane)
- Certificate distribution (from Factory CA)
- Secret rotation support
- Audit trail of secret access (feeds into Control Plane audit)

**Contract: SecretStore**

```
Input:
  secret_name: string
  namespace: string
  data: map[string, string] (encrypted in transit)
  rotation_policy: optional
    interval_days: int
    notify_service: string

Output:
  secret_ref: string
  version: int
  created_at: datetime
```

**Contract: SecretInject**

```
Input:
  workload_name: string
  namespace: string
  secrets: list
    - secret_ref: string
      mount_type: env | volume
      mount_path: optional string (for volume mounts)

Output:
  injected: bool
  secret_versions: map[secret_ref, version]
```

---

### 6.6 Egress Control

Site Infrastructure controls outbound traffic.

**Responsibilities:**

- Default-deny egress policy (whitelist model)
- Allowlist management per namespace
- Egress gateway for audited outbound connections
- Zero-egress mode for air-gapped deployments (no outbound traffic at all)
- Proxy configuration for Sites behind corporate proxies

**Contract: EgressPolicy**

```
Input:
  namespace: string
  rules:
    - destination: string (domain or CIDR)
      ports: list[int]
      protocol: tcp | udp
  mode: allowlist | denylist | zero_egress

Output:
  policy_id: string
  status: applied | pending
```

---

### 6.7 DNS Management (Site-Local)

**Responsibilities:**

- Internal DNS for service discovery (Kubernetes CoreDNS)
- External DNS record management (for Site-specific domains)
- Split-horizon DNS for Sites that need both internal and external resolution

**Contract: DNSRecordRequest**

```
Input:
  record_type: A | CNAME | TXT
  name: string
  value: string
  ttl: int
  zone: internal | external

Output:
  record_id: string
  fqdn: string
  status: active | pending | propagating
```

---

## 7. Cross-Boundary Communication

### 7.1 Factory → Site (Push)

Factory Infrastructure pushes configuration and updates to Sites. All pushes are asynchronous and idempotent.

**What gets pushed:**

- Cluster configuration updates
- Certificate renewals
- Network policy updates
- Capacity adjustments (node pool scaling)
- Image pre-pull directives (warm caches before rollout)
- Upgrade instructions (coordinated with Fleet Plane)

**Mechanism (connected Sites):**

- Factory publishes desired state to a per-Site config channel
- Site Infrastructure reconciles local state against desired state
- Acknowledgment sent back to Factory

**Mechanism (air-gapped Sites):**

- All pushes bundled into an offline update package
- Transferred via physical media or one-way data diode
- Site operator applies the bundle manually
- No real-time acknowledgment — Factory tracks last-known state

### 7.2 Site → Factory (Report)

Site Infrastructure reports status back to Factory.

**What gets reported:**

- Resource utilization (CPU, memory, storage, network)
- Certificate expiry status
- Infrastructure health (node status, pod restarts, storage pressure)
- Cluster version and component versions
- Capacity headroom

**Mechanism (connected Sites):**

- Periodic heartbeat with health snapshot
- Metrics export pipeline (OpenTelemetry → Factory collector)

**Mechanism (air-gapped Sites):**

- Health snapshots stored locally
- Exported as signed diagnostic bundles on request
- Support team can request specific diagnostic data

### 7.3 Communication Patterns by Deployment Model

| Model                 | Factory → Site           | Site → Factory     | Latency Tolerance |
| --------------------- | ------------------------ | ------------------ | ----------------- |
| SaaS shared           | Direct API / config push | Real-time metrics  | Seconds           |
| SaaS dedicated        | Direct API / config push | Real-time metrics  | Seconds           |
| Connected self-hosted | Async config channel     | Periodic heartbeat | Minutes           |
| Air-gapped            | Offline bundle           | Manual export      | Days to weeks     |

---

## 8. Policy Execution Model

Infrastructure Plane executes policies declared by other planes. It never originates policy.

### 8.1 Policies from Control Plane

| Control Plane declares                        | Infrastructure executes                             |
| --------------------------------------------- | --------------------------------------------------- |
| Rate limit tenant X to 100 req/min            | Traefik middleware configuration                    |
| Encrypt data at rest with AES-256             | StorageClass encryption configuration               |
| Block access from IP range                    | Traefik IP filter middleware                        |
| Enforce mTLS between services (Phase 2)       | Service mesh mTLS policy                            |
| Backup retention: 7 years                     | Volume snapshot schedule (substrate for Data Plane) |
| Resource quota: 500GB storage for namespace Y | Kubernetes ResourceQuota                            |

### 8.2 Instructions from Fleet Plane

| Fleet Plane instructs              | Infrastructure executes              |
| ---------------------------------- | ------------------------------------ |
| Deploy module version X to Site Y  | Pull image, schedule pods            |
| Scale node pool to 5 nodes         | Cluster autoscaler or manual scaling |
| Perform rolling upgrade of cluster | Cordon, drain, upgrade, uncordon     |
| Provision new Site cluster         | Cluster creation workflow            |
| Decommission Site Z                | Cluster teardown, resource cleanup   |

### 8.3 Requests from Data Plane

| Data Plane requests                      | Infrastructure provides                 |
| ---------------------------------------- | --------------------------------------- |
| 500GB persistent volume, SSD tier        | PV provisioned via StorageClass         |
| Object storage bucket for tenant backups | MinIO bucket with access credentials    |
| Compute resources for analytics workload | Pod scheduling with resource guarantees |

### 8.4 Requests from Service Plane

| Service Plane requests                 | Infrastructure provides |
| -------------------------------------- | ----------------------- |
| Expose module API externally           | Traefik IngressRoute    |
| Internal service endpoint for module B | ClusterIP service + DNS |
| Scheduled job execution                | CronJob resource        |

---

## 9. Deployment Model Variations

### 9.1 SaaS Shared (Cloud Kubernetes)

- Factory Infrastructure fully operates the cluster
- Cloud-managed Kubernetes (EKS/GKE/AKS)
- Cloud-native storage (EBS, GCE PD) + MinIO for object storage
- Factory team has full access
- Automated scaling and upgrades

### 9.2 SaaS Dedicated (Cloud Kubernetes)

- Separate cluster per customer
- Same cloud substrate, isolated resources
- Factory team operates, customer has no cluster access
- Network isolation between dedicated clusters

### 9.3 Connected Self-Hosted (Proxmox or Customer Cloud)

- Customer provides infrastructure (Proxmox VMs or their own cloud account)
- Factory provides cluster specifications and bootstrap tooling
- Site Infrastructure operates autonomously
- Factory receives telemetry and can push config updates
- Upgrades coordinated between Factory and customer ops team

### 9.4 Air-Gapped Self-Hosted (Proxmox or Bare Metal)

- Customer provides fully isolated infrastructure
- No network connectivity to Factory
- All artifacts delivered via offline bundles
- Local container registry (customer-operated)
- MinIO deployed locally
- Certificates from bundled intermediate CA
- All secrets generated locally
- Diagnostics exported manually

### 9.5 Substrate Decision Matrix

| Concern              | Cloud K8s                               | Proxmox                                 |
| -------------------- | --------------------------------------- | --------------------------------------- |
| Cluster provisioning | Managed (API calls)                     | Manual or Terraform + Ansible           |
| Node scaling         | Cloud autoscaler                        | Manual or pre-provisioned pools         |
| Storage classes      | Cloud-native (EBS, GCE PD)              | Local LVM, NFS, or Ceph                 |
| Object storage       | MinIO (or cloud-native S3)              | MinIO                                   |
| Load balancer        | Cloud LB + Traefik                      | MetalLB + Traefik                       |
| Certificates         | cert-manager + Let's Encrypt            | cert-manager + Factory CA               |
| Secrets              | K8s Secrets (Phase 1) → Vault (Phase 2) | K8s Secrets (Phase 1) → Vault (Phase 2) |

---

## 10. Data Model

### 10.1 Factory Infrastructure Entities

```
cluster
  cluster_id (PK)
  site_id (FK)
  substrate: cloud | proxmox | customer_managed
  provider: aws | gcp | azure | proxmox | customer
  region: string
  kubernetes_version: string
  status: provisioning | ready | upgrading | decommissioning
  created_at
  updated_at

node_pool
  node_pool_id (PK)
  cluster_id (FK)
  name: string
  instance_type: string
  min_nodes: int
  max_nodes: int
  current_nodes: int
  labels: jsonb
  status: active | scaling | draining

network_segment
  network_id (PK)
  site_id (FK)
  cidr: string
  type: vpc | subnet | overlay
  connectivity_mode: connected | air_gapped

certificate_authority
  ca_id (PK)
  type: root | intermediate
  site_id: optional (FK, null for root)
  public_key_fingerprint: string
  valid_until: datetime
  status: active | revoked | expired

certificate
  cert_id (PK)
  ca_id (FK)
  site_id (FK)
  cert_type: ingress | mesh | management
  common_name: string
  san: list[string]
  valid_until: datetime
  status: active | expiring | expired | revoked

registry
  registry_id (PK)
  endpoint: string
  type: primary | mirror | offline
  site_id: optional (FK, for Site-local registries)

site_health_snapshot
  snapshot_id (PK)
  site_id (FK)
  cpu_utilization: decimal
  memory_utilization: decimal
  storage_utilization: decimal
  node_count: int
  pod_count: int
  alerts: jsonb
  captured_at: datetime
```

### 10.2 Site Infrastructure Entities

```
ingress_route
  route_id (PK)
  service_name: string
  namespace: string
  match_rule: string
  tls: bool
  middlewares: list[string]
  status: active | pending | error

storage_bucket
  bucket_id (PK)
  namespace_id (FK)
  bucket_name: string
  quota_gb: optional int
  versioning: bool
  created_at

persistent_volume
  pv_id (PK)
  namespace: string
  storage_class: string
  size_gb: int
  access_mode: string
  bound_to: optional string (PVC name)
  status: available | bound | released

secret_record
  secret_id (PK)
  namespace: string
  secret_name: string
  version: int
  rotation_due: optional datetime
  last_rotated: optional datetime

egress_policy
  policy_id (PK)
  namespace: string
  mode: allowlist | denylist | zero_egress
  rules: jsonb
  status: applied | pending

network_policy
  policy_id (PK)
  source_namespace: string
  target_namespace: string
  allowed_ports: list[int]
  direction: ingress | egress | both
  status: applied | pending
```

---

## 11. Non-Functional Requirements

### Availability

- Site Infrastructure must have no runtime dependency on Factory. If Factory is unreachable, Sites continue operating without degradation.
- Ingress gateway (Traefik) must support zero-downtime upgrades via rolling restart.
- Control Plane pods receive highest scheduling priority — if nodes are constrained, Service Plane workloads are evicted before Control Plane.

### Performance

- Ingress latency overhead: < 5ms p99 added by Traefik.
- Service discovery resolution: < 1ms (Kubernetes DNS caching).
- Volume provisioning: < 30 seconds for cloud, < 60 seconds for Proxmox.
- Secret injection: available before pod starts, not lazy-loaded.

### Scalability

- Support 1,000+ namespaces per Site (Kubernetes namespace limit is not a concern at this scale).
- Support 10,000+ pods per cluster (requires appropriate node pool sizing).
- MinIO: support 100TB+ per Site for large enterprise deployments.
- Ingress: 10,000+ req/sec per Site with Traefik.

### Security

- All external traffic TLS-terminated at ingress.
- All secrets encrypted at rest in etcd (Kubernetes EncryptionConfiguration).
- Network policies enforce inter-namespace isolation by default (deny-all baseline, explicit allow).
- Egress default-deny with explicit allowlists.
- Container images pulled only from trusted registries (Factory registry or customer-local mirror).

### Observability

- Every infrastructure component exports metrics in Prometheus format.
- Structured logs in JSON format, forwarded to Control Plane's observability stack.
- Traces propagated via OpenTelemetry.
- Health check endpoints on all infrastructure services.
- Factory receives aggregated infrastructure metrics from connected Sites.

---

## 12. Phased Implementation

### Phase 1 — Foundation

**Factory:**

- Single cloud Kubernetes cluster for SaaS (one region)
- Traefik ingress configured
- MinIO deployed for object storage
- Container registry operational (cloud-native or self-hosted)
- Basic PKI: intermediate CA per Site, cert-manager for TLS
- Kubernetes Secrets for secret management (encrypted at rest)
- Manual cluster provisioning (scripted, not fully automated)
- Basic capacity monitoring

**Site:**

- Traefik gateway with TLS termination and routing
- Kubernetes-native service networking (ClusterIP, DNS)
- Network policies for inter-plane namespace isolation
- MinIO instance per Site
- StorageClass configuration for PVs
- Kubernetes Secrets injection
- Default-deny egress with allowlist
- Health check endpoints

**Outcome:** One SaaS shared Site running. Ingress, storage, networking, and secrets functional. No service mesh. Manual-ish cluster operations.

### Phase 2 — Scale

**Factory:**

- Multi-cluster management (multiple regions)
- Automated cluster provisioning (Terraform + Ansible for Proxmox, cloud provider APIs for managed K8s)
- Cross-site networking for connected Sites
- Image replication across regional registries
- Capacity planning and cost monitoring dashboard
- Certificate rotation automation
- Offline bundle generation pipeline for air-gapped Sites

**Site:**

- Service mesh evaluation and deployment (Linkerd or Istio)
- mTLS between all services
- Advanced egress gateway with audit logging
- Vault for secrets management (replaces raw K8s Secrets for sensitive workloads)
- Volume snapshot support for Data Plane backups
- Traffic splitting support (canary, blue-green) for Fleet Plane rollouts

**Outcome:** Multi-region SaaS. Connected self-hosted Sites operational. Service mesh providing mTLS and traffic management. Air-gapped deployment bundles available.

### Phase 3 — Enterprise

**Factory:**

- Multi-cloud abstraction (operate across AWS, GCP, Azure, Proxmox from single management layer)
- Advanced fleet-wide infrastructure analytics
- One-way management channels for sovereign deployments
- Infrastructure-as-code packages for customer-operated Sites
- Automated compliance reporting (infrastructure configuration audits)

**Site:**

- Zero-egress mode fully hardened for air-gapped
- Customer-operated infrastructure support tooling (runbooks, diagnostics, health checks)
- Advanced storage tiering (hot/warm/cold)
- Cross-region replication support at storage layer
- Hardware security module (HSM) integration for key management in regulated environments

**Outcome:** Full deployment spectrum supported. Air-gapped and sovereign Sites fully operational. Multi-cloud. Enterprise-grade security and compliance.

---

## 13. Key Risks and Mitigations

**Substrate fragmentation.** Supporting both cloud K8s and Proxmox doubles the surface area for infrastructure code. Mitigation: the contract layer is the abstraction. Infrastructure internals can have substrate-specific implementations behind the same contract interface. Contracts are tested against both substrates in CI.

**Traefik as single point of entry.** If Traefik goes down, the Site is unreachable. Mitigation: run Traefik as a multi-replica Deployment with PodDisruptionBudget. On cloud, front it with a cloud load balancer. On Proxmox, use MetalLB or keepalived for HA.

**Secret sprawl.** Without discipline, secrets proliferate and rotation becomes unmanageable. Mitigation: Phase 1 uses Kubernetes Secrets with strict naming conventions. Phase 2 introduces Vault with centralized rotation policies. All secrets have mandatory expiry.

**Air-gapped certificate expiry.** If certificates expire in an air-gapped Site, everything breaks. Mitigation: air-gapped certificates are issued with long validity (1-2 years). Monitoring alerts 90 days before expiry. Certificate renewal is included in every upgrade bundle.

**Network policy complexity.** Fine-grained network policies are hard to debug. Mitigation: start with coarse policies (inter-plane isolation). Add finer granularity only when security review demands it. All policies version-controlled and tested.

**MinIO operational burden.** Running MinIO at scale requires operational maturity. Mitigation: start with single-node MinIO in Phase 1. Evaluate distributed MinIO for Phase 2. On cloud SaaS Sites, consider cloud-native S3 as alternative and use MinIO only for on-prem/self-hosted.

---

## 14. Open Questions

1. **Service mesh selection.** Linkerd vs Istio. Linkerd is lighter, Istio is more feature-rich. Decision needed before Phase 2.
2. **Vault timing.** Phase 2 introduces Vault, but should Vault be deployed from Phase 1 for Sites that handle regulated data?
3. **MinIO vs cloud-native S3 for SaaS Sites.** Should SaaS Sites on cloud use MinIO for consistency with on-prem, or use cloud-native S3 for operational simplicity? The contract layer supports either, but the operational model differs.
4. **GPU compute.** If AI/ML workloads (SmartMarket analysis, Agent Plane inference) need GPU, how does Infrastructure Plane handle GPU node pools? Is this Phase 2 or Phase 3?
5. **Cluster-per-Site vs namespace-per-Site for SaaS shared.** For multi-tenant SaaS shared Sites, is each Site a separate Kubernetes cluster or a set of namespaces within a shared cluster? Trade-off: isolation vs resource efficiency.
6. **Monitoring stack ownership.** Infrastructure Plane produces metrics, Control Plane collects them. But who owns Prometheus/Grafana deployment — Infrastructure or Control Plane? The platform fabric overview says Control Plane owns observability, but the infrastructure to run Prometheus is Infrastructure Plane's job. Needs explicit boundary.
7. **Backup orchestration.** Data Plane owns database backups. Infrastructure Plane owns volume snapshots. Who orchestrates the end-to-end backup workflow that combines both? Control Plane (as governance) or Data Plane (as data owner)?

---

## Appendix A: Contract Index

| Contract             | Scope   | Provider                      | Consumer(s)                  |
| -------------------- | ------- | ----------------------------- | ---------------------------- |
| ClusterProvision     | Factory | factory-infra-cluster-manager | Fleet Plane                  |
| ClusterUpgrade       | Factory | factory-infra-cluster-manager | Fleet Plane                  |
| ImagePull            | Factory | factory-infra-registry        | Site Infra, Build Plane      |
| OfflineBundleExport  | Factory | factory-infra-registry        | Fleet Plane                  |
| SiteNetworkProvision | Factory | factory-infra-network-manager | Fleet Plane                  |
| CertificateIssue     | Factory | factory-infra-cert-manager    | Fleet Plane, Site Infra      |
| CertificateRotation  | Factory | factory-infra-cert-manager    | Site Infra                   |
| SiteCapacityReport   | Factory | factory-infra-api             | Fleet Plane, Ops team        |
| IngressRouteRequest  | Site    | site-infra-gateway            | Service Plane, Control Plane |
| RateLimitPolicy      | Site    | site-infra-gateway            | Control Plane                |
| ServiceExpose        | Site    | site-infra-network            | Service Plane                |
| NetworkPolicyRequest | Site    | site-infra-network            | Control Plane                |
| NamespaceProvision   | Site    | site-infra-api                | Control Plane                |
| WorkloadDeploy       | Site    | site-infra-api                | Fleet Plane (via Site agent) |
| BucketRequest        | Site    | site-infra-storage            | Data Plane                   |
| VolumeRequest        | Site    | site-infra-storage            | Data Plane                   |
| SecretStore          | Site    | site-infra-secrets            | All planes                   |
| SecretInject         | Site    | site-infra-secrets            | All planes                   |
| EgressPolicy         | Site    | site-infra-network            | Control Plane                |
| DNSRecordRequest     | Site    | site-infra-network            | Control Plane, Fleet Plane   |

---

## Appendix B: Glossary

| Term                     | Definition                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Substrate                | The underlying compute platform (cloud K8s, Proxmox, bare metal)                          |
| Contract                 | A named interface with defined inputs and outputs that other planes consume               |
| Site Infrastructure      | The Infrastructure Plane scope that operates within a single Site                         |
| Factory Infrastructure   | The Infrastructure Plane scope that operates company-wide                                 |
| Zero-egress mode         | A configuration where no outbound network traffic is permitted (air-gapped)               |
| StorageClass             | A Kubernetes abstraction that defines the type and behavior of provisioned storage        |
| PV / PVC                 | PersistentVolume / PersistentVolumeClaim — Kubernetes storage primitives                  |
| mTLS                     | Mutual TLS — both client and server present certificates                                  |
| Policy-execution pattern | Control Plane declares intent, Infrastructure Plane implements it                         |
| Offline bundle           | A self-contained package of all artifacts needed to install or upgrade an air-gapped Site |
