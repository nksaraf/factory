import type { Resource, ResourceDetail, Workspace } from "../types"
import { compareSortKeys, generateSortKeyBetween } from "../utils/sort-keys"
import {
  MOCK_ACTIVITY_FEED,
  MOCK_DATASET_BLOCKS,
  MOCK_RESOURCES,
} from "./mock-data"

// ─── Mock workspaces ────────────────────────────────────────────────────────

const now = new Date().toISOString()

const workspaces: Workspace[] = [
  {
    id: "ws_demo",
    name: "Smart Market India",
    description: "Market expansion and distribution analysis for India",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ws_logistics",
    name: "Logistics Optimization",
    description: "Supply chain and route optimization workspace",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ws_analytics",
    name: "Customer Analytics",
    description: "Customer segmentation and behavior analysis",
    createdBy: "user_2",
    createdAt: now,
    updatedAt: now,
  },
]

// ─── In-memory store ─────────────────────────────────────────────────────────

let resources: Resource[] = structuredClone(MOCK_RESOURCES)
let nextId = 1000

function newId() {
  return `res_mock_${nextId++}`
}

function getSiblings(
  workspaceId: string,
  parentId: string | null,
  excludeId?: string
): Resource[] {
  return resources
    .filter(
      (r) =>
        r.workspaceId === workspaceId &&
        (parentId ? r.parentId === parentId : r.parentId === null) &&
        r.id !== excludeId &&
        !r.deletedAt
    )
    .sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))
}

function appendSortKey(siblings: Resource[]): string {
  if (siblings.length === 0) return generateSortKeyBetween(null, null)
  return generateSortKeyBetween(siblings[siblings.length - 1].sortKey, null)
}

// ─── Route matcher ───────────────────────────────────────────────────────────

interface MockRoute {
  method: string
  pattern: RegExp
  handler: (
    params: Record<string, string>,
    body?: any
  ) => { status: number; data: any }
}

