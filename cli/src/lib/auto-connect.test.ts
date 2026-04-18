import { describe, expect, test } from "bun:test"

import type { CatalogSystem } from "@smp/factory-shared/catalog"

import {
  autoConnectsFromDeps,
  coveredSystemsFromConnectFlags,
} from "./auto-connect"

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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
    })
    expect(result).toEqual({
      autoConnects: [],
      logs: [],
      warnings: [],
      errors: [],
    })
  })

  test("--connect-to blanket flag → skip auto-connect entirely", () => {
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([
        {
          system: "shared-auth",
          binding: "required",
          defaultTarget: "workshop-staging",
        },
      ]),
      hasConnectToFlag: true,
      coveredSystems: new Set(),
    })
    expect(result.autoConnects).toEqual([])
  })

  test("per-system coverage: explicit --connect for one system, auto for others", () => {
    // User runs `dx dev --connect shared-auth:my-laptop`. The catalog
    // declares both shared-auth and shared-queues with defaultTarget. The
    // explicit flag covers shared-auth; shared-queues should still auto-connect.
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
      ]),
      hasConnectToFlag: false,
      coveredSystems: new Set(["shared-auth"]),
    })
    expect(result.autoConnects).toEqual(["shared-queues:workshop-staging"])
    expect(result.errors).toEqual([])
  })

  test("coveredSystems suppresses error for required-no-target too", () => {
    // shared-auth is required but has no defaultTarget. If the user covers
    // it with --connect shared-auth:<site>, no error should fire.
    const result = autoConnectsFromDeps({
      catalog: makeCatalog([{ system: "shared-auth", binding: "required" }]),
      hasConnectToFlag: false,
      coveredSystems: new Set(["shared-auth"]),
    })
    expect(result.errors).toEqual([])
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
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
      hasConnectToFlag: false,
      coveredSystems: new Set(),
    })
    expect(result.autoConnects).toEqual(["shared-auth:workshop-staging"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("shared-queues")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("shared-notifications")
  })
})

describe("coveredSystemsFromConnectFlags", () => {
  test("undefined → empty set", () => {
    expect(coveredSystemsFromConnectFlags(undefined)).toEqual(new Set())
  })

  test("empty array → empty set", () => {
    expect(coveredSystemsFromConnectFlags([])).toEqual(new Set())
  })

  test("single string → one entry", () => {
    expect(coveredSystemsFromConnectFlags("shared-auth:my-laptop")).toEqual(
      new Set(["shared-auth"])
    )
  })

  test("array of multiple entries", () => {
    expect(
      coveredSystemsFromConnectFlags([
        "shared-auth:my-laptop",
        "shared-queues:staging",
      ])
    ).toEqual(new Set(["shared-auth", "shared-queues"]))
  })

  test("entry without a colon is ignored", () => {
    expect(coveredSystemsFromConnectFlags("just-a-slug")).toEqual(new Set())
  })

  test("duplicate entries collapse into one", () => {
    expect(
      coveredSystemsFromConnectFlags([
        "shared-auth:site-a",
        "shared-auth:site-b",
      ])
    ).toEqual(new Set(["shared-auth"]))
  })
})
