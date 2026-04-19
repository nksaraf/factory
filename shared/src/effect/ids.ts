import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Software domain
// ---------------------------------------------------------------------------

export const SystemId = Schema.String.pipe(Schema.brand("SystemId"))
export type SystemId = typeof SystemId.Type

export const ComponentId = Schema.String.pipe(Schema.brand("ComponentId"))
export type ComponentId = typeof ComponentId.Type

export const ProductId = Schema.String.pipe(Schema.brand("ProductId"))
export type ProductId = typeof ProductId.Type

export const ApiId = Schema.String.pipe(Schema.brand("ApiId"))
export type ApiId = typeof ApiId.Type

export const TemplateId = Schema.String.pipe(Schema.brand("TemplateId"))
export type TemplateId = typeof TemplateId.Type

export const CapabilityId = Schema.String.pipe(Schema.brand("CapabilityId"))
export type CapabilityId = typeof CapabilityId.Type

export const ReleaseArtifactPinId = Schema.String.pipe(
  Schema.brand("ReleaseArtifactPinId")
)
export type ReleaseArtifactPinId = typeof ReleaseArtifactPinId.Type

// ---------------------------------------------------------------------------
// Org domain
// ---------------------------------------------------------------------------

export const TeamId = Schema.String.pipe(Schema.brand("TeamId"))
export type TeamId = typeof TeamId.Type

export const PrincipalId = Schema.String.pipe(Schema.brand("PrincipalId"))
export type PrincipalId = typeof PrincipalId.Type

export const MembershipId = Schema.String.pipe(Schema.brand("MembershipId"))
export type MembershipId = typeof MembershipId.Type

export const ScopeId = Schema.String.pipe(Schema.brand("ScopeId"))
export type ScopeId = typeof ScopeId.Type

export const IdentityLinkId = Schema.String.pipe(Schema.brand("IdentityLinkId"))
export type IdentityLinkId = typeof IdentityLinkId.Type

export const AgentId = Schema.String.pipe(Schema.brand("AgentId"))
export type AgentId = typeof AgentId.Type

export const SecretId = Schema.String.pipe(Schema.brand("SecretId"))
export type SecretId = typeof SecretId.Type

export const ConfigVarId = Schema.String.pipe(Schema.brand("ConfigVarId"))
export type ConfigVarId = typeof ConfigVarId.Type

// ---------------------------------------------------------------------------
// Infra domain
// ---------------------------------------------------------------------------

export const EstateId = Schema.String.pipe(Schema.brand("EstateId"))
export type EstateId = typeof EstateId.Type

export const RealmId = Schema.String.pipe(Schema.brand("RealmId"))
export type RealmId = typeof RealmId.Type

export const ServiceId = Schema.String.pipe(Schema.brand("ServiceId"))
export type ServiceId = typeof ServiceId.Type

export const NetworkLinkId = Schema.String.pipe(Schema.brand("NetworkLinkId"))
export type NetworkLinkId = typeof NetworkLinkId.Type

export const DnsDomainId = Schema.String.pipe(Schema.brand("DnsDomainId"))
export type DnsDomainId = typeof DnsDomainId.Type

export const IpAddressId = Schema.String.pipe(Schema.brand("IpAddressId"))
export type IpAddressId = typeof IpAddressId.Type

export const TunnelId = Schema.String.pipe(Schema.brand("TunnelId"))
export type TunnelId = typeof TunnelId.Type

export const RouteId = Schema.String.pipe(Schema.brand("RouteId"))
export type RouteId = typeof RouteId.Type

export const HostId = Schema.String.pipe(Schema.brand("HostId"))
export type HostId = typeof HostId.Type

// ---------------------------------------------------------------------------
// Ops domain
// ---------------------------------------------------------------------------

export const SiteId = Schema.String.pipe(Schema.brand("SiteId"))
export type SiteId = typeof SiteId.Type

