import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectToolchain, resolveVariant } from "../lib/toolchain-detector.js";

// ─── Fixture path helper ────────────────────────────────────

const fixtures = path.resolve(__dirname, "fixtures/toolchain");
const fixture = (name: string) => path.join(fixtures, name);

// ─── Tests ──────────────────────────────────────────────────

describe("toolchain-detector", () => {
  // ── Runtime detection ───────────────────────────────────

  describe("runtime detection", () => {
    it("detects Node.js from package.json", () => {
      expect(detectToolchain(fixture("node-minimal")).runtime).toBe("node");
    });

    it("detects Python from pyproject.toml", () => {
      expect(detectToolchain(fixture("python-fullstack")).runtime).toBe("python");
    });

    it("detects Go from go.mod", () => {
      expect(detectToolchain(fixture("go-basic")).runtime).toBe("go");
    });

    it("detects Rust from Cargo.toml", () => {
      expect(detectToolchain(fixture("rust-basic")).runtime).toBe("rust");
    });

    it("detects Java from pom.xml", () => {
      expect(detectToolchain(fixture("java-spring")).runtime).toBe("java");
    });

    it("returns null for empty directory", () => {
      expect(detectToolchain(fixture("empty")).runtime).toBeNull();
    });
  });

  // ── Package manager detection ───────────────────────────

  describe("package manager detection", () => {
    it("detects pnpm from packageManager field", () => {
      expect(detectToolchain(fixture("node-fullstack")).packageManager).toBe("pnpm");
    });

    it("detects pnpm from pnpm-lock.yaml", () => {
      // node-fullstack has pnpm-lock.yaml
      expect(detectToolchain(fixture("node-fullstack")).packageManager).toBe("pnpm");
    });

    it("defaults to pnpm when no lockfile", () => {
      expect(detectToolchain(fixture("node-minimal")).packageManager).toBe("pnpm");
    });
  });

  // ── Node.js full stack ──────────────────────────────────

  describe("Node.js full-stack project", () => {
    const tc = () => detectToolchain(fixture("node-fullstack"));

    it("detects vitest as test runner", () => {
      const t = tc();
      expect(t.testRunner).not.toBeNull();
      expect(t.testRunner!.tool).toBe("vitest");
      expect(t.testRunner!.configFile).toBe("vitest.config.ts");
      expect(t.testRunner!.runCmd).toBe("vitest run");
      expect(t.testRunner!.source).toBe("auto-detect");
    });

    it("detects eslint as linter", () => {
      const t = tc();
      expect(t.linter).not.toBeNull();
      expect(t.linter!.tool).toBe("eslint");
      expect(t.linter!.configFile).toBe("eslint.config.js");
    });

    it("detects prettier as formatter", () => {
      const t = tc();
      expect(t.formatter).not.toBeNull();
      expect(t.formatter!.tool).toBe("prettier");
      expect(t.formatter!.configFile).toBe(".prettierrc");
    });

    it("detects tsc as type checker", () => {
      const t = tc();
      expect(t.typeChecker).not.toBeNull();
      expect(t.typeChecker!.tool).toBe("tsc");
      expect(t.typeChecker!.configFile).toBe("tsconfig.json");
    });

    it("detects drizzle as migration tool", () => {
      const t = tc();
      expect(t.migrationTool).not.toBeNull();
      expect(t.migrationTool!.tool).toBe("drizzle");
      expect(t.migrationTool!.configFile).toBe("drizzle.config.ts");
    });

    it("detects drizzle-kit as codegen", () => {
      const t = tc();
      expect(t.codegen.length).toBeGreaterThanOrEqual(1);
      expect(t.codegen.some((g) => g.tool === "drizzle-kit")).toBe(true);
    });
  });

  // ── Biome project ──────────────────────────────────────

  describe("Node.js project with Biome", () => {
    it("detects biome as both linter and formatter", () => {
      const tc = detectToolchain(fixture("node-biome"));
      expect(tc.linter).not.toBeNull();
      expect(tc.linter!.tool).toBe("biome");
      expect(tc.formatter).not.toBeNull();
      expect(tc.formatter!.tool).toBe("biome");
    });
  });

  // ── Script overrides ──────────────────────────────────

  describe("package.json script overrides", () => {
    it("prefers test script from package.json over auto-detect", () => {
      const tc = detectToolchain(fixture("node-script-overrides"));
      expect(tc.testRunner).not.toBeNull();
      expect(tc.testRunner!.source).toBe("package.json");
      expect(tc.testRunner!.runCmd).toBe("vitest run --pool=forks --reporter=verbose");
    });

    it("prefers lint script from package.json over auto-detect", () => {
      const tc = detectToolchain(fixture("node-lint-override"));
      expect(tc.linter).not.toBeNull();
      expect(tc.linter!.source).toBe("package.json");
      expect(tc.linter!.runCmd).toBe("custom-linter --strict");
    });
  });

  // ── Prisma ────────────────────────────────────────────

  describe("Prisma-based project", () => {
    it("detects prisma for both migrations and codegen", () => {
      const tc = detectToolchain(fixture("node-prisma"));
      expect(tc.migrationTool).not.toBeNull();
      expect(tc.migrationTool!.tool).toBe("prisma");
      expect(tc.migrationTool!.runCmd).toBe("prisma migrate deploy");

      expect(tc.codegen.length).toBeGreaterThanOrEqual(1);
      expect(tc.codegen[0]!.tool).toBe("prisma");
      expect(tc.codegen[0]!.runCmd).toBe("prisma generate");
    });
  });

  // ── Jest ──────────────────────────────────────────────

  describe("Jest-based project", () => {
    it("detects jest from config file", () => {
      const tc = detectToolchain(fixture("node-jest"));
      expect(tc.testRunner).not.toBeNull();
      expect(tc.testRunner!.tool).toBe("jest");
      expect(tc.testRunner!.runCmd).toBe("jest");
    });

    it("detects jest from package.json jest key", () => {
      const tc = detectToolchain(fixture("node-jest-pkg"));
      expect(tc.testRunner).not.toBeNull();
      expect(tc.testRunner!.tool).toBe("jest");
    });
  });

  // ── Python ────────────────────────────────────────────

  describe("Python project with ruff + pytest", () => {
    it("detects python toolchain", () => {
      const tc = detectToolchain(fixture("python-fullstack"));
      expect(tc.runtime).toBe("python");
      expect(tc.testRunner).not.toBeNull();
      expect(tc.testRunner!.tool).toBe("pytest");
      expect(tc.linter).not.toBeNull();
      expect(tc.linter!.tool).toBe("ruff");
      expect(tc.formatter).not.toBeNull();
      expect(tc.formatter!.tool).toBe("ruff");
    });
  });

  // ── Go ────────────────────────────────────────────────

  describe("Go project", () => {
    it("detects go toolchain with built-in test and format", () => {
      const tc = detectToolchain(fixture("go-basic"));
      expect(tc.runtime).toBe("go");
      expect(tc.testRunner).not.toBeNull();
      expect(tc.testRunner!.tool).toBe("go-test");
      expect(tc.testRunner!.runCmd).toBe("go test ./...");
      expect(tc.formatter).not.toBeNull();
      expect(tc.formatter!.tool).toBe("gofmt");
      expect(tc.typeChecker).toBeNull();
    });

    it("detects golangci-lint when config exists", () => {
      const tc = detectToolchain(fixture("go-lint"));
      expect(tc.linter).not.toBeNull();
      expect(tc.linter!.tool).toBe("golangci-lint");
    });
  });

  // ── Framework detection ───────────────────────────────

  describe("framework detection", () => {
    it("detects Next.js", () => {
      expect(detectToolchain(fixture("next-app")).framework).toBe("next");
    });

    it("detects Vite", () => {
      expect(detectToolchain(fixture("vite-app")).framework).toBe("vite");
    });

    it("detects Elysia from dependency", () => {
      expect(detectToolchain(fixture("elysia-api")).framework).toBe("elysia");
    });

    it("detects FastAPI from pyproject.toml", () => {
      expect(detectToolchain(fixture("python-fastapi")).framework).toBe("fastapi");
    });

    it("detects Spring Boot from pom.xml", () => {
      expect(detectToolchain(fixture("java-spring")).framework).toBe("spring-boot");
    });
  });

  // ── Variant resolution ────────────────────────────────

  describe("resolveVariant", () => {
    it("resolves test:watch via vitest", () => {
      const tool = { tool: "vitest", configFile: "vitest.config.ts", runCmd: "vitest run", source: "auto-detect" as const };
      const variant = resolveVariant("test", "watch", tool, null);
      expect(variant).not.toBeNull();
      expect(variant!.runCmd).toBe("vitest");
    });

    it("resolves test:coverage via vitest", () => {
      const tool = { tool: "vitest", configFile: "vitest.config.ts", runCmd: "vitest run", source: "auto-detect" as const };
      const variant = resolveVariant("test", "coverage", tool, null);
      expect(variant).not.toBeNull();
      expect(variant!.runCmd).toBe("vitest run --coverage");
    });

    it("prefers package.json script over variant adaptation", () => {
      const tool = { tool: "vitest", configFile: "vitest.config.ts", runCmd: "vitest run", source: "auto-detect" as const };
      const pkg = { scripts: { "test:watch": "vitest --ui --reporter=verbose" } };
      const variant = resolveVariant("test", "watch", tool, pkg);
      expect(variant).not.toBeNull();
      expect(variant!.source).toBe("package.json");
      expect(variant!.runCmd).toBe("vitest --ui --reporter=verbose");
    });

    it("resolves test:integration for jest", () => {
      const tool = { tool: "jest", configFile: "jest.config.ts", runCmd: "jest", source: "auto-detect" as const };
      const variant = resolveVariant("test", "integration", tool, null);
      expect(variant).not.toBeNull();
    });

    it("resolves test:integration for go", () => {
      const tool = { tool: "go-test", configFile: "go.mod", runCmd: "go test ./...", source: "auto-detect" as const };
      const variant = resolveVariant("test", "integration", tool, null);
      expect(variant).not.toBeNull();
      expect(variant!.runCmd).toBe("go test -tags=integration ./...");
    });
  });

  // ── Minimal project ───────────────────────────────────

  describe("minimal project (no tools)", () => {
    it("returns nulls for all tool slots", () => {
      const tc = detectToolchain(fixture("node-minimal"));
      expect(tc.runtime).toBe("node");
      expect(tc.testRunner).toBeNull();
      expect(tc.linter).toBeNull();
      expect(tc.formatter).toBeNull();
      expect(tc.typeChecker).toBeNull();
      expect(tc.migrationTool).toBeNull();
      expect(tc.codegen).toEqual([]);
      expect(tc.framework).toBeNull();
    });
  });
});
