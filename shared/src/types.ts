/** Product plane */
export type ModuleLifecycleState = "active" | "deprecated" | "retired";

export interface Module {
  moduleId: string;
  name: string;
  teamId: string;
  product?: string | null;
  description?: string | null;
  lifecycleState: ModuleLifecycleState;
  createdAt: string;
}

export type ComponentKind =
  | "server"
  | "worker"
  | "task"
  | "scheduled"
  | "site"
  | "database"
  | "gateway";

export type PortProtocol = "http" | "https" | "grpc" | "tcp" | "udp";

export interface ComponentPort {
  name: string;
  port: number;
  protocol: PortProtocol;
}

export interface ComponentHealthcheck {
  path: string;
  portName: string;
  protocol: PortProtocol;
}

import type { CatalogLifecycle } from "./catalog";

export interface ComponentSpec {
  componentId: string;
  moduleId: string;
  name: string;
  slug: string;
  kind: ComponentKind;
  entityKind: "Component" | "Resource";
  specType?: string | null;
  lifecycle?: CatalogLifecycle | null;
  description?: string | null;
  ports: ComponentPort[];
  healthcheck?: ComponentHealthcheck | null;
  isPublic: boolean;
  stateful: boolean;
  runOrder?: number | null;
  defaultReplicas: number;
  defaultCpu: string;
  defaultMemory: string;
  createdAt: string;
}

export type WorkItemStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done";

export type WorkItemKind = "epic" | "story" | "task" | "bug";
export type WorkItemPriority = "critical" | "high" | "medium" | "low" | "none";

