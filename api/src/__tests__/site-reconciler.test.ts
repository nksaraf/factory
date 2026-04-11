import { describe, it, expect, beforeEach } from "bun:test"
import { NoopGatewayAdapter } from "../adapters/gateway-adapter-noop"
import { SiteReconciler } from "../modules/site/reconciler"
import {
  simpleSaasManifest,
  simpleSaasExpected,
  multiTenantManifest,
  multiTenantExpected,
  airGappedManifest,
  airGappedExpected,
} from "./fixtures/site-fixtures"

function createReconciler(adapter: NoopGatewayAdapter) {
  return new SiteReconciler(
    {
      siteName: "test-site",
      factoryUrl: "http://localhost:4100", // not used in push tests
      namespace: "default",
      issuerName: "letsencrypt-prod",
      pollIntervalMs: 30000,
    },
    adapter
  )
}

describe("SiteReconciler", () => {
  let adapter: NoopGatewayAdapter
  let reconciler: SiteReconciler

  beforeEach(() => {
    adapter = new NoopGatewayAdapter()
    reconciler = createReconciler(adapter)
  })

  describe("pushManifest", () => {
    it("applies simple-saas manifest correctly", async () => {
      const result = await reconciler.pushManifest(simpleSaasManifest)

      expect(result.success).toBe(true)
      expect(result.manifestVersion).toBe(1)
      expect(result.appliedCRDs).toBe(
        simpleSaasExpected.ingressRoutes +
          simpleSaasExpected.certificates +
          simpleSaasExpected.middlewares
      )
      expect(result.errors).toHaveLength(0)

      const crds = await adapter.getCurrentState()
      expect(crds).toHaveLength(2) // 2 IngressRoutes only
      expect(crds.every((c) => c.kind === "IngressRoute")).toBe(true)
    })

    it("applies multi-tenant manifest with all CRD types", async () => {
      const result = await reconciler.pushManifest(multiTenantManifest)

      expect(result.success).toBe(true)
      expect(result.manifestVersion).toBe(3)

      const crds = await adapter.getCurrentState()
      const total =
        multiTenantExpected.ingressRoutes +
        multiTenantExpected.certificates +
        multiTenantExpected.middlewares
      expect(crds).toHaveLength(total)

      const byKind = {
        IngressRoute: crds.filter((c) => c.kind === "IngressRoute"),
        Certificate: crds.filter((c) => c.kind === "Certificate"),
        Middleware: crds.filter((c) => c.kind === "Middleware"),
      }
      expect(byKind.IngressRoute).toHaveLength(
        multiTenantExpected.ingressRoutes
      )
      expect(byKind.Certificate).toHaveLength(multiTenantExpected.certificates)
      expect(byKind.Middleware).toHaveLength(multiTenantExpected.middlewares)
    })

    it("applies air-gapped manifest with custom TLS", async () => {
      const result = await reconciler.pushManifest(airGappedManifest)

      expect(result.success).toBe(true)
      const crds = await adapter.getCurrentState()

      const ingressRoutes = crds.filter((c) => c.kind === "IngressRoute")
      expect(ingressRoutes).toHaveLength(1)
      // Custom TLS should use secretName
      expect(ingressRoutes[0].spec.tls).toEqual({
        secretName: "internal-corp-local-tls",
      })

      const certs = crds.filter((c) => c.kind === "Certificate")
      expect(certs).toHaveLength(1)
      expect(certs[0].spec.secretName).toBe("corp-self-signed-tls")
    })
  })

  describe("status tracking", () => {
    it("starts in idle mode", () => {
      const status = reconciler.getStatus()
      expect(status.mode).toBe("idle")
      expect(status.currentManifestVersion).toBe(0)
      expect(status.lastReconcileAt).toBeNull()
    })

    it("updates status after pushManifest", async () => {
      await reconciler.pushManifest(simpleSaasManifest)

      const status = reconciler.getStatus()
      expect(status.mode).toBe("push")
      expect(status.currentManifestVersion).toBe(1)
      expect(status.lastReconcileAt).not.toBeNull()
      expect(status.lastReconcileResult?.success).toBe(true)
      expect(status.adapterType).toBe("noop")
    })
  })

  describe("stale CRD cleanup", () => {
    it("deletes stale CRDs when manifest changes", async () => {
      // First apply multi-tenant (9 CRDs)
      await reconciler.pushManifest(multiTenantManifest)
      let crds = await adapter.getCurrentState()
      const initialCount = crds.length

      // Now apply simple-saas (2 CRDs) — should delete the multi-tenant ones
      const result = await reconciler.pushManifest(simpleSaasManifest)

      expect(result.deletedCRDs).toBe(initialCount) // all 9 old CRDs deleted (new ones have different names)

      crds = await adapter.getCurrentState()
      expect(crds).toHaveLength(2)
      expect(crds.every((c) => c.kind === "IngressRoute")).toBe(true)
    })
  })

  describe("getCRDs", () => {
    it("returns current CRDs from adapter", async () => {
      await reconciler.pushManifest(simpleSaasManifest)
      const crds = await reconciler.getCRDs()
      expect(crds).toHaveLength(2)
    })
  })
})
