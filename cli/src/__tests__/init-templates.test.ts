import { describe, expect, it } from "vitest";

import { toJavaPackage, STANDALONE_TYPES, type TemplateVars, type StandaloneType } from "../templates/types.js";
import { componentLabels, resourceLabels, labelsToYaml } from "../templates/compose-labels.js";
import { generateProject, generateStandalone } from "../templates/index.js";

// ─── toJavaPackage ──────────────────────────────────────────────────────────

describe("toJavaPackage", () => {
  it("strips hyphens and lowercases", () => {
    expect(toJavaPackage("my-service")).toBe("myservice");
    expect(toJavaPackage("data-svc")).toBe("datasvc");
    expect(toJavaPackage("s3-utils")).toBe("s3utils");
    expect(toJavaPackage("simple")).toBe("simple");
    expect(toJavaPackage("UPPER-CASE")).toBe("uppercase");
  });
});

// ─── Compose Labels ─────────────────────────────────────────────────────────

describe("componentLabels", () => {
  it("generates basic labels", () => {
    const labels = componentLabels({ owner: "team", description: "My API" });
    expect(labels["catalog.owner"]).toBe("team");
    expect(labels["catalog.description"]).toBe("My API");
  });

  it("includes optional type and runtime", () => {
    const labels = componentLabels({ type: "service", owner: "team", description: "API", runtime: "node" });
    expect(labels["catalog.type"]).toBe("service");
    expect(labels["dx.runtime"]).toBe("node");
  });

  it("includes port labels", () => {
    const labels = componentLabels({
      owner: "team",
      description: "API",
      port: { number: 3000, name: "http", protocol: "http" },
    });
    expect(labels["catalog.port.3000.name"]).toBe("http");
    expect(labels["catalog.port.3000.protocol"]).toBe("http");
  });
});

describe("resourceLabels", () => {
  it("always includes type", () => {
    const labels = resourceLabels({ type: "database", owner: "team", description: "PostgreSQL" });
    expect(labels["catalog.type"]).toBe("database");
    expect(labels["catalog.owner"]).toBe("team");
  });
});

describe("labelsToYaml", () => {
  it("formats labels with indentation", () => {
    const yaml = labelsToYaml({ "catalog.type": "service", "catalog.owner": "team" }, 6);
    expect(yaml).toBe('      catalog.type: "service"\n      catalog.owner: "team"');
  });
});

// ─── Template Generators ────────────────────────────────────────────────────

const vars: TemplateVars = { name: "test-proj", owner: "platform", description: "" };

describe("generateProject", () => {
  const files = generateProject(vars);
  const paths = files.map((f) => f.path);

  it("generates root config files", () => {
    expect(paths).toContain("package.json");
    expect(paths).toContain("pnpm-workspace.yaml");
    expect(paths).toContain("catalog.yaml");
    expect(paths).toContain("docker-compose.yaml");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain(".prettierrc");
  });

  it("generates compose files for all services", () => {
    expect(paths).toContain("compose/postgres.yml");
    expect(paths).toContain("compose/auth.yml");
    expect(paths).toContain("compose/gateway.yml");
    expect(paths).toContain("compose/test-proj-api.yml");
    expect(paths).toContain("compose/test-proj-app.yml");
  });

  it("generates starter service files under services/", () => {
    const servicePaths = paths.filter((p) => p.startsWith("services/test-proj-api/"));
    expect(servicePaths.length).toBeGreaterThan(5);
    expect(servicePaths).toContain("services/test-proj-api/package.json");
    expect(servicePaths).toContain("services/test-proj-api/src/server.ts");
  });

  it("generates starter app files under apps/", () => {
    const appPaths = paths.filter((p) => p.startsWith("apps/test-proj-app/"));
    expect(appPaths.length).toBeGreaterThan(5);
    expect(appPaths).toContain("apps/test-proj-app/package.json");
    expect(appPaths).toContain("apps/test-proj-app/src/entry.client.tsx");
  });

  it("does NOT include docker-compose.yaml inside service dir", () => {
    expect(paths).not.toContain("services/test-proj-api/docker-compose.yaml");
  });

  it("generates placeholder directories", () => {
    expect(paths).toContain("packages/npm/.gitkeep");
    expect(paths).toContain("packages/java/.gitkeep");
    expect(paths).toContain("packages/python/.gitkeep");
    expect(paths).toContain("docs/.gitkeep");
    expect(paths).toContain("scripts/.gitkeep");
  });

  it("generates .dx state files", () => {
    expect(paths).toContain(".dx/ports.json");
    expect(paths).toContain(".dx/packages.json");
  });

  it("generates infra config files", () => {
    expect(paths).toContain("infra/apisix/config.yaml");
    expect(paths).toContain("infra/auth/auth.settings.yaml");
  });

  it("interpolates name in root package.json", () => {
    const pkg = files.find((f) => f.path === "package.json")!;
    const parsed = JSON.parse(pkg.content);
    expect(parsed.name).toBe("test-proj");
  });

  it("interpolates owner in catalog.yaml", () => {
    const catalog = files.find((f) => f.path === "catalog.yaml")!;
    expect(catalog.content).toContain("owner: platform");
  });

  it("docker-compose.yaml includes all compose files", () => {
    const dc = files.find((f) => f.path === "docker-compose.yaml")!;
    expect(dc.content).toContain("compose/postgres.yml");
    expect(dc.content).toContain("compose/test-proj-api.yml");
    expect(dc.content).toContain("compose/test-proj-app.yml");
  });

  it("generates 30+ files total", () => {
    expect(files.length).toBeGreaterThan(30);
  });
});

// ─── Standalone Generators ──────────────────────────────────────────────────

describe("generateStandalone", () => {
  const allTypes: StandaloneType[] = STANDALONE_TYPES.map((t) => t.value);

  for (const type of allTypes) {
    it(`${type} generates non-empty file list`, () => {
      const files = generateStandalone(type, { name: "test", owner: "team", description: "" });
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(file.path).toBeTruthy();
        expect(file.content).toBeDefined();
      }
    });
  }

  it("service types generate docker-compose.yaml", () => {
    for (const type of ["node-api", "java-api", "python-api"] as StandaloneType[]) {
      const files = generateStandalone(type, vars);
      const paths = files.map((f) => f.path);
      expect(paths).toContain("docker-compose.yaml");
    }
  });

  it("library types do NOT generate docker-compose.yaml", () => {
    for (const type of ["node-lib", "java-lib", "python-lib", "ui-lib"] as StandaloneType[]) {
      const files = generateStandalone(type, vars);
      const paths = files.map((f) => f.path);
      expect(paths).not.toContain("docker-compose.yaml");
    }
  });

  it("web-app does NOT generate docker-compose.yaml", () => {
    const files = generateStandalone("web-app", vars);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain("docker-compose.yaml");
  });

  it("java types use correct package path", () => {
    const files = generateStandalone("java-api", { name: "my-service", owner: "team", description: "" });
    const paths = files.map((f) => f.path);
    // "my-service" -> "myservice"
    const javaFiles = paths.filter((p) => p.includes("software/lepton"));
    expect(javaFiles.some((p) => p.includes("myservice"))).toBe(true);
  });

  it("python-lib uses underscore module name", () => {
    const files = generateStandalone("python-lib", { name: "my-utils", owner: "team", description: "" });
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.includes("my_utils"))).toBe(true);
  });

  it("node-api includes auth plugin", () => {
    const files = generateStandalone("node-api", vars);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/plugins/auth.plugin.ts");
  });

  it("throws for unknown type", () => {
    expect(() => generateStandalone("unknown" as any, vars)).toThrow();
  });
});
