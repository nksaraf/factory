import {
  RealmTypeSchema,
  ResolvedTargetSchema,
  ReverseProxyRealmSpecSchema,
  RouteSchema,
  RouteStatusSchema,
} from "@smp/factory-shared/schemas/infra"
import type { RouteTarget } from "@smp/factory-shared/schemas/infra"
import { describe, expect, test } from "vitest"

import {
  type DbReader,
  resolveRouteTargets,
} from "../modules/infra/route-resolver"

describe("reverse-proxy realm type", () => {
  test("RealmTypeSchema accepts 'reverse-proxy'", () => {
    const result = RealmTypeSchema.safeParse("reverse-proxy")
    expect(result.success).toBe(true)
  })

  test("ReverseProxyRealmSpecSchema validates proxy fields", () => {
    const result = ReverseProxyRealmSpecSchema.safeParse({
      engine: "traefik",
      entrypoints: [{ name: "websecure", port: 443, protocol: "https" }],
      configRef: "infra/traefik/traefik.yml",
      dynamicConfigDir: "/etc/traefik/dynamic/",
    })
    expect(result.success).toBe(true)
  })

  test("ReverseProxyRealmSpecSchema rejects unknown engine", () => {
    const result = ReverseProxyRealmSpecSchema.safeParse({ engine: "haproxy" })
    expect(result.success).toBe(false)
  })
})

