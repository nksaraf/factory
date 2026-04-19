import { describe, expect, test } from "bun:test"

import type { CatalogSystem } from "@smp/factory-shared/catalog"

import { resolveLinkedSystemDeployments } from "./linked-sd-resolver"

function makeCatalog(
  deps?: CatalogSystem["spec"]["dependencies"]
): CatalogSystem {
  return {
    kind: "System",
    metadata: { name: "trafficure", namespace: "default" },
    spec: { owner: "team", dependencies: deps },
    components: {},
    resources: {},
    connections: [],
  }
}

describe("resolveLinkedSystemDeployments", () => {
  test("no declared deps → no linked SDs", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:workshop-staging"],
      catalog: makeCatalog(),
    })
    expect(r).toEqual([])
  })

  test("matches declared system → one linked SD", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:workshop-staging"],
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({
      slug: "shared-auth-linked",
      systemSlug: "shared-auth",
      env: {},
      linkedRef: {
        site: "workshop-staging",
        systemDeployment: "workshop-staging-shared-auth",
      },
    })
  })

  test("dep env flows through to resolution", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:workshop-staging"],
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          env: {
            AUTH_SERVICE_URL: "http://192.168.2.88:4300",
            AUTH_DB_URL: "postgresql://auth:pass@192.168.2.88:5432/auth",
          },
        },
      ]),
    })
    expect(r[0].env).toEqual({
      AUTH_SERVICE_URL: "http://192.168.2.88:4300",
      AUTH_DB_URL: "postgresql://auth:pass@192.168.2.88:5432/auth",
    })
  })

  test("component-level entries (not declared systems) are ignored", () => {
    // `auth-api` is a component name, not a declared system dep → skipped.
    const r = resolveLinkedSystemDeployments({
      connects: ["auth-api:workshop-staging"],
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
    })
    expect(r).toEqual([])
  })

  test("--connect-to blanket → all declared deps become linked", () => {
    const r = resolveLinkedSystemDeployments({
      connects: [],
      connectTo: "workshop-staging",
      catalog: makeCatalog([
        { system: "shared-auth", binding: "required" },
        { system: "shared-queues", binding: "required" },
      ]),
    })
    expect(r).toHaveLength(2)
    expect(r.map((x) => x.systemSlug).sort()).toEqual([
      "shared-auth",
      "shared-queues",
    ])
    for (const entry of r) {
      expect(entry.linkedRef.site).toBe("workshop-staging")
    }
  })

  test("--connect-to + per-system --connect: per-system wins, --connect-to fills rest", () => {
    // Plan priority: explicit `--connect <sys>:<target>` beats blanket `--connect-to`.
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:janes-macbook"],
      connectTo: "workshop-staging",
      catalog: makeCatalog([
        { system: "shared-auth", binding: "required" },
        { system: "shared-queues", binding: "required" },
      ]),
    })
    expect(r).toHaveLength(2)
    const auth = r.find((x) => x.systemSlug === "shared-auth")!
    const queues = r.find((x) => x.systemSlug === "shared-queues")!
    // shared-auth: explicit --connect wins.
    expect(auth.linkedRef.site).toBe("janes-macbook")
    // shared-queues: no explicit entry → --connect-to blanket fills in.
    expect(queues.linkedRef.site).toBe("workshop-staging")
  })

  test("no connect inputs → no linked SDs even if deps declared", () => {
    const r = resolveLinkedSystemDeployments({
      connects: [],
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
    })
    expect(r).toEqual([])
  })

  test("multiple connects covering multiple systems", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:staging-a", "shared-queues:staging-b"],
      catalog: makeCatalog([
        { system: "shared-auth", binding: "required" },
        { system: "shared-queues", binding: "required" },
      ]),
    })
    expect(r).toHaveLength(2)
    const auth = r.find((x) => x.systemSlug === "shared-auth")!
    const queues = r.find((x) => x.systemSlug === "shared-queues")!
    expect(auth.linkedRef.site).toBe("staging-a")
    expect(queues.linkedRef.site).toBe("staging-b")
  })

  test("duplicate entries for same system → first wins", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth:site-a", "shared-auth:site-b"],
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
    })
    expect(r).toHaveLength(1)
    expect(r[0].linkedRef.site).toBe("site-a")
  })

  test("malformed connect entry (no colon) → skipped silently", () => {
    const r = resolveLinkedSystemDeployments({
      connects: ["shared-auth", "shared-queues:workshop-staging"],
      catalog: makeCatalog([
        { system: "shared-auth", binding: "required" },
        { system: "shared-queues", binding: "required" },
      ]),
    })
    expect(r).toHaveLength(1)
    expect(r[0].systemSlug).toBe("shared-queues")
  })
})
