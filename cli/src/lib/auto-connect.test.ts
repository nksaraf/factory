import { describe, expect, test } from "bun:test"

import type { CatalogSystem } from "@smp/factory-shared/catalog"

import { autoConnectsFromDeps } from "./auto-connect"

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

describe("autoConnectsFromDeps", () => {
  test("no dependencies → no auto-connects, no errors", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog(),
      hasExplicitConnect: false,
    })
    expect(result).toEqual({
      autoConnects: [],
      logs: [],
      warnings: [],
      errors: [],
    })
  })

  test("user passed explicit flags → skip auto-connect entirely", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
      ]),
      hasExplicitConnect: true,
    })
    expect(result.autoConnects).toEqual([])
  })

  test("required dep with defaultTarget → auto-connect + log", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
      ]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual(["shared-auth:workshop-staging"])
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0]).toContain("shared-auth")
    expect(result.logs[0]).toContain("workshop-staging")
    expect(result.errors).toEqual([])
  })

  test("multiple deps with defaultTargets → all auto-connect", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
        {
          system: "shared-queues",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
        {
          system: "shared-observability",
          binding: "dev-only",
          defaultTarget: "workshop-staging",
        },
      ]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual([
      "shared-auth:workshop-staging",
      "shared-queues:workshop-staging",
      "shared-observability:workshop-staging",
    ])
    expect(result.errors).toEqual([])
  })

  test("required dep with no defaultTarget → error with actionable hint", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("required")
    expect(result.errors[0]).toContain("shared-auth")
    expect(result.errors[0]).toContain("defaultTarget")
    expect(result.errors[0]).toContain("--connect shared-auth:")
  })

  test("optional dep with no defaultTarget → warning, no error", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        { system: "shared-notifications", binding: "optional" },
      ]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("shared-notifications")
    expect(result.warnings[0]).toContain("skipped")
    expect(result.errors).toEqual([])
  })

  test("dev-only dep with no defaultTarget → silently skip", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        { system: "shared-observability", binding: "dev-only" },
      ]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })

  test("mixed: some target, some not — partial resolution + errors", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
        { system: "shared-queues", binding: "required" }, // no target → error
        { system: "shared-notifications", binding: "optional" }, // no target → warn
      ]),
      hasExplicitConnect: false,
    })
    expect(result.autoConnects).toEqual(["shared-auth:workshop-staging"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("shared-queues")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("shared-notifications")
  })
})