const routes: MockRoute[] = [
  // GET workspace list
  {
    method: "GET",
    pattern: /^\/workspaces$/,
    handler: () => {
      return { status: 200, data: workspaces }
    },
  },

  // GET tree
  {
    method: "GET",
    pattern: /^\/workspaces\/([^/]+)\/tree$/,
    handler: (params) => {
      const tree = resources.filter(
        (r) => r.workspaceId === params[0] && !r.deletedAt
      )
      return { status: 200, data: tree }
    },
  },

  // GET resource by ID
  {
    method: "GET",
    pattern: /^\/resources\/([^/]+)$/,
    handler: (params) => {
      const res = resources.find((r) => r.id === params[0] && !r.deletedAt)
      if (!res) {
        return { status: 404, data: { error: "Resource not found" } }
      }
      const blocks = MOCK_DATASET_BLOCKS[res.id] ?? []
      const detail: ResourceDetail = { ...res, blocks, edges: [] }
      return { status: 200, data: detail }
    },
  },

  // POST create resource
  {
    method: "POST",
    pattern: /^\/workspaces\/([^/]+)\/resources\/create$/,
    handler: (params, body) => {
      const workspaceId = params[0]
      const siblings = getSiblings(workspaceId, body.parentId ?? null)

      const created: Resource = {
        id: newId(),
        workspaceId,
        parentId: body.parentId ?? null,
        name: body.name,
        resourceType: body.resourceType,
        sortKey: appendSortKey(siblings),
        createdBy: "user_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
      }

      resources.push(created)
      return { status: 201, data: created }
    },
  },

  // POST update resource
  {
    method: "POST",
    pattern: /^\/resources\/([^/]+)\/update$/,
    handler: (params, body) => {
      const idx = resources.findIndex((r) => r.id === params[0] && !r.deletedAt)
      if (idx === -1) {
        return { status: 404, data: { error: "Resource not found" } }
      }
      if (body.name !== undefined) resources[idx].name = body.name
      if (body.sortKey !== undefined) resources[idx].sortKey = body.sortKey
      resources[idx].updatedAt = new Date().toISOString()
      return { status: 200, data: resources[idx] }
    },
  },

  // POST delete resource
  {
    method: "POST",
    pattern: /^\/resources\/([^/]+)\/delete$/,
    handler: (params) => {
      const idx = resources.findIndex((r) => r.id === params[0] && !r.deletedAt)
      if (idx === -1) {
        return { status: 404, data: { error: "Resource not found" } }
      }

      const now = new Date().toISOString()
      resources[idx].deletedAt = now
      resources[idx].deletedBy = "user_1"

      function deleteChildren(parentId: string) {
        resources.forEach((r, i) => {
          if (r.parentId === parentId && !r.deletedAt) {
            resources[i].deletedAt = now
            resources[i].deletedBy = "user_1"
            if (r.resourceType === "folder") deleteChildren(r.id)
          }
        })
      }
      if (resources[idx].resourceType === "folder") {
        deleteChildren(params[0])
      }

      return { status: 200, data: { deleted: true, id: params[0] } }
    },
  },

  // GET workspace activity feed
  {
    method: "GET",
    pattern: /^\/workspaces\/([^/]+)\/activity$/,
    handler: () => {
      return { status: 200, data: MOCK_ACTIVITY_FEED }
    },
  },

  // GET agent sessions for a workspace
  {
    method: "GET",
    pattern: /^\/workspaces\/([^/]+)\/agent-sessions$/,
    handler: (params) => {
      const sessions = resources
        .filter(
          (r) =>
            r.workspaceId === params[0] &&
            r.resourceType === "agent_session" &&
            !r.deletedAt
        )
        .map((r) => {
          const blocks = MOCK_DATASET_BLOCKS[r.id] ?? []
          const metaBlock = blocks.find(
            (b) => b.blockType === "agent_session_meta"
          )
          const messages = blocks.filter((b) => b.blockType === "agent_message")
          const lastMessage =
            messages.length > 0 ? messages[messages.length - 1] : null
          return {
            id: r.id,
            workspaceId: r.workspaceId,
            parentId: r.parentId,
            name: r.name,
            agentName: (metaBlock?.data?.agentName as string) ?? "AI Agent",
            model: (metaBlock?.data?.model as string) ?? undefined,
            status: (metaBlock?.data?.status as string) ?? "completed",
            messageCount: messages.length,
            lastMessagePreview: lastMessage
              ? (lastMessage.data.content as string)?.slice(0, 120)
              : undefined,
            startedAt: (metaBlock?.data?.startedAt as string) ?? r.createdAt,
            updatedAt: r.updatedAt,
          }
        })
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      return { status: 200, data: sessions }
    },
  },

  // POST move resource
  {
    method: "POST",
    pattern: /^\/resources\/([^/]+)\/move$/,
    handler: (params, body) => {
      const idx = resources.findIndex((r) => r.id === params[0] && !r.deletedAt)
      if (idx === -1) {
        return { status: 404, data: { error: "Resource not found" } }
      }

      resources[idx].parentId = body.newParentId

      if (body.afterSortKey || body.beforeSortKey) {
        resources[idx].sortKey = generateSortKeyBetween(
          body.afterSortKey,
          body.beforeSortKey
        )
      } else {
        // No hints — append at end
        const siblings = getSiblings(
          resources[idx].workspaceId,
          body.newParentId,
          params[0]
        )
        resources[idx].sortKey = appendSortKey(siblings)
      }

      resources[idx].updatedAt = new Date().toISOString()

      return { status: 200, data: resources[idx] }
    },
  },
]

// ─── Public API ──────────────────────────────────────────────────────────────

export async function mockFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase()

  // Small delay to simulate network
  await new Promise((r) => setTimeout(r, 50))

  for (const route of routes) {
    if (route.method !== method) continue
    const match = path.match(route.pattern)
    if (!match) continue

    const params: Record<string, string> = {}
    for (let i = 1; i < match.length; i++) {
      params[i - 1] = match[i]
    }

    let body: any
    if (options.body) {
      body =
        typeof options.body === "string"
          ? JSON.parse(options.body)
          : options.body
    }

    const result = route.handler(params, body)

    if (result.status >= 400) {
      throw new Error(
        result.data.error || `Mock request failed: ${result.status}`
      )
    }

    return result.data as T
  }

  throw new Error(`Mock: No handler for ${method} ${path}`)
}