describe("route status schema", () => {
  test("ResolvedTargetSchema validates a k8s target", () => {
    const result = ResolvedTargetSchema.safeParse({
      systemDeploymentSlug: "api-prod",
      componentSlug: "api-server",
      address: "api-server.production.svc.cluster.local",
      port: 8080,
      weight: 100,
      realmType: "k8s-namespace",
    })
    expect(result.success).toBe(true)
  })

  test("RouteStatusSchema validates resolved state", () => {
    const result = RouteStatusSchema.safeParse({
      resolvedTargets: [
        {
          systemDeploymentSlug: "api-prod",
          componentSlug: "api-server",
          address: "10.0.1.5",
          port: 8080,
          weight: 100,
          realmType: "systemd",
        },
      ],
      resolvedAt: "2026-04-03T12:00:00Z",
      phase: "resolved",
    })
    expect(result.success).toBe(true)
  })

  test("RouteSchema now includes reconciliation fields", () => {
    const result = RouteSchema.safeParse({
      id: "rte_test123",
      slug: "my-route",
      name: "My Route",
      type: "ingress",
      domain: "api.prod.dx.dev",
      realmId: null,
      spec: {
        domain: "api.prod.dx.dev",
        targets: [
          {
            tenantSlug: "acme",
            systemDeploymentSlug: "api",
            port: 8080,
            weight: 100,
          },
        ],
      },
      status: {},
      generation: 0,
      observedGeneration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(result.success).toBe(true)
  })
})

// ── Route Resolver Tests ──────────────────────────────────────

describe("resolveRouteTargets", () => {
  test("k8s-namespace: resolves to service DNS", async () => {
    const targets: RouteTarget[] = [
      {
        tenantSlug: "acme",
        systemDeploymentSlug: "api-prod",
        port: 8080,
        weight: 100,
      },
    ]

    const mockReader: DbReader = {
      findSystemDeployments: async () => [
        {
          id: "sdp_1",
          slug: "api-prod",
          tenantSlug: "acme",
          realmId: "rt_1",
          spec: { namespace: "production" },
        },
      ],
      findComponentDeployments: async () => [
        {
          systemDeploymentId: "sdp_1",
          componentId: "cmp_1",
        },
      ],
      findComponents: async () => [
        {
          id: "cmp_1",
          slug: "api-server",
          spec: { ports: [{ name: "http", port: 8080, protocol: "http" }] },
        },
      ],
      findRealms: async () => [
        {
          id: "rt_1",
          type: "k8s-namespace",
          hostId: null,
          slug: "prod-ns",
        },
      ],
      findHosts: async () => [],
    }

    const status = await resolveRouteTargets(targets, mockReader)
    expect(status.phase).toBe("resolved")
    expect(status.resolvedTargets).toHaveLength(1)
    expect(status.resolvedTargets[0].address).toBe(
      "api-server.production.svc.cluster.local"
    )
    expect(status.resolvedTargets[0].port).toBe(8080)
    expect(status.resolvedTargets[0].realmType).toBe("k8s-namespace")
  })

  test("systemd: resolves to host IP", async () => {
    const targets: RouteTarget[] = [
      {
        tenantSlug: "acme",
        systemDeploymentSlug: "api-prod",
        port: 8080,
        weight: 100,
      },
    ]

    const mockReader: DbReader = {
      findSystemDeployments: async () => [
        {
          id: "sdp_1",
          slug: "api-prod",
          tenantSlug: "acme",
          realmId: "rt_1",
          spec: {},
        },
      ],
      findComponentDeployments: async () => [
        {
          systemDeploymentId: "sdp_1",
          componentId: "cmp_1",
        },
      ],
      findComponents: async () => [
        {
          id: "cmp_1",
          slug: "api-server",
          spec: { ports: [{ name: "http", port: 8080, protocol: "http" }] },
        },
      ],
      findRealms: async () => [
        {
          id: "rt_1",
          type: "systemd",
          hostId: "host_1",
          slug: "systemd-rt",
        },
      ],
      findHosts: async () => [
        {
          id: "host_1",
          spec: { ipAddress: "10.0.1.5" },
        },
      ],
    }

    const status = await resolveRouteTargets(targets, mockReader)
    expect(status.phase).toBe("resolved")
    expect(status.resolvedTargets[0].address).toBe("10.0.1.5")
    expect(status.resolvedTargets[0].port).toBe(8080)
  })

  test("compose-project: returns error phase", async () => {
    const targets: RouteTarget[] = [
      {
        tenantSlug: "acme",
        systemDeploymentSlug: "api-dev",
        port: 3000,
        weight: 100,
      },
    ]

    const mockReader: DbReader = {
      findSystemDeployments: async () => [
        {
          id: "sdp_1",
          slug: "api-dev",
          tenantSlug: "acme",
          realmId: "rt_1",
          spec: {},
        },
      ],
      findComponentDeployments: async () => [
        {
          systemDeploymentId: "sdp_1",
          componentId: "cmp_1",
        },
      ],
      findComponents: async () => [
        {
          id: "cmp_1",
          slug: "api",
          spec: { ports: [{ name: "http", port: 3000, protocol: "http" }] },
        },
      ],
      findRealms: async () => [
        {
          id: "rt_1",
          type: "compose-project",
          hostId: "host_1",
          slug: "dev-compose",
        },
      ],
      findHosts: async () => [
        { id: "host_1", spec: { ipAddress: "10.0.1.10" } },
      ],
    }

    const status = await resolveRouteTargets(targets, mockReader)
    expect(status.phase).toBe("error")
    expect(status.resolutionError).toContain("compose")
  })

  test("missing system deployment: returns error", async () => {
    const targets: RouteTarget[] = [
      {
        tenantSlug: "acme",
        systemDeploymentSlug: "nonexistent",
        port: 8080,
        weight: 100,
      },
    ]

    const mockReader: DbReader = {
      findSystemDeployments: async () => [],
      findComponentDeployments: async () => [],
      findComponents: async () => [],
      findRealms: async () => [],
      findHosts: async () => [],
    }

    const status = await resolveRouteTargets(targets, mockReader)
    expect(status.phase).toBe("error")
    expect(status.resolutionError).toContain("nonexistent")
  })

  test("empty targets: returns resolved immediately", async () => {
    const mockReader: DbReader = {
      findSystemDeployments: async () => [],
      findComponentDeployments: async () => [],
      findComponents: async () => [],
      findRealms: async () => [],
      findHosts: async () => [],
    }

    const status = await resolveRouteTargets([], mockReader)
    expect(status.phase).toBe("resolved")
    expect(status.resolvedTargets).toHaveLength(0)
  })
})
