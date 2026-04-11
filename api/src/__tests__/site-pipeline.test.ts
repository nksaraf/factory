import { describe, it, expect, beforeEach } from "bun:test"
import { computeManifest } from "../lib/manifest"
import { NoopGatewayAdapter } from "../adapters/gateway-adapter-noop"
import { SiteReconciler } from "../modules/site/reconciler"
import type { ManifestRoute, ManifestDomain } from "@smp/factory-shared/types"

function createReconciler(adapter: NoopGatewayAdapter) {
  return new SiteReconciler(
    {
      siteName: "pipeline-test-site",
      factoryUrl: "http://localhost:4100",
      namespace: "production",
      issuerName: "letsencrypt-prod",
      pollIntervalMs: 30000,
    },
    adapter
  )
}

describe("Site Gateway Pipeline", () => {
  let adapter: NoopGatewayAdapter
  let reconciler: SiteReconciler

  beforeEach(() => {
    adapter = new NoopGatewayAdapter()
    reconciler = createReconciler(adapter)
  })

  it("factory manifest → site reconciler → CRDs applied", async () => {
    // Simulate factory computing a manifest
    const routes: ManifestRoute[] = [
      {
        routeId: "rte_pipe_api",
        kind: "ingress",
        domain: "api.myapp.dx.dev",
        pathPrefix: "/api/v1",
        targetService: "api-svc",
        targetPort: 8080,
        protocol: "http",
        tlsMode: "auto",
        middlewares: ["cors"],
        priority: 100,
      },
      {
        routeId: "rte_pipe_web",
        kind: "ingress",
        domain: "myapp.dx.dev",
        pathPrefix: null,
        targetService: "web-svc",
        targetPort: 3000,
        protocol: "http",
        tlsMode: "auto",
        middlewares: [],
        priority: 100,
      },
    ]

    const domains: ManifestDomain[] = [
      {
        domainId: "dom_pipe_custom",
        fqdn: "myapp.example.com",
        kind: "custom",
        tlsCertRef: null,
      },
    ]

    const manifest = computeManifest({
      site: { siteId: "site_001", name: "pipeline-test", product: "myapp" },
      release: {
        releaseId: "rel_001",
        version: "1.0.0",
        pins: [
          { moduleVersionId: "mv_1", moduleName: "api", version: "1.0.0" },
        ],
      },
      routes,
      domains,
    })

    // Site reconciler receives and applies manifest
    const result = await reconciler.pushManifest(manifest)

    expect(result.success).toBe(true)
    expect(result.manifestVersion).toBe(1)

    const crds = await adapter.getCurrentState()
    // 2 IngressRoutes + 1 Certificate (custom domain) + 1 Middleware (cors)
    expect(crds).toHaveLength(4)

    const ingressRoutes = crds.filter((c) => c.kind === "IngressRoute")
    expect(ingressRoutes).toHaveLength(2)

    const certs = crds.filter((c) => c.kind === "Certificate")
    expect(certs).toHaveLength(1)
    expect(certs[0].spec.dnsNames).toEqual(["myapp.example.com"])
    expect(certs[0].metadata.namespace).toBe("production")

    const middlewares = crds.filter((c) => c.kind === "Middleware")
    expect(middlewares).toHaveLength(1)
    expect(middlewares[0].metadata.name).toBe("dx-mw-cors")
  })

  it("manifest version progression updates reconciler state", async () => {
    const manifest1 = computeManifest({
      site: { siteId: "site_001", name: "pipeline-test", product: "myapp" },
      release: null,
      routes: [
        {
          routeId: "rte_v1",
          kind: "ingress",
          domain: "v1.dx.dev",
          pathPrefix: null,
          targetService: "svc-v1",
          targetPort: 80,
          protocol: "http",
          tlsMode: "auto",
          middlewares: [],
          priority: 100,
        },
      ],
      domains: [],
    })

    await reconciler.pushManifest(manifest1)
    expect(reconciler.getStatus().currentManifestVersion).toBe(1)

    const manifest2 = computeManifest({
      site: { siteId: "site_001", name: "pipeline-test", product: "myapp" },
      release: null,
      routes: [
        {
          routeId: "rte_second",
          kind: "ingress",
          domain: "second.dx.dev",
          pathPrefix: null,
          targetService: "svc-second",
          targetPort: 80,
          protocol: "http",
          tlsMode: "auto",
          middlewares: [],
          priority: 100,
        },
      ],
      domains: [],
      previousVersion: 1,
    })

    const result = await reconciler.pushManifest(manifest2)
    expect(result.manifestVersion).toBe(2)
    expect(result.deletedCRDs).toBe(1) // old rte_v1 IngressRoute deleted

    const crds = await adapter.getCurrentState()
    expect(crds).toHaveLength(1)
    expect(crds[0].metadata.labels["dx-route-id"]).toBe("rte_second")
  })

  it("empty manifest cleans up all CRDs", async () => {
    // Apply a manifest with routes first
    const manifest1 = computeManifest({
      site: { siteId: "site_001", name: "pipeline-test", product: "myapp" },
      release: null,
      routes: [
        {
          routeId: "rte_cleanup",
          kind: "ingress",
          domain: "cleanup.dx.dev",
          pathPrefix: null,
          targetService: "svc",
          targetPort: 80,
          protocol: "http",
          tlsMode: "auto",
          middlewares: ["cors"],
          priority: 100,
        },
      ],
      domains: [
        {
          domainId: "dom_cleanup",
          fqdn: "cleanup.example.com",
          kind: "custom",
          tlsCertRef: null,
        },
      ],
    })
    await reconciler.pushManifest(manifest1)

    let crds = await adapter.getCurrentState()
    expect(crds.length).toBeGreaterThan(0)

    // Apply empty manifest
    const emptyManifest = computeManifest({
      site: { siteId: "site_001", name: "pipeline-test", product: "myapp" },
      release: null,
      routes: [],
      domains: [],
      previousVersion: 1,
    })
    const result = await reconciler.pushManifest(emptyManifest)

    expect(result.deletedCRDs).toBeGreaterThan(0)
    crds = await adapter.getCurrentState()
    expect(crds).toHaveLength(0)
  })
})
