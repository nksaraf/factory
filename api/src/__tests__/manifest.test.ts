import { describe, expect, it } from "vitest";
import { computeManifest } from "../lib/manifest";

describe("computeManifest", () => {
  const baseSite = { siteId: "site_1", name: "prod-us", product: "smp" };

  it("computes manifest with release and pins", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: {
        releaseId: "rel_1",
        version: "1.0.0",
        pins: [
          { moduleVersionId: "mv_1", moduleName: "core", version: "1.0.0" },
        ],
      },
    });

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.manifestHash).toBeTruthy();
    expect(manifest.targetRelease).not.toBeNull();
    expect(manifest.targetRelease!.releaseId).toBe("rel_1");
    expect(manifest.targetRelease!.releaseVersion).toBe("1.0.0");
    expect(manifest.targetRelease!.modulePins).toHaveLength(1);
    expect(manifest.targetRelease!.modulePins[0].moduleName).toBe("core");
  });

  it("computes manifest without release", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: null,
    });

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.manifestHash).toBeTruthy();
    expect(manifest.targetRelease).toBeNull();
    expect(manifest.configuration).toEqual({});
  });

  it("produces deterministic hashes", () => {
    const input = {
      site: baseSite,
      release: {
        releaseId: "rel_1",
        version: "1.0.0",
        pins: [
          { moduleVersionId: "mv_1", moduleName: "core", version: "1.0.0" },
        ],
      },
    } as const;

    const m1 = computeManifest(input);
    const m2 = computeManifest(input);
    expect(m1.manifestHash).toBe(m2.manifestHash);
  });

  it("increments version from previousVersion", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: null,
      previousVersion: 5,
    });

    expect(manifest.manifestVersion).toBe(6);
  });

  it("includes configuration in manifest", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: null,
      configuration: { featureFlags: { newUI: true } },
    });

    expect(manifest.configuration).toEqual({ featureFlags: { newUI: true } });
  });

  it("defaults routes and domains to empty arrays", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: null,
    });

    expect(manifest.routes).toEqual([]);
    expect(manifest.domains).toEqual([]);
  });

  it("includes routes and domains in manifest", () => {
    const manifest = computeManifest({
      site: baseSite,
      release: null,
      routes: [
        {
          routeId: "rte_1",
          kind: "ingress",
          domain: "api.prod-us.dx.dev",
          targetService: "api-svc",
          targetPort: 8080,
          protocol: "http",
          tlsMode: "auto",
          middlewares: ["cors"],
          priority: 100,
        },
      ],
      domains: [
        {
          domainId: "dom_1",
          fqdn: "app.acme.com",
          kind: "custom",
          tlsCertRef: "acme-cert",
        },
      ],
    });

    expect(manifest.routes).toHaveLength(1);
    expect(manifest.routes[0].domain).toBe("api.prod-us.dx.dev");
    expect(manifest.domains).toHaveLength(1);
    expect(manifest.domains[0].fqdn).toBe("app.acme.com");
  });

  it("routes change the manifest hash", () => {
    const base = { site: baseSite, release: null };
    const m1 = computeManifest(base);
    const m2 = computeManifest({
      ...base,
      routes: [
        {
          routeId: "rte_1",
          kind: "ingress",
          domain: "api.prod-us.dx.dev",
          targetService: "api-svc",
          targetPort: 8080,
          protocol: "http",
          tlsMode: "auto",
          middlewares: [],
          priority: 100,
        },
      ],
    });
    expect(m1.manifestHash).not.toBe(m2.manifestHash);
  });

  it("produces different hashes for different releases", () => {
    const m1 = computeManifest({
      site: baseSite,
      release: {
        releaseId: "rel_1",
        version: "1.0.0",
        pins: [],
      },
    });
    const m2 = computeManifest({
      site: baseSite,
      release: {
        releaseId: "rel_2",
        version: "2.0.0",
        pins: [],
      },
    });

    expect(m1.manifestHash).not.toBe(m2.manifestHash);
  });
});
