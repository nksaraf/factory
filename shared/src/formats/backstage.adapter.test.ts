import { describe, expect, it, vi, beforeEach } from "vitest";

import type { CatalogSystem } from "../catalog";
import { BackstageFormatAdapter } from "./backstage.adapter";

// ─── Helpers ──────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

function setupCatalogFile(
  rootDir: string,
  yamlContent: string,
  filename = "catalog-info.yaml",
) {
  mockExistsSync.mockImplementation((p: string) => {
    return p === `${rootDir}/${filename}`;
  });
  mockReadFileSync.mockReturnValue(yamlContent);
}

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
});

// ─── Full multi-document YAML fixture ─────────────────────────

const FULL_CATALOG = `apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: my-system
  namespace: default
  description: My system
spec:
  owner: group:default/backend
  domain: default/my-domain
  lifecycle: production
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: api
  namespace: default
spec:
  type: service
  lifecycle: production
  owner: group:default/backend
  system: system:default/my-system
  providesApis:
    - my-api
  dependsOn:
    - resource:default/postgres
---
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: postgres
  namespace: default
spec:
  type: database
  lifecycle: production
  owner: group:default/backend
  system: system:default/my-system
  dependencyOf:
    - component:default/api
---
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: my-api
  namespace: default
spec:
  type: openapi
  lifecycle: production
  owner: group:default/backend
  system: system:default/my-system
  definition: |
    openapi: 3.0.0
`;

// ─── Tests ────────────────────────────────────────────────────

