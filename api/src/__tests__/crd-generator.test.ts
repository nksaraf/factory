import type {
  ManifestDomain,
  ManifestRoute,
  ManifestV1,
} from "@smp/factory-shared/types"
import { describe, expect, it } from "bun:test"

import type { GatewayCRD } from "../adapters/gateway-adapter"
import {
  manifestDomainToCertificate,
  manifestRouteToIngressRoute,
  manifestToCRDs,
  manifestToMiddlewares,
} from "../lib/crd-generator"

const baseRoute: ManifestRoute = {
  routeId: "rte_abc123",
  kind: "sandbox",
  domain: "my-app.preview.dx.dev",
  pathPrefix: null,
  targetService: "web-svc",
  targetPort: 3000,
  protocol: "http",
  tlsMode: "auto",
  middlewares: [],
  priority: 100,
}

const baseDomain: ManifestDomain = {
  domainId: "dom_xyz789",
  fqdn: "app.example.com",
  kind: "custom",
  tlsCertRef: null,
}

function emptyManifest(): ManifestV1 {
  return {
    manifestVersion: 1,
    manifestHash: "abc123",
    targetRelease: null,
    configuration: {},
    routes: [],
    domains: [],
  }
}

describe("CRD Generator", () => {
  describe("manifestRouteToIngressRoute", () => {
    it("generates IngressRoute with Host match and TLS auto", () => {
      const crd = manifestRouteToIngressRoute(baseRoute, "default")

      expect(crd.apiVersion).toBe("traefik.io/v1alpha1")
      expect(crd.kind).toBe("IngressRoute")
      expect(crd.metadata.name).toBe("dx-rte-abc123")
      expect(crd.metadata.namespace).toBe("default")
      expect(crd.metadata.labels).toEqual({
        "managed-by": "dx",
        "dx-route-id": "rte_abc123",
        "dx-route-kind": "sandbox",
      })

      const routes = crd.spec.routes as Array<Record<string, unknown>>
      expect(routes).toHaveLength(1)
      expect(routes[0].match).toBe("Host(`my-app.preview.dx.dev`)")
      expect(routes[0].kind).toBe("Rule")
      expect(routes[0].priority).toBe(100)
      expect(routes[0].services).toEqual([{ name: "web-svc", port: 3000 }])
      expect(routes[0].middlewares).toBeUndefined()

      expect(crd.spec.entryPoints).toEqual(["websecure"])
      expect(crd.spec.tls).toEqual({ certResolver: "letsencrypt" })
    })

    it("includes PathPrefix in match when pathPrefix is set", () => {
      const route: ManifestRoute = { ...baseRoute, pathPrefix: "/api/v1" }
      const crd = manifestRouteToIngressRoute(route, "default")

      const routes = crd.spec.routes as Array<Record<string, unknown>>
      expect(routes[0].match).toBe(
        "Host(`my-app.preview.dx.dev`) && PathPrefix(`/api/v1`)"
      )
    })

    it("omits TLS when tlsMode is none", () => {
      const route: ManifestRoute = { ...baseRoute, tlsMode: "none" }
      const crd = manifestRouteToIngressRoute(route, "default")

      expect(crd.spec.tls).toBeUndefined()
    })

    it("uses secretName when tlsMode is custom", () => {
      const route: ManifestRoute = { ...baseRoute, tlsMode: "custom" }
      const crd = manifestRouteToIngressRoute(route, "default")

      expect(crd.spec.tls).toEqual({
        secretName: "my-app-preview-dx-dev-tls",
      })
    })
  })

  describe("manifestDomainToCertificate", () => {
    it("generates Certificate CRD with correct dnsNames and issuerRef", () => {
      const crd = manifestDomainToCertificate(
        baseDomain,
        "gateway",
        "letsencrypt-prod"
      )

      expect(crd.apiVersion).toBe("cert-manager.io/v1")
      expect(crd.kind).toBe("Certificate")
      expect(crd.metadata.name).toBe("dx-cert-dom-xyz789")
      expect(crd.metadata.namespace).toBe("gateway")
      expect(crd.metadata.labels).toEqual({
        "managed-by": "dx",
        "dx-domain-id": "dom_xyz789",
      })
      expect(crd.spec.secretName).toBe("app-example-com-tls")
      expect(crd.spec.dnsNames).toEqual(["app.example.com"])
      expect(crd.spec.issuerRef).toEqual({
        name: "letsencrypt-prod",
        kind: "ClusterIssuer",
      })
    })

    it("uses tlsCertRef as secretName when provided", () => {
      const domain: ManifestDomain = {
        ...baseDomain,
        tlsCertRef: "my-existing-secret",
      }
      const crd = manifestDomainToCertificate(
        domain,
        "gateway",
        "letsencrypt-prod"
      )

      expect(crd.spec.secretName).toBe("my-existing-secret")
    })
  })

  describe("manifestToMiddlewares", () => {
    it("generates deduplicated Middleware CRDs from routes", () => {
      const routes: ManifestRoute[] = [
        { ...baseRoute, routeId: "rte_1", middlewares: ["cors", "rate-limit"] },
        { ...baseRoute, routeId: "rte_2", middlewares: ["cors", "auth"] },
      ]
      const crds = manifestToMiddlewares(routes, "default")

      expect(crds).toHaveLength(3)

      const names = crds.map((c) => c.metadata.name)
      expect(names).toContain("dx-mw-cors")
      expect(names).toContain("dx-mw-rate-limit")
      expect(names).toContain("dx-mw-auth")

      const corsCrd = crds.find((c) => c.metadata.name === "dx-mw-cors")!
      expect(corsCrd.apiVersion).toBe("traefik.io/v1alpha1")
      expect(corsCrd.kind).toBe("Middleware")
      expect(
        (corsCrd.spec as any).headers.accessControlAllowOriginList
      ).toEqual(["*"])

      const rateCrd = crds.find((c) => c.metadata.name === "dx-mw-rate-limit")!
      expect((rateCrd.spec as any).rateLimit).toEqual({
        average: 100,
        burst: 50,
      })

      const authCrd = crds.find((c) => c.metadata.name === "dx-mw-auth")!
      expect((authCrd.spec as any).forwardAuth.address).toBe(
        "http://auth-service:8080/verify"
      )
    })

    it("returns empty array when no middlewares are used", () => {
      const crds = manifestToMiddlewares([baseRoute], "default")
      expect(crds).toHaveLength(0)
    })
  })

  describe("manifestToCRDs", () => {
    it("returns all empty arrays for empty manifest", () => {
      const result = manifestToCRDs(emptyManifest(), {
        namespace: "default",
        issuer: "letsencrypt-prod",
      })

      expect(result.ingressRoutes).toHaveLength(0)
      expect(result.certificates).toHaveLength(0)
      expect(result.middlewares).toHaveLength(0)
    })

    it("produces correct counts for a full manifest", () => {
      const manifest: ManifestV1 = {
        ...emptyManifest(),
        routes: [
          { ...baseRoute, routeId: "rte_1", middlewares: ["cors"] },
          { ...baseRoute, routeId: "rte_2", middlewares: ["cors", "auth"] },
          { ...baseRoute, routeId: "rte_3", middlewares: [] },
        ],
        domains: [
          { ...baseDomain, domainId: "dom_1", kind: "custom" },
          { ...baseDomain, domainId: "dom_2", kind: "alias" },
          { ...baseDomain, domainId: "dom_3", kind: "platform" },
        ],
      }

      const result = manifestToCRDs(manifest, {
        namespace: "gateway",
        issuer: "letsencrypt-prod",
      })

      expect(result.ingressRoutes).toHaveLength(3)
      expect(result.certificates).toHaveLength(2) // only custom + alias, not platform
      expect(result.middlewares).toHaveLength(2) // cors + auth (deduplicated)

      // Verify namespaces propagated
      for (const crd of [
        ...result.ingressRoutes,
        ...result.certificates,
        ...result.middlewares,
      ]) {
        expect(crd.metadata.namespace).toBe("gateway")
      }
    })
  })
})
