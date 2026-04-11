import { HttpResponse, http } from "msw"

import type {
  Resource,
  ResourceDetail,
} from "../modules/smart-market.workspaces/types"

// ─── Seed Data ──────────────────────────────────────────────────────────────

const now = new Date().toISOString()

let resources: Resource[] = [
  // ── Root folders ──
  {
    id: "res_mumbai",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Mumbai Expansion",
    resourceType: "folder",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_distribution",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Distribution Network",
    resourceType: "folder",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_data_ontology",
    workspaceId: "ws_demo",
    parentId: null,
    name: "Data & Ontology",
    resourceType: "folder",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Mumbai Expansion children ──
  {
    id: "res_m1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Outlet Coverage Map",
    resourceType: "map",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_m2",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Competitor Density",
    resourceType: "map",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_db1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Regional Performance",
    resourceType: "dashboard",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_r1",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Site Readiness Report",
    resourceType: "report",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Mumbai > Scoring Pipelines (nested folder) ──
  {
    id: "res_scoring",
    workspaceId: "ws_demo",
    parentId: "res_mumbai",
    name: "Scoring Pipelines",
    resourceType: "folder",
    sortKey: "a4",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p1",
    workspaceId: "ws_demo",
    parentId: "res_scoring",
    name: "MOS Scoring Pipeline",
    resourceType: "pipeline",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p2",
    workspaceId: "ws_demo",
    parentId: "res_scoring",
    name: "Revenue Forecast ETL",
    resourceType: "pipeline",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Distribution Network children ──
  {
    id: "res_m3",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Beat Routes Map",
    resourceType: "map",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_db2",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Route Efficiency Dashboard",
    resourceType: "dashboard",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_pr1",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "New Outlet Onboarding",
    resourceType: "process",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_pr2",
    workspaceId: "ws_demo",
    parentId: "res_distribution",
    name: "Beat Reassignment Flow",
    resourceType: "process",
    sortKey: "a3",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },

  // ── Data & Ontology children ──
  {
    id: "res_o1",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Workspace Ontology",
    resourceType: "ontology",
    sortKey: "a0",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_p3",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Nightly Ingestion",
    resourceType: "pipeline",
    sortKey: "a1",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
  {
    id: "res_rpt2",
    workspaceId: "ws_demo",
    parentId: "res_data_ontology",
    name: "Data Quality Report",
    resourceType: "report",
    sortKey: "a2",
    createdBy: "user_1",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  },
]

// ─── ID generation ──────────────────────────────────────────────────────────

let nextId = 1000
function newId() {
  return `res_mock_${nextId++}`
}

function generateSortKey(siblings: Resource[]): string {
  if (siblings.length === 0) return "a0"
  const last = siblings[siblings.length - 1].sortKey
  // Simple increment: a0 -> a1 -> a2 ...
  const match = last.match(/^([a-z]+)(\d+)$/)
  if (match) {
    return `${match[1]}${parseInt(match[2]) + 1}`
  }
  return `${last}1`
}

// ─── Handlers ───────────────────────────────────────────────────────────────

const BASE = "http://localhost:8093/api/v1/workspace"

export const workspaceHandlers = [
  // GET tree
  http.get(`${BASE}/workspaces/:workspaceId/tree`, ({ params }) => {
    const { workspaceId } = params as { workspaceId: string }
    const tree = resources.filter(
      (r) => r.workspaceId === workspaceId && !r.deletedAt
    )
    return HttpResponse.json(tree)
  }),

  // GET resource by ID
  http.get(`${BASE}/resources/:id`, ({ params }) => {
    const { id } = params as { id: string }
    const res = resources.find((r) => r.id === id && !r.deletedAt)
    if (!res) {
      return HttpResponse.json({ error: "Resource not found" }, { status: 404 })
    }
    const detail: ResourceDetail = {
      ...res,
      blocks: [],
      edges: [],
    }
    return HttpResponse.json(detail)
  }),

  // POST create resource
  http.post(
    `${BASE}/workspaces/:workspaceId/resources/create`,
    async ({ params, request }) => {
      const { workspaceId } = params as { workspaceId: string }
      const body = (await request.json()) as {
        parentId?: string
        name: string
        resourceType: string
      }

      const siblings = resources.filter(
        (r) =>
          r.workspaceId === workspaceId &&
          (body.parentId
            ? r.parentId === body.parentId
            : r.parentId === null) &&
          !r.deletedAt
      )

      const created: Resource = {
        id: newId(),
        workspaceId,
        parentId: body.parentId ?? null,
        name: body.name,
        resourceType: body.resourceType as Resource["resourceType"],
        sortKey: generateSortKey(siblings),
        createdBy: "user_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
      }

      resources.push(created)
      return HttpResponse.json(created, { status: 201 })
    }
  ),

  // POST update resource
  http.post(`${BASE}/resources/:id/update`, async ({ params, request }) => {
    const { id } = params as { id: string }
    const body = (await request.json()) as { name?: string; sortKey?: string }
    const idx = resources.findIndex((r) => r.id === id && !r.deletedAt)
    if (idx === -1) {
      return HttpResponse.json({ error: "Resource not found" }, { status: 404 })
    }

    if (body.name !== undefined) resources[idx].name = body.name
    if (body.sortKey !== undefined) resources[idx].sortKey = body.sortKey
    resources[idx].updatedAt = new Date().toISOString()

    return HttpResponse.json(resources[idx])
  }),

  // POST delete resource
  http.post(`${BASE}/resources/:id/delete`, ({ params }) => {
    const { id } = params as { id: string }
    const idx = resources.findIndex((r) => r.id === id && !r.deletedAt)
    if (idx === -1) {
      return HttpResponse.json({ error: "Resource not found" }, { status: 404 })
    }

    const now = new Date().toISOString()
    resources[idx].deletedAt = now
    resources[idx].deletedBy = "user_1"

    // Also soft-delete children
    function deleteChildren(parentId: string) {
      resources.forEach((r, i) => {
        if (r.parentId === parentId && !r.deletedAt) {
          resources[i].deletedAt = now
          resources[i].deletedBy = "user_1"
          if (r.resourceType === "folder") {
            deleteChildren(r.id)
          }
        }
      })
    }
    if (resources[idx].resourceType === "folder") {
      deleteChildren(id)
    }

    return HttpResponse.json({ deleted: true, id })
  }),

  // POST move resource
  http.post(`${BASE}/resources/:id/move`, async ({ params, request }) => {
    const { id } = params as { id: string }
    const body = (await request.json()) as {
      newParentId: string | null
      afterSortKey?: string | null
      beforeSortKey?: string | null
    }

    const idx = resources.findIndex((r) => r.id === id && !r.deletedAt)
    if (idx === -1) {
      return HttpResponse.json({ error: "Resource not found" }, { status: 404 })
    }

    resources[idx].parentId = body.newParentId
    // Simple sort key: place at end of new parent's children
    const siblings = resources.filter(
      (r) =>
        r.workspaceId === resources[idx].workspaceId &&
        (body.newParentId
          ? r.parentId === body.newParentId
          : r.parentId === null) &&
        r.id !== id &&
        !r.deletedAt
    )
    resources[idx].sortKey = generateSortKey(siblings)
    resources[idx].updatedAt = new Date().toISOString()

    return HttpResponse.json(resources[idx])
  }),
]
