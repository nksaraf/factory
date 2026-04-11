import type {
  ManifestRoute,
  ManifestDomain,
  ManifestV1,
} from "@smp/factory-shared/types"
import type { GatewayCRD } from "../adapters/gateway-adapter"

function sanitizeName(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()
}

export function manifestRouteToIngressRoute(
  route: ManifestRoute,
  namespace: string
): GatewayCRD {
  let match = `Host(\`${route.domain}\`)`
  if (route.pathPrefix && route.pathPrefix !== "/") {
    match += ` && PathPrefix(\`${route.pathPrefix}\`)`
  }

  const routeObj: Record<string, unknown> = {
    match,
    kind: "Rule",
    priority: route.priority,
    services: [{ name: route.targetService, port: route.targetPort ?? 80 }],
  }

  if (route.middlewares.length > 0) {
    routeObj.middlewares = route.middlewares.map((mw) => ({ name: mw }))
  }

  const spec: Record<string, unknown> = {
    entryPoints: ["websecure"],
    routes: [routeObj],
  }

  if (route.tlsMode === "auto") {
    spec.tls = { certResolver: "letsencrypt" }
  } else if (route.tlsMode === "custom") {
    spec.tls = { secretName: route.domain.replace(/\./g, "-") + "-tls" }
  }
  // tlsMode "none" → no tls key

  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: `dx-${sanitizeName(route.routeId)}`,
      namespace,
      labels: {
        "managed-by": "dx",
        "dx-route-id": route.routeId,
        "dx-route-kind": route.kind,
      },
    },
    spec,
  }
}

export function manifestDomainToCertificate(
  domain: ManifestDomain,
  namespace: string,
  issuer: string
): GatewayCRD {
  return {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: `dx-cert-${sanitizeName(domain.domainId)}`,
      namespace,
      labels: {
        "managed-by": "dx",
        "dx-domain-id": domain.domainId,
      },
    },
    spec: {
      secretName: domain.tlsCertRef ?? domain.fqdn.replace(/\./g, "-") + "-tls",
      dnsNames: [domain.fqdn],
      issuerRef: { name: issuer, kind: "ClusterIssuer" },
    },
  }
}

export function manifestToMiddlewares(
  routes: ManifestRoute[],
  namespace: string
): GatewayCRD[] {
  const seen = new Set<string>()
  for (const route of routes) {
    for (const mw of route.middlewares) {
      seen.add(String(mw))
    }
  }

  return Array.from(seen).map((name) => {
    let spec: Record<string, unknown>
    switch (name) {
      case "cors":
        spec = {
          headers: {
            accessControlAllowMethods: [
              "GET",
              "POST",
              "PUT",
              "DELETE",
              "OPTIONS",
            ],
            accessControlAllowOriginList: ["*"],
            accessControlAllowHeaders: ["*"],
          },
        }
        break
      case "rate-limit":
        spec = { rateLimit: { average: 100, burst: 50 } }
        break
      case "auth":
        spec = { forwardAuth: { address: "http://auth-service:8080/verify" } }
        break
      default:
        spec = { headers: {} }
        break
    }

    return {
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `dx-mw-${sanitizeName(name)}`,
        namespace,
        labels: { "managed-by": "dx" },
      },
      spec,
    }
  })
}

export function manifestToCRDs(
  manifest: ManifestV1,
  opts: { namespace: string; issuer: string }
): {
  ingressRoutes: GatewayCRD[]
  certificates: GatewayCRD[]
  middlewares: GatewayCRD[]
} {
  const ingressRoutes = manifest.routes.map((r) =>
    manifestRouteToIngressRoute(r, opts.namespace)
  )

  const certificates = manifest.domains
    .filter((d) => d.kind === "custom" || d.kind === "alias")
    .map((d) => manifestDomainToCertificate(d, opts.namespace, opts.issuer))

  const middlewares = manifestToMiddlewares(manifest.routes, opts.namespace)

  return { ingressRoutes, certificates, middlewares }
}
