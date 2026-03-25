export const RESOURCE_TYPES = [
  "folder",
  "dataset",
  "map",
  "dashboard",
  "pipeline",
  "ontology",
  "process",
  "report",
  "agent_session",
] as const

export type ResourceType = (typeof RESOURCE_TYPES)[number]

export interface Resource {
  id: string
  workspaceId: string
  parentId: string | null
  name: string
  resourceType: ResourceType
  sortKey: string
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
}

export interface TreeNode extends Resource {
  children: TreeNode[]
}

export interface Block {
  id: string
  workspaceId: string
  resourceId: string
  parentId: string | null
  path: string
  depth: number
  blockType: string
  schemaVersion: number
  data: Record<string, unknown>
  sortKey: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface Edge {
  id: string
  workspaceId: string
  resourceId: string
  sourceBlockId: string
  edgeType: string
  targetBlockId: string | null
  targetResourceId: string | null
  targetExternalId: string | null
  targetExternalType: string | null
  data: Record<string, unknown>
  sortOrder: number | null
}

export interface ResourceDetail extends Resource {
  blocks: Block[]
  edges: Edge[]
}

export interface Workspace {
  id: string
  name: string
  description: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