export interface WorkItem {
  workItemId: string;
  moduleId?: string | null;
  title: string;
  status: WorkItemStatus;
  kind?: WorkItemKind;
  priority?: WorkItemPriority | null;
  description?: string | null;
  labels?: string[];
  parentWorkItemId?: string | null;
  assignee?: string | null;
  externalId?: string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  workTrackerProviderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkTrackerKind = "jira" | "linear";
export type WorkTrackerSyncStatus = "idle" | "syncing" | "error";
export type WorkTrackerSyncDirection = "pull" | "push" | "bidirectional";

export interface WorkTrackerProvider {
  workTrackerProviderId: string;
  name: string;
  slug: string;
  kind: WorkTrackerKind;
  apiUrl: string;
  credentialsRef?: string | null;
  defaultProjectKey?: string | null;
  status: "active" | "inactive";
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  syncStatus: WorkTrackerSyncStatus;
  lastSyncAt?: string | null;
  syncError?: string | null;
  createdAt: string;
}

export interface WorkTrackerProjectMapping {
  mappingId: string;
  workTrackerProviderId: string;
  moduleId: string;
  externalProjectId: string;
  externalProjectName?: string | null;
  syncDirection: WorkTrackerSyncDirection;
  filterQuery?: string | null;
  createdAt: string;
}

/** Build plane */
export type RepoKind =
  | "product-module"
  | "platform-module"
  | "library"
  | "vendor-module"
  | "client-project"
  | "infra"
  | "docs"
  | "tool";

export interface Repo {
  repoId: string;
  name: string;
  kind: RepoKind;
  moduleId?: string | null;
  teamId: string;
  gitUrl: string;
  defaultBranch: string;
  createdAt: string;
}

export interface ModuleVersion {
  moduleVersionId: string;
  moduleId: string;
  version: string;
  compatibilityRange?: string | null;
  schemaVersion?: string | null;
  createdAt: string;
}

export type ArtifactKind =
  | "container_image"
  | "binary"
  | "archive"
  | "package"
  | "bundle";

export interface Artifact {
  artifactId: string;
  kind: ArtifactKind;
  imageRef: string;
  imageDigest: string;
  sizeBytes?: number | null;
  builtAt: string;
}

export interface ComponentArtifact {
  componentArtifactId: string;
  moduleVersionId: string;
  componentId: string;
  artifactId: string;
}

/** Agent plane */
export type AgentType =
  | "engineering"
  | "qa"
  | "product"
  | "security"
  | "ops"
  | "external-mcp";

export type AgentStatus = "active" | "disabled";

export interface Agent {
  agentId: string;
  name: string;
  principalId?: string | null;
  agentType: AgentType;
  status: AgentStatus;
  capabilities: Record<string, unknown>;
  createdAt: string;
}

export type AgentExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export interface AgentExecution {
  executionId: string;
  agentId: string;
  task: string;
  status: AgentExecutionStatus;
  costCents?: number | null;
  startedAt: string;
  completedAt?: string | null;
}

/** Commerce plane */
export type CustomerStatus = "trial" | "active" | "suspended" | "terminated";

export interface CustomerAccount {
  customerId: string;
  name: string;
  status: CustomerStatus;
  createdAt: string;
}

export interface Plan {
  planId: string;
  name: string;
  includedModules: unknown[];
  createdAt: string;
}

export type EntitlementStatus = "active" | "suspended" | "revoked";

export interface Entitlement {
  entitlementId: string;
  customerId: string;
  moduleId: string;
  status: EntitlementStatus;
  quotas: Record<string, unknown>;
  createdAt: string;
}

/** Fleet plane */
export type SiteStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "decommissioned";

export interface Site {
  siteId: string;
  name: string;
  product: string;
  clusterId: string;
  status: SiteStatus;
  createdAt: string;
}

export type ReleaseStatus =
  | "draft"
  | "staging"
  | "production"
  | "superseded"
  | "failed";

export interface Release {
  releaseId: string;
  version: string;
  status: ReleaseStatus;
  createdBy: string;
  createdAt: string;
}

export interface ReleaseModulePin {
  releaseModulePinId: string;
  releaseId: string;
  moduleVersionId: string;
}

export type DeploymentTargetKind =
  | "production"
  | "staging"
  | "sandbox"
  | "dev";

export type DeploymentTargetTrigger = "manual" | "pr" | "release" | "agent" | "ci";

export type DeploymentTargetStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "destroying"
  | "destroyed";

export type DeploymentTargetRuntime =
  | "kubernetes"
  | "compose"
  | "systemd"
  | "windows_service"
  | "iis"
  | "process";

export interface DeploymentTarget {
  deploymentTargetId: string;
  name: string;
  kind: DeploymentTargetKind;
  runtime: DeploymentTargetRuntime;
  siteId?: string | null;
  clusterId?: string | null;
  hostId?: string | null;
  vmId?: string | null;
  namespace?: string | null;
  createdBy: string;
  trigger: DeploymentTargetTrigger;
  ttl?: string | null;
  expiresAt?: string | null;
  tierPolicies: Record<string, unknown>;
  status: DeploymentTargetStatus;
  labels: Record<string, unknown>;
  createdAt: string;
  destroyedAt?: string | null;
}

export type WorkloadStatus =
  | "provisioning"
  | "running"
  | "degraded"
  | "stopped"
  | "failed"
  | "completed";

export interface Workload {
  workloadId: string;
  deploymentTargetId: string;
  moduleVersionId: string;
  componentId: string;
  artifactId: string;
  replicas: number;
  envOverrides: Record<string, unknown>;
  resourceOverrides: Record<string, unknown>;
  status: WorkloadStatus;
  desiredImage: string;
  desiredArtifactUri?: string | null;
  actualImage?: string | null;
  driftDetected: boolean;
  lastReconciledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DependencyWorkloadStatus =
  | "provisioning"
  | "running"
  | "failed"
  | "stopped";

export interface DependencyWorkload {
  dependencyWorkloadId: string;
  deploymentTargetId: string;
  name: string;
  image: string;
  port: number;
  env: Record<string, unknown>;
  status: DependencyWorkloadStatus;
}

export type RolloutStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "rolled_back";

export interface Rollout {
  rolloutId: string;
  releaseId: string;
  deploymentTargetId: string;
  status: RolloutStatus;
  startedAt: string;
  completedAt?: string | null;
}

export interface WorkloadOverride {
  overrideId: string;
  workloadId: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string;
  createdBy: string;
  createdAt: string;
  revertedAt?: string | null;
  revertedBy?: string | null;
}

export interface Intervention {
  interventionId: string;
  deploymentTargetId: string;
  workloadId?: string | null;
  action: string;
  principalId: string;
  reason: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ConnectionAuditEvent {
  eventId: string;
  principalId: string;
  deploymentTargetId: string;
  connectedResources: Record<string, unknown>;
  readonly: boolean;
  startedAt: string;
  endedAt?: string | null;
  reason?: string | null;
}

export interface ManifestRoute {
  routeId: string
  kind: string
  domain: string
  pathPrefix?: string | null
  targetService: string
  targetPort?: number | null
  protocol: string
  tlsMode: string
  middlewares: unknown[]
  priority: number
}

export interface ManifestDomain {
  domainId: string
  fqdn: string
  kind: string
  tlsCertRef?: string | null
}

export interface ManifestV1 {
  manifestVersion: number
  manifestHash: string
  targetRelease: {
    releaseId: string
    releaseVersion: string
    modulePins: Array<{
      moduleVersionId: string
      moduleName: string
      version: string
    }>
  } | null
  configuration: Record<string, unknown>
  routes: ManifestRoute[]
  domains: ManifestDomain[]
}

/** Infrastructure plane */
export type ProviderType = "proxmox" | "hetzner" | "aws" | "gcp";

export type ProviderAccountStatus = "active" | "inactive";

export type ProviderKind = "internal" | "cloud" | "partner";

export interface Provider {
  providerId: string;
  name: string;
  providerType: ProviderType;
  url?: string | null;
  status: ProviderAccountStatus;
  credentialsRef?: string | null;
  providerKind: ProviderKind;
  createdAt: string;
}

export type ClusterStatus =
  | "provisioning"
  | "ready"
  | "degraded"
  | "destroying";

export interface Cluster {
  clusterId: string;
  name: string;
  providerId: string;
  status: ClusterStatus;
  kubeconfigRef?: string | null;
  createdAt: string;
}

export type VmStatus =
  | "provisioning"
  | "running"
  | "stopped"
  | "destroying";

export interface Vm {
  vmId: string;
  name: string;
  slug: string;
  providerId: string;
  datacenterId?: string | null;
  hostId?: string | null;
  clusterId?: string | null;
  proxmoxClusterId?: string | null;
  proxmoxVmid?: number | null;
  vmType: string;
  status: VmStatus;
  osType: OsType;
  accessMethod: AccessMethod;
  accessUser?: string | null;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  ipAddress?: string | null;
  createdAt: string;
}

/** Infrastructure plane — extended entities */
export interface Region {
  regionId: string;
  name: string;
  displayName: string;
  slug: string;
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
  providerId?: string | null;
  createdAt: string;
}

export type HostStatus = "active" | "maintenance" | "offline" | "decommissioned";

export type OsType = "linux" | "windows";
export type AccessMethod = "ssh" | "winrm" | "rdp";

export interface Host {
  hostId: string;
  name: string;
  slug: string;
  hostname?: string | null;
  providerId: string;
  datacenterId?: string | null;
  ipAddress?: string | null;
  ipmiAddress?: string | null;
  status: HostStatus;
  osType: OsType;
  accessMethod: AccessMethod;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  rackLocation?: string | null;
  createdAt: string;
}

export interface Datacenter {
  datacenterId: string;
  name: string;
  displayName: string;
  regionId: string;
  availabilityZone?: string | null;
  address?: string | null;
  createdAt: string;
}

export type ProxmoxSyncStatus = "idle" | "syncing" | "error";

export interface ProxmoxCluster {
  proxmoxClusterId: string;
  name: string;
  providerId: string;
  apiHost: string;
  apiPort: number;
  syncStatus: ProxmoxSyncStatus;
  lastSyncAt?: string | null;
  syncError?: string | null;
  createdAt: string;
}

export type KubeNodeRole = "server" | "agent";
export type KubeNodeStatus = "ready" | "not_ready" | "paused" | "evacuating";

export interface KubeNode {
  kubeNodeId: string;
  name: string;
  clusterId: string;
  vmId?: string | null;
  role: KubeNodeRole;
  status: KubeNodeStatus;
  ipAddress: string;
  createdAt: string;
}

export type SubnetType = "management" | "storage" | "vm" | "public" | "private" | "other";

export interface Subnet {
  subnetId: string;
  cidr: string;
  gateway?: string | null;
  netmask?: string | null;
  vlanId?: number | null;
  vlanName?: string | null;
  datacenterId?: string | null;
  subnetType: SubnetType;
  description?: string | null;
  createdAt: string;
}

export type IpAddressStatus = "available" | "assigned" | "reserved" | "dhcp";
export type IpAssignedToType = "vm" | "host" | "kube_node" | "cluster" | "service";

export interface IpAddress {
  ipAddressId: string;
  address: string;
  subnetId?: string | null;
  assignedToType?: IpAssignedToType | null;
  assignedToId?: string | null;
  status: IpAddressStatus;
  hostname?: string | null;
  fqdn?: string | null;
  purpose?: string | null;
  createdAt: string;
}

/** Sandbox */
export type SandboxRuntimeType = "container" | "vm";
export type SandboxOwnerType = "user" | "agent";
export type SandboxAccessRole = "owner" | "editor" | "viewer";
export type SandboxSnapshotStatus = "creating" | "ready" | "failed" | "deleted";

export interface SandboxRepo { url: string; branch: string; clonePath?: string; }

export interface Sandbox {
  sandboxId: string;
  deploymentTargetId: string;
  name: string;
  slug: string;
  runtimeType: SandboxRuntimeType;
  vmId?: string | null;
  podName?: string | null;
  devcontainerConfig: Record<string, unknown>;
  devcontainerImage?: string | null;
  ownerId: string;
  ownerType: SandboxOwnerType;
  setupProgress: Record<string, boolean>;
  statusMessage?: string | null;
  repos: SandboxRepo[];
  dockerCacheGb: number;
  cpu?: string | null;
  memory?: string | null;
  storageGb: number;
  sshHost?: string | null;
  sshPort?: number | null;
  webTerminalUrl?: string | null;
  clonedFromSnapshotId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxTemplate {
  sandboxTemplateId: string;
  name: string;
  slug: string;
  runtimeType: SandboxRuntimeType;
  image?: string | null;
  defaultCpu?: string | null;
  defaultMemory?: string | null;
  defaultStorageGb?: number | null;
  defaultDockerCacheGb?: number | null;
  vmTemplateRef?: string | null;
  defaultTtlMinutes?: number | null;
  preInstalledTools: string[];
  description?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface SandboxSnapshot {
  sandboxSnapshotId: string;
  sandboxId: string;
  name: string;
  description?: string | null;
  runtimeType: SandboxRuntimeType;
  volumeSnapshotName?: string | null;
  imageRef?: string | null;
  proxmoxSnapshotName?: string | null;
  vmId?: string | null;
  snapshotMetadata: Record<string, unknown>;
  sizeBytes?: string | null;
  status: SandboxSnapshotStatus;
  createdAt: string;
}

export interface SandboxAccess {
  sandboxAccessId: string;
  sandboxId: string;
  principalId: string;
  principalType: SandboxOwnerType;
  role: SandboxAccessRole;
  grantedBy: string;
  createdAt: string;
}

/** Git Host Provider */
export type GitHostType = "github" | "gitlab" | "gitea" | "bitbucket";
export type GitHostAuthMode = "pat" | "github_app" | "oauth";
export type GitHostStatus = "active" | "inactive" | "error";
export type GitHostSyncStatus = "idle" | "syncing" | "error";

export interface GitHostProvider {
  gitHostProviderId: string;
  name: string;
  slug: string;
  hostType: GitHostType;
  apiBaseUrl: string;
  authMode: GitHostAuthMode;
  status: GitHostStatus;
  teamId: string;
  lastSyncAt: string | null;
  syncStatus: GitHostSyncStatus;
  syncError: string | null;
  createdAt: string;
}

export type WebhookEventStatus = "pending" | "processing" | "completed" | "failed";

export interface WebhookEvent {
  webhookEventId: string;
  gitHostProviderId: string;
  deliveryId: string;
  eventType: string;
  action: string | null;
  status: WebhookEventStatus;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface GitRepoSync {
  gitRepoSyncId: string;
  repoId: string;
  gitHostProviderId: string;
  externalRepoId: string;
  externalFullName: string;
  isPrivate: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface GitUserSync {
  gitUserSyncId: string;
  gitHostProviderId: string;
  externalUserId: string;
  externalLogin: string;
  authUserId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  syncedAt: string;
}