describe("BackstageFormatAdapter", () => {
  describe("detect", () => {
    it("detects catalog-info.yaml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("catalog-info.yaml"),
      );
      const adapter = new BackstageFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(true);
    });

    it("detects catalog-info.yml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("catalog-info.yml"),
      );
      const adapter = new BackstageFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(true);
    });

    it("returns false when no catalog file exists", () => {
      mockExistsSync.mockReturnValue(false);
      const adapter = new BackstageFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(false);
    });
  });

  describe("parse", () => {
    it("parses multi-document YAML into CatalogSystem", () => {
      setupCatalogFile("/myproject", FULL_CATALOG);
      const adapter = new BackstageFormatAdapter();
      const result = adapter.parse("/myproject");

      // System
      expect(result.system.kind).toBe("System");
      expect(result.system.metadata.name).toBe("my-system");
      expect(result.system.spec.owner).toBe("backend");
      expect(result.system.spec.domain).toBe("my-domain");
      expect(result.system.spec.lifecycle).toBe("production");

      // Components
      expect(result.system.components.api).toBeDefined();
      expect(result.system.components.api.spec.type).toBe("service");
      expect(result.system.components.api.spec.providesApis).toEqual(["my-api"]);

      // Resources
      expect(result.system.resources.postgres).toBeDefined();
      expect(result.system.resources.postgres.spec.type).toBe("database");

      // APIs
      expect(result.system.apis?.["my-api"]).toBeDefined();
      expect(result.system.apis?.["my-api"].spec.type).toBe("openapi");
    });

    it("synthesizes system from directory name when no System entity", () => {
      const yaml = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: web
spec:
  type: service
  lifecycle: production
  owner: group:default/frontend
`;
      setupCatalogFile("/home/user/my-cool-app", yaml);
      const adapter = new BackstageFormatAdapter();
      const result = adapter.parse("/home/user/my-cool-app");

      expect(result.system.metadata.name).toBe("my-cool-app");
      expect(result.system.spec.owner).toBe("unknown");
      expect(result.system.components.web).toBeDefined();
    });

    it("correctly parses entity references", () => {
      setupCatalogFile("/myproject", FULL_CATALOG);
      const adapter = new BackstageFormatAdapter();
      const result = adapter.parse("/myproject");

      // Component dependsOn should be parsed from "resource:default/postgres" -> "postgres"
      expect(result.system.components.api.spec.dependsOn).toEqual(["postgres"]);

      // Resource dependencyOf should be parsed from "component:default/api" -> "api"
      expect(result.system.resources.postgres.spec.dependencyOf).toEqual(["api"]);

      // Owner should be parsed from "group:default/backend" -> "backend"
      expect(result.system.components.api.spec.owner).toBe("backend");
    });

    it("adds warning about connections not being supported", () => {
      setupCatalogFile("/myproject", FULL_CATALOG);
      const adapter = new BackstageFormatAdapter();
      const result = adapter.parse("/myproject");

      expect(result.warnings.some((w) => w.includes("connections"))).toBe(true);
      expect(result.system.connections).toEqual([]);
    });
  });

  describe("generate", () => {
    const system: CatalogSystem = {
      kind: "System",
      metadata: { name: "myapp", namespace: "default", description: "My app" },
      spec: { owner: "backend", domain: "commerce", lifecycle: "production" },
      components: {
        api: {
          kind: "Component",
          metadata: { name: "api", namespace: "default" },
          spec: {
            type: "service",
            lifecycle: "production",
            owner: "backend",
            providesApis: ["my-api"],
            dependsOn: ["postgres"],
            ports: [],
          },
        },
      },
      resources: {
        postgres: {
          kind: "Resource",
          metadata: { name: "postgres", namespace: "default" },
          spec: {
            type: "database",
            lifecycle: "production",
            owner: "backend",
            dependencyOf: ["api"],
            image: "postgres:16",
            ports: [],
          },
        },
      },
      apis: {
        "my-api": {
          kind: "API",
          metadata: { name: "my-api", namespace: "default" },
          spec: {
            type: "openapi",
            lifecycle: "production",
            owner: "backend",
            definition: "openapi: 3.0.0",
          },
        },
      },
      connections: [],
    };

    it("generates multi-document YAML with correct entity references", () => {
      const adapter = new BackstageFormatAdapter();
      const result = adapter.generate(system);

      const content = result.files["catalog-info.yaml"];
      expect(content).toBeDefined();

      // System entity first
      expect(content).toContain("kind: System");
      expect(content).toContain("name: myapp");
      expect(content).toContain("owner: group:default/backend");
      expect(content).toContain("domain: default/commerce");

      // Component
      expect(content).toContain("kind: Component");
      expect(content).toContain("system: system:default/myapp");
      expect(content).toContain("resource:default/postgres");

      // Resource
      expect(content).toContain("kind: Resource");
      expect(content).toContain("component:default/api");

      // API
      expect(content).toContain("kind: API");

      // Document separators
      expect(content).toContain("---");
    });

    it("warns when connections exist", () => {
      const systemWithConns: CatalogSystem = {
        ...system,
        connections: [
          {
            name: "auth",
            targetModule: "auth-service",
            targetComponent: "api",
            envVar: "AUTH_URL",
          },
        ],
      };
      const adapter = new BackstageFormatAdapter();
      const result = adapter.generate(systemWithConns);

      expect(result.warnings.some((w) => w.includes("connections"))).toBe(true);
    });

    it("does not warn about connections when there are none", () => {
      const adapter = new BackstageFormatAdapter();
      const result = adapter.generate(system);

      expect(
        result.warnings.some((w) => w.includes("connections")),
      ).toBe(false);
    });
  });

  describe("round-trip", () => {
    it("generate -> parse preserves key data", () => {
      const original: CatalogSystem = {
        kind: "System",
        metadata: { name: "roundtrip", namespace: "default" },
        spec: { owner: "platform", lifecycle: "production" },
        components: {
          web: {
            kind: "Component",
            metadata: { name: "web", namespace: "default" },
            spec: {
              type: "service",
              lifecycle: "production",
              owner: "platform",
              providesApis: ["web-api"],
              dependsOn: ["redis"],
              ports: [],
            },
          },
        },
        resources: {
          redis: {
            kind: "Resource",
            metadata: { name: "redis", namespace: "default" },
            spec: {
              type: "cache",
              lifecycle: "production",
              owner: "platform",
              dependencyOf: ["web"],
              image: "redis:7",
              ports: [],
            },
          },
        },
        apis: {
          "web-api": {
            kind: "API",
            metadata: { name: "web-api", namespace: "default" },
            spec: {
              type: "openapi",
              lifecycle: "production",
              owner: "platform",
              definition: "openapi: 3.0.0",
            },
          },
        },
        connections: [],
      };

      const adapter = new BackstageFormatAdapter();

      // Generate
      const generated = adapter.generate(original);
      const yamlContent = generated.files["catalog-info.yaml"];

      // Parse back
      setupCatalogFile("/roundtrip", yamlContent);
      const parsed = adapter.parse("/roundtrip");

      // Verify key data is preserved
      expect(parsed.system.metadata.name).toBe("roundtrip");
      expect(parsed.system.spec.owner).toBe("platform");
      expect(parsed.system.spec.lifecycle).toBe("production");

      // Components
      expect(parsed.system.components.web).toBeDefined();
      expect(parsed.system.components.web.spec.type).toBe("service");
      expect(parsed.system.components.web.spec.providesApis).toEqual(["web-api"]);
      expect(parsed.system.components.web.spec.dependsOn).toEqual(["redis"]);

      // Resources
      expect(parsed.system.resources.redis).toBeDefined();
      expect(parsed.system.resources.redis.spec.type).toBe("cache");
      expect(parsed.system.resources.redis.spec.dependencyOf).toEqual(["web"]);

      // APIs
      expect(parsed.system.apis?.["web-api"]).toBeDefined();
      expect(parsed.system.apis?.["web-api"].spec.type).toBe("openapi");
    });
  });
});
