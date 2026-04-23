import { describe, expect, it } from "bun:test"
import * as graph from "./schema/graph"

describe("graph schema", () => {
  it("exposes every Foundry-equivalent table on the graph namespace", () => {
    // Registry
    expect(graph.registry).toBeDefined()
    // Type schemas
    expect(graph.objectType).toBeDefined()
    expect(graph.linkType).toBeDefined()
    expect(graph.interfaceType).toBeDefined()
    expect(graph.sharedProperty).toBeDefined()
    expect(graph.valueType).toBeDefined()
    expect(graph.structType).toBeDefined()
    expect(graph.actionType).toBeDefined()
    expect(graph.functionType).toBeDefined()
    expect(graph.extension).toBeDefined()
    // Instances
    expect(graph.instance).toBeDefined()
    expect(graph.link).toBeDefined()
    expect(graph.extensionValue).toBeDefined()
    // Runtime caches
    expect(graph.uiOverride).toBeDefined()
    expect(graph.materializedDerived).toBeDefined()
  })
})
