import { describe, expect, it } from "vitest"

import {
  KINDS_WITH_TRAEFIK_ROUTES,
  type TraefikRoute,
  generateTraefikYaml,
} from "../modules/infra/traefik-sync"

describe("generateTraefikYaml", () => {
  const baseRoute: TraefikRoute = {
    routeId: "rte_abc123",
    kind: "workspace",
    domain: "my-workspace.preview.dx.dev",
    pathPrefix: null,
    targetService: "workspace-svc",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 100,
    status: "active",
  }

  it("generates empty config for no routes", () => {
    const yaml = generateTraefikYaml([])
    expect(yaml).toContain("routers: {}")
    expect(yaml).toContain("services: {}")
  })

  it("generates router and service for a single route", () => {
    const yaml = generateTraefikYaml([baseRoute])
    expect(yaml).toContain("rte_abc123:")
    expect(yaml).toContain('rule: "Host(`my-workspace.preview.dx.dev`)"')
    expect(yaml).toContain("service: rte_abc123")
    expect(yaml).toContain("priority: 100")
    expect(yaml).toContain('url: "http://workspace-svc:3000"')
    expect(yaml).toContain("tls: {}")
  })

  it("includes path prefix in match rule", () => {
    const r: TraefikRoute = { ...baseRoute, pathPrefix: "/api/v1" }
    const yaml = generateTraefikYaml([r])
    expect(yaml).toContain(
      "Host(`my-workspace.preview.dx.dev`) && PathPrefix(`/api/v1`)"
    )
  })

  it("skips tls when tlsMode is none", () => {
    const r: TraefikRoute = { ...baseRoute, tlsMode: "none" }
    const yaml = generateTraefikYaml([r])
    expect(yaml).not.toContain("tls:")
  })

  it("defaults to port 80 when no targetPort", () => {
    const r: TraefikRoute = { ...baseRoute, targetPort: null }
    const yaml = generateTraefikYaml([r])
    expect(yaml).toContain('url: "http://workspace-svc:80"')
  })

  it("generates multiple routes", () => {
    const routes: TraefikRoute[] = [
      { ...baseRoute, routeId: "rte_1", domain: "a.preview.dx.dev" },
      { ...baseRoute, routeId: "rte_2", domain: "b.preview.dx.dev" },
    ]
    const yaml = generateTraefikYaml(routes)
    expect(yaml).toContain("rte_1:")
    expect(yaml).toContain("rte_2:")
    expect(yaml).toContain("a.preview.dx.dev")
    expect(yaml).toContain("b.preview.dx.dev")
  })

  it("generates config for custom_domain routes", () => {
    const routes: TraefikRoute[] = [
      {
        routeId: "rte_custom1",
        kind: "custom_domain",
        domain: "app.example.com",
        targetService: "app.example.com",
        protocol: "http",
        tlsMode: "custom",
        middlewares: [],
        priority: 100,
        status: "active",
      },
    ]
    const yaml = generateTraefikYaml(routes)
    expect(yaml).toContain("app.example.com")
    expect(yaml).toContain("rte_custom1")
  })

  it("generates config for ingress routes", () => {
    const routes: TraefikRoute[] = [
      {
        routeId: "rte_ingress1",
        kind: "ingress",
        domain: "api.prod.dx.dev",
        targetService: "api-service",
        targetPort: 8080,
        protocol: "http",
        tlsMode: "auto",
        middlewares: [],
        priority: 100,
        status: "active",
      },
    ]
    const yaml = generateTraefikYaml(routes)
    expect(yaml).toContain("api.prod.dx.dev")
  })

  it("returns empty config for no routes", () => {
    const yaml = generateTraefikYaml([])
    expect(yaml).toContain("routers: {}")
  })
})

describe("syncFactoryRoutes filtering", () => {
  it("only generates files for custom_domain and ingress kinds", () => {
    expect(KINDS_WITH_TRAEFIK_ROUTES).toEqual(["ingress", "custom_domain"])
  })
})