export const TenantId = Schema.String.pipe(Schema.brand("TenantId"))
export type TenantId = typeof TenantId.Type

export const SystemDeploymentId = Schema.String.pipe(
  Schema.brand("SystemDeploymentId")
)
export type SystemDeploymentId = typeof SystemDeploymentId.Type

export const ComponentDeploymentId = Schema.String.pipe(
  Schema.brand("ComponentDeploymentId")
)
export type ComponentDeploymentId = typeof ComponentDeploymentId.Type

export const WorkbenchId = Schema.String.pipe(Schema.brand("WorkbenchId"))
export type WorkbenchId = typeof WorkbenchId.Type

export const DeploymentSetId = Schema.String.pipe(
  Schema.brand("DeploymentSetId")
)
export type DeploymentSetId = typeof DeploymentSetId.Type

export const RolloutId = Schema.String.pipe(Schema.brand("RolloutId"))
export type RolloutId = typeof RolloutId.Type

export const DatabaseId = Schema.String.pipe(Schema.brand("DatabaseId"))
export type DatabaseId = typeof DatabaseId.Type

// ---------------------------------------------------------------------------
// Build domain
// ---------------------------------------------------------------------------

export const RepositoryId = Schema.String.pipe(Schema.brand("RepositoryId"))
export type RepositoryId = typeof RepositoryId.Type

export const PipelineRunId = Schema.String.pipe(Schema.brand("PipelineRunId"))
export type PipelineRunId = typeof PipelineRunId.Type

export const GitHostProviderId = Schema.String.pipe(
  Schema.brand("GitHostProviderId")
)
export type GitHostProviderId = typeof GitHostProviderId.Type

export const WorkTrackerProviderId = Schema.String.pipe(
  Schema.brand("WorkTrackerProviderId")
)
export type WorkTrackerProviderId = typeof WorkTrackerProviderId.Type

export const SystemVersionId = Schema.String.pipe(
  Schema.brand("SystemVersionId")
)
export type SystemVersionId = typeof SystemVersionId.Type

export const WorkItemId = Schema.String.pipe(Schema.brand("WorkItemId"))
export type WorkItemId = typeof WorkItemId.Type

// ---------------------------------------------------------------------------
// Workflow domain
// ---------------------------------------------------------------------------

export const WorkflowRunId = Schema.String.pipe(Schema.brand("WorkflowRunId"))
export type WorkflowRunId = typeof WorkflowRunId.Type

export const EventId = Schema.String.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type

export const EventSubscriptionId = Schema.String.pipe(
  Schema.brand("EventSubscriptionId")
)
export type EventSubscriptionId = typeof EventSubscriptionId.Type

export const ChannelId = Schema.String.pipe(Schema.brand("ChannelId"))
export type ChannelId = typeof ChannelId.Type

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"))
export type ThreadId = typeof ThreadId.Type

export const ThreadTurnId = Schema.String.pipe(Schema.brand("ThreadTurnId"))
export type ThreadTurnId = typeof ThreadTurnId.Type

// ---------------------------------------------------------------------------
// Commerce domain
// ---------------------------------------------------------------------------

export const CustomerId = Schema.String.pipe(Schema.brand("CustomerId"))
export type CustomerId = typeof CustomerId.Type

export const PlanId = Schema.String.pipe(Schema.brand("PlanId"))
export type PlanId = typeof PlanId.Type

export const SubscriptionId = Schema.String.pipe(Schema.brand("SubscriptionId"))
export type SubscriptionId = typeof SubscriptionId.Type

export const BundleId = Schema.String.pipe(Schema.brand("BundleId"))
export type BundleId = typeof BundleId.Type

// ---------------------------------------------------------------------------
// Documents domain
// ---------------------------------------------------------------------------

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"))
export type DocumentId = typeof DocumentId.Type

export const DocumentVersionId = Schema.String.pipe(
  Schema.brand("DocumentVersionId")
)
export type DocumentVersionId = typeof DocumentVersionId.Type
