import { describe, expect, test } from "bun:test"

import {
  localSystemDeploymentSchema,
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

describe("siteState — multi-system composition", () => {
  test("dev site: one local SD + N linked SDs", () => {
    const parsed = siteStateSchema.parse({
      site: { slug: "nikhils-trafficure-dev", type: "development" },
      workbench: { slug: "nikhils-macbook", type: "worktree" },
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
      updatedAt: "2026-04-18T00:00:00Z",
    })

    expect(parsed.systemDeployments).toHaveLength(3)
    const linkedCount = parsed.systemDeployments.filter(
      (sd) => sd.linkedRef !== undefined
    ).length
    expect(linkedCount).toBe(2)
  })

  test("prod site: N peer SDs, no linkedRefs", () => {
    const parsed = siteStateSchema.parse({
      site: { slug: "workshop-staging", type: "staging" },
      workbench: { slug: "staging-host", type: "vm" },
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
      updatedAt: "2026-04-18T00:00:00Z",
    })
    for (const sd of parsed.systemDeployments) {
      expect(sd.linkedRef).toBeUndefined()
    }
  })
})
