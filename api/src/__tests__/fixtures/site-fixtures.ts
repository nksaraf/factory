import type {
  ManifestDomain,
  ManifestRoute,
  ManifestV1,
} from "@smp/factory-shared/types"

// ---- simple-saas: Basic production site ----
// 2 ingress routes (api + web), 1 platform domain, TLS auto, no middlewares

const simpleSaasRoutes: ManifestRoute[] = [
  {
    routeId: "rte_ss_api",
    kind: "ingress",
    domain: "api.simple-saas.dx.dev",
    pathPrefix: "/api/v1",
    targetService: "api-svc",
    targetPort: 8080,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 100,
  },
  {
    routeId: "rte_ss_web",
    kind: "ingress",
    domain: "simple-saas.dx.dev",
    pathPrefix: null,
    targetService: "web-svc",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 100,
  },
]

const simpleSaasDomains: ManifestDomain[] = [
  {
    domainId: "dom_ss_platform",
    fqdn: "simple-saas.dx.dev",
    kind: "platform",
    tlsCertRef: null,
  },
]

export const simpleSaasManifest: ManifestV1 = {
  manifestVersion: 1,
  manifestHash: "hash_simple_saas",
  targetRelease: null,
  configuration: {},
  routes: simpleSaasRoutes,
  domains: simpleSaasDomains,
}

// Expected: 2 IngressRoutes, 0 Certificates (platform domain uses wildcard), 0 Middlewares
export const simpleSaasExpected = {
  ingressRoutes: 2,
  certificates: 0,
  middlewares: 0,
}

// ---- multi-tenant: Complex production site ----
// 5 routes (2 ingress + 2 sandbox + 1 preview)
// 3 domains (1 platform + 2 custom)
// Middlewares: cors, rate-limit

const multiTenantRoutes: ManifestRoute[] = [
  {
    routeId: "rte_mt_api",
    kind: "ingress",
    domain: "api.multi-tenant.dx.dev",
    pathPrefix: "/api/v1",
    targetService: "api-gateway",
    targetPort: 8080,
    protocol: "http",
    tlsMode: "auto",
    middlewares: ["cors", "rate-limit"],
    priority: 100,
  },
  {
    routeId: "rte_mt_web",
    kind: "ingress",
    domain: "app.multi-tenant.dx.dev",
    pathPrefix: null,
    targetService: "web-app",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: ["cors"],
    priority: 100,
  },
  {
    routeId: "rte_mt_sbox1",
    kind: "sandbox",
    domain: "feature-x.multi-tenant.dx.dev",
    pathPrefix: null,
    targetService: "sandbox-feature-x",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 50,
  },
  {
    routeId: "rte_mt_sbox2",
    kind: "sandbox",
    domain: "feature-y.multi-tenant.dx.dev",
    pathPrefix: null,
    targetService: "sandbox-feature-y",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 50,
  },
  {
    routeId: "rte_mt_preview",
    kind: "preview",
    domain: "pr-42.preview.multi-tenant.dx.dev",
    pathPrefix: null,
    targetService: "preview-pr-42",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 50,
  },
]

const multiTenantDomains: ManifestDomain[] = [
  {
    domainId: "dom_mt_platform",
    fqdn: "multi-tenant.dx.dev",
    kind: "platform",
    tlsCertRef: null,
  },
  {
    domainId: "dom_mt_custom1",
    fqdn: "app.acme.com",
    kind: "custom",
    tlsCertRef: null,
  },
  {
    domainId: "dom_mt_custom2",
    fqdn: "dashboard.acme.com",
    kind: "alias",
    tlsCertRef: "acme-wildcard-tls",
  },
]

export const multiTenantManifest: ManifestV1 = {
  manifestVersion: 3,
  manifestHash: "hash_multi_tenant",
  targetRelease: {
    releaseId: "rel_001",
    releaseVersion: "1.2.0",
    modulePins: [
      { moduleVersionId: "mv_1", moduleName: "api-gateway", version: "1.2.0" },
      { moduleVersionId: "mv_2", moduleName: "web-app", version: "1.2.0" },
    ],
  },
  configuration: { featureFlags: { betaUI: true } },
  routes: multiTenantRoutes,
  domains: multiTenantDomains,
}

// Expected: 5 IngressRoutes, 2 Certificates (custom + alias, not platform), 2 Middlewares (cors + rate-limit deduplicated)
export const multiTenantExpected = {
  ingressRoutes: 5,
  certificates: 2,
  middlewares: 2,
}

// ---- air-gapped: Offline site ----
// 1 ingress route, 1 custom domain, TLS custom (self-signed)
// No factory polling — manifest pushed directly

const airGappedRoutes: ManifestRoute[] = [
  {
    routeId: "rte_ag_web",
    kind: "ingress",
    domain: "internal.corp.local",
    pathPrefix: null,
    targetService: "corp-portal",
    targetPort: 8443,
    protocol: "http",
    tlsMode: "custom",
    middlewares: [],
    priority: 100,
  },
]

const airGappedDomains: ManifestDomain[] = [
  {
    domainId: "dom_ag_internal",
    fqdn: "internal.corp.local",
    kind: "custom",
    tlsCertRef: "corp-self-signed-tls",
  },
]

export const airGappedManifest: ManifestV1 = {
  manifestVersion: 1,
  manifestHash: "hash_air_gapped",
  targetRelease: null,
  configuration: {},
  routes: airGappedRoutes,
  domains: airGappedDomains,
}

// Expected: 1 IngressRoute, 1 Certificate (custom domain), 0 Middlewares
export const airGappedExpected = {
  ingressRoutes: 1,
  certificates: 1,
  middlewares: 0,
}
