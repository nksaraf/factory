import { describe, expect, test } from "bun:test"

import {
  localSystemDeploymentSchema,
  localSiteStatusSchema,
  siteSpecSchema,
  siteStateSchema,
  systemLinkedRefSchema,
} from "./site-state"

describe("systemLinkedRefSchema (system-level linking)", () => {
  test("requires site + systemDeployment", () => {
    const parsed = systemLinkedRefSchema.parse({
      site: "workshop-staging",
      systemDeployment: "workshop-staging-auth",
    })
    expect(parsed.site).toBe("workshop-staging")
    expect(parsed.systemDeployment).toBe("workshop-staging-auth")
  })

  test("rejects missing fields", () => {
    expect(() =>
      systemLinkedRefSchema.parse({ site: "workshop-staging" })
    ).toThrow()
    expect(() =>
      systemLinkedRefSchema.parse({ systemDeployment: "x" })
    ).toThrow()
  })
})

describe("localSystemDeployment — linkedRef and empty componentDeployments", () => {
  test("dev-site pattern: linkedRef set, no componentDeployments", () => {
    const parsed = localSystemDeploymentSchema.parse({
      slug: "shared-auth-linked",
      systemSlug: "shared-auth",
      linkedRef: {
        site: "workshop-staging",
        systemDeployment: "workshop-staging-auth",
      },
      // componentDeployments intentionally omitted — fully remote
    })
    expect(parsed.linkedRef).toEqual({
      site: "workshop-staging",
      systemDeployment: "workshop-staging-auth",
    })
    expect(parsed.componentDeployments).toEqual([])
  })

  test("prod-site pattern: no linkedRef, full componentDeployments", () => {
    const parsed = localSystemDeploymentSchema.parse({
      slug: "trafficure",
      systemSlug: "trafficure",
      componentDeployments: [
        { componentSlug: "api", mode: "container" },
        { componentSlug: "postgres", mode: "container" },
      ],
    })
    expect(parsed.linkedRef).toBeUndefined()
    expect(parsed.componentDeployments).toHaveLength(2)
  })

  test("partial-link pattern: linkedRef + one local override", () => {
    const parsed = localSystemDeploymentSchema.parse({
      slug: "shared-auth-linked-with-override",
      systemSlug: "shared-auth",
      linkedRef: {
        site: "workshop-staging",
        systemDeployment: "workshop-staging-auth",
      },
      componentDeployments: [
        // "link shared-auth but run auth-api locally against my laptop"
        { componentSlug: "auth-api", mode: "native" },
      ],
    })
    expect(parsed.linkedRef).toBeDefined()
    expect(parsed.componentDeployments).toHaveLength(1)
    expect(parsed.componentDeployments[0].mode).toBe("native")
  })
})

describe("siteSpec — desired state", () => {
  test("defaults mode to dev", () => {
    const parsed = siteSpecSchema.parse({
      site: { slug: "my-dev", type: "development" },
      workbench: { slug: "laptop", type: "worktree" },
    })
    expect(parsed.mode).toBe("dev")
    expect(parsed.systemDeployments).toEqual([])
  })

  test("accepts mode: up", () => {
    const parsed = siteSpecSchema.parse({
      site: { slug: "my-prod", type: "production" },
      workbench: { slug: "server", type: "vm" },
      mode: "up",
    })
    expect(parsed.mode).toBe("up")
  })
})

describe("localSiteStatus — observed state", () => {
  test("defaults phase to pending", () => {
    const parsed = localSiteStatusSchema.parse({
      updatedAt: "2026-04-19T00:00:00Z",
    })
    expect(parsed.phase).toBe("pending")
    expect(parsed.conditions).toEqual([])
  })
})

describe("siteState — spec/status split", () => {
  test("dev site: one local SD + N linked SDs", () => {
    const parsed = siteStateSchema.parse({
      spec: {
        site: { slug: "nikhils-trafficure-dev", type: "development" },
        workbench: { slug: "nikhils-macbook", type: "worktree" },
        mode: "dev",
        systemDeployments: [
          {
            slug: "trafficure",
            systemSlug: "trafficure",
            componentDeployments: [
              { componentSlug: "frontend", mode: "native" },
              { componentSlug: "api", mode: "container" },
            ],
          },
          {
            slug: "shared-auth-linked",
            systemSlug: "shared-auth",
            linkedRef: {
              site: "workshop-staging",
              systemDeployment: "workshop-staging-auth",
            },
          },
          {
            slug: "shared-queues-linked",
            systemSlug: "shared-queues",
            linkedRef: {
              site: "workshop-staging",
              systemDeployment: "workshop-staging-queues",
            },
          },
        ],
      },
      status: {
        phase: "running",
        updatedAt: "2026-04-18T00:00:00Z",
      },
    })

    expect(parsed.spec.systemDeployments).toHaveLength(3)
    expect(parsed.spec.mode).toBe("dev")
    expect(parsed.status.phase).toBe("running")
    const linkedCount = parsed.spec.systemDeployments.filter(
      (sd) => sd.linkedRef !== undefined
    ).length
    expect(linkedCount).toBe(2)
  })

  test("prod site: mode up, N peer SDs, no linkedRefs", () => {
    const parsed = siteStateSchema.parse({
      spec: {
        site: { slug: "workshop-staging", type: "staging" },
        workbench: { slug: "staging-host", type: "vm" },
        mode: "up",
        systemDeployments: [
          {
            slug: "trafficure",
            systemSlug: "trafficure",
            componentDeployments: [{ componentSlug: "api", mode: "container" }],
          },
          {
            slug: "shared-auth",
            systemSlug: "shared-auth",
            componentDeployments: [
              { componentSlug: "auth-api", mode: "container" },
            ],
          },
        ],
      },
      status: {
        phase: "running",
        updatedAt: "2026-04-18T00:00:00Z",
      },
    })
    expect(parsed.spec.mode).toBe("up")
    for (const sd of parsed.spec.systemDeployments) {
      expect(sd.linkedRef).toBeUndefined()
    }
  })
})
