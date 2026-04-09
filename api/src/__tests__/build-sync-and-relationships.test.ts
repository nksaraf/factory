import type { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { WorkTrackerAdapter } from "../adapters/work-tracker-adapter"
import type { Database } from "../db/connection"
import {
  repo,
  workTrackerProject,
  workTrackerProjectMapping,
  workTrackerProvider,
} from "../db/schema/build-v2"
import { system } from "../db/schema/software-v2"
import { syncWorkTracker } from "../modules/build/work-tracker.service"
import {
  type TestApp,
  createTestContext,
  truncateAllTables,
} from "../test-helpers"

interface ApiListResponse<T = Record<string, unknown>> {
  data: T[]
}

interface ApiResponse<T = Record<string, unknown>> {
  data: T
}

const BUILD_BASE = "http://localhost/api/v1/factory/build"
const ORG_BASE = "http://localhost/api/v1/factory/org"

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Build sync + entity relationships", () => {
  let app: TestApp
  let db: Database
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    app = ctx.app
    db = ctx.db as unknown as Database
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("syncs work tracker projects and exposes them through build routes", async () => {
    const [createdSystem] = await db
      .insert(system)
      .values({
        slug: "orders",
        name: "Orders",
        spec: {
          namespace: "default",
          lifecycle: "experimental",
          tags: [],
        },
        metadata: {},
      })
      .returning()

    const [provider] = await db
      .insert(workTrackerProvider)
      .values({
        slug: "jira-main",
        name: "Jira Main",
        type: "jira",
        spec: {
          apiUrl: "https://jira.example.com",
          status: "active",
        },
      })
      .returning()

    await db.insert(workTrackerProjectMapping).values({
      workTrackerProviderId: provider.id,
      systemId: createdSystem!.id,
      externalProjectId: "1000",
    })

    const adapter: WorkTrackerAdapter = {
      type: "jira",
      async testConnection() {
        return { ok: true }
      },
      async listProjects() {
        return [{ id: "1000", key: "ORD", name: "Orders Tracker" }]
      },
      async fetchIssues() {
        const now = new Date().toISOString()
        return [
          {
            id: "ORD-101",
            key: "ORD-101",
            title: "Fix sync wiring",
            description: "Wire the v2 sync route to the adapter.",
            status: "In Progress",
            kind: "Task",
            priority: "High",
            assignee: "A. Engineer",
            labels: ["sync"],
            url: "https://jira.example.com/browse/ORD-101",
            createdAt: now,
            updatedAt: now,
          },
        ]
      },
      async getIssue() {
        throw new Error("not implemented")
      },
      async pushIssue() {
        throw new Error("not implemented")
      },
      async pushIssues() {
        throw new Error("not implemented")
      },
      async updateIssueStatus() {},
    }

    const result = await syncWorkTracker(db, provider.id, { adapter })
    expect(result.projects).toMatchObject({ created: 1, updated: 0, total: 1 })
    expect(result.items).toMatchObject({ created: 1, updated: 0, total: 1 })

    const listRes = await app.handle(
      new Request(`${BUILD_BASE}/work-tracker-projects`)
    )
    expect(listRes.status).toBe(200)
    const { data } = (await listRes.json()) as ApiListResponse
    expect(data).toHaveLength(1)
    expect(data[0]?.name).toBe("Orders Tracker")

    const relatedRes = await app.handle(
      new Request(
        `${BUILD_BASE}/work-tracker-providers/${provider.id}/work-tracker-projects`
      )
    )
    expect(relatedRes.status).toBe(200)
    const related = (await relatedRes.json()) as ApiListResponse
    expect(related.data).toHaveLength(1)
  })

  it("creates repo-to-project entity relationships through the org API", async () => {
    const [provider] = await db
      .insert(workTrackerProvider)
      .values({
        slug: "jira-links",
        name: "Jira Links",
        type: "jira",
        spec: {
          apiUrl: "https://jira.example.com",
          status: "active",
        },
      })
      .returning()

    const [createdRepo] = await db
      .insert(repo)
      .values({
        slug: "factory-api",
        name: "Factory API",
        spec: {
          url: "https://github.com/acme/factory-api",
          defaultBranch: "main",
          kind: "tool",
        },
      })
      .returning()

    const [createdProject] = await db
      .insert(workTrackerProject)
      .values({
        slug: "jira-links-ord",
        name: "Orders Tracker",
        workTrackerProviderId: provider.id,
        externalId: "1000",
        spec: {
          key: "ORD",
        },
      })
      .returning()

    const createRes = await app.handle(
      post(`${ORG_BASE}/entity-relationships`, {
        type: "maps-to",
        sourceKind: "repo",
        sourceId: createdRepo!.id,
        targetKind: "work-tracker-project",
        targetId: createdProject!.id,
        spec: {},
      })
    )
    expect(createRes.status).toBe(200)
    const created = (await createRes.json()) as ApiResponse
    expect(created.data.id).toMatch(/^erel_/)

    const listRes = await app.handle(
      new Request(`${ORG_BASE}/entity-relationships`)
    )
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as ApiListResponse
    expect(list.data).toHaveLength(1)
    expect(list.data[0]?.type).toBe("maps-to")
  })
})
