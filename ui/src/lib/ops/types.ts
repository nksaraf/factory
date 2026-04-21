export interface Site {
  id: string
  slug: string
  name: string
  type: string
  parentSiteId: string | null
  spec: Record<string, unknown>
  status: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface SystemDeployment {
  id: string
  slug: string
  name: string
  type: string
  systemId: string
  siteId: string
  tenantId: string | null
  realmId: string | null
  workbenchId: string | null
  spec: Record<string, unknown>
  status: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ComponentDeployment {
  id: string
  systemDeploymentId: string
  deploymentSetId: string | null
  componentId: string
  artifactId: string | null
  workbenchId: string | null
  serviceId: string | null
  spec: Record<string, unknown>
  status: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Workbench {
  id: string
  slug: string
  name: string
  type: string
  siteId: string | null
  hostId: string | null
  realmId: string | null
  serviceId: string | null
  parentWorkbenchId: string | null
  templateId: string | null
  ownerId: string
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Rollout {
  id: string
  releaseId: string
  systemDeploymentId: string
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Intervention {
  id: string
  type: string
  systemDeploymentId: string
  componentDeploymentId: string | null
  spec: Record<string, unknown>
  createdAt: string
}

export interface OpsDatabase {
  id: string
  slug: string
  name: string
  systemDeploymentId: string
  componentId: string | null
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
