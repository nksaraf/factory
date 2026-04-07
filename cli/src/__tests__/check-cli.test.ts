import { describe, it, expect } from "vitest";
import {
  resolveRuntime,
  buildComponentContext,
} from "../lib/quality/index.js";
import type { CatalogComponent } from "@smp/factory-shared/catalog";
import { computeExitCode } from "../handlers/check/reporter.js";
import type { CheckReport, ComponentReport } from "../lib/quality/types.js";
import { qualityConventionsSchema } from "@smp/factory-shared/conventions-schema";

// ── Runtime Detection ──────────────────────────────────────

describe("resolveRuntime", () => {
  it("prefers spec.runtime when set", () => {
    const comp = {
      kind: "Component",
      metadata: { name: "api", namespace: "default" },
      spec: { runtime: "python", build: { context: "." }, ports: [] },
    } as unknown as CatalogComponent;
    expect(resolveRuntime(comp, "/tmp")).toBe("python");
  });

  it("returns null when no runtime info available", () => {
    const comp = {
      kind: "Component",
      metadata: { name: "api", namespace: "default" },
      spec: { build: { context: "/tmp/empty-dir-that-doesnt-exist" }, ports: [] },
    } as unknown as CatalogComponent;
    expect(resolveRuntime(comp, "/")).toBeNull();
  });
});

describe("buildComponentContext", () => {
  it("returns null when runtime cannot be detected", () => {
    const comp = {
      kind: "Component",
      metadata: { name: "unknown", namespace: "default" },
      spec: { build: { context: "/tmp/no-such-dir" }, ports: [] },
    } as unknown as CatalogComponent;
    expect(buildComponentContext("unknown", comp, "/")).toBeNull();
  });

  it("builds context with declared runtime", () => {
    const comp = {
      kind: "Component",
      metadata: { name: "api", namespace: "default" },
      spec: { runtime: "node", build: { context: "api" }, ports: [] },
    } as unknown as CatalogComponent;
    const ctx = buildComponentContext("api", comp, "/project");
    expect(ctx).toEqual({
      name: "api",
      dir: "/project/api",
      runtime: "node",
    });
  });
});

// ── Exit Code Computation ──────────────────────────────────

describe("computeExitCode", () => {
  const quality = qualityConventionsSchema.parse({
    lint: { block_pr: true },
    format: { block_pr: false },
  });

  function makeReport(components: ComponentReport[]): CheckReport {
    return { components, quality };
  }

  it("returns 0 when all checks pass", () => {
    const report = makeReport([
      {
        component: { name: "api", dir: "/api", runtime: "node" },
        results: [
          { kind: "lint", tool: "oxlint", passed: true, duration: 100, output: "" },
        ],
      },
    ]);
    expect(computeExitCode(report, false)).toBe(0);
    expect(computeExitCode(report, true)).toBe(0);
  });

  it("returns 1 when a blocking check fails in CI mode", () => {
    const report = makeReport([
      {
        component: { name: "api", dir: "/api", runtime: "node" },
        results: [
          { kind: "lint", tool: "oxlint", passed: false, duration: 100, output: "error" },
        ],
      },
    ]);
    expect(computeExitCode(report, true)).toBe(1);
  });

  it("returns 0 when only advisory checks fail in CI mode", () => {
    const report = makeReport([
      {
        component: { name: "api", dir: "/api", runtime: "node" },
        results: [
          { kind: "format", tool: "prettier", passed: false, duration: 100, output: "error" },
        ],
      },
    ]);
    expect(computeExitCode(report, true)).toBe(0);
  });

  it("returns 1 for any failure in non-CI mode", () => {
    const report = makeReport([
      {
        component: { name: "api", dir: "/api", runtime: "node" },
        results: [
          { kind: "format", tool: "prettier", passed: false, duration: 100, output: "error" },
        ],
      },
    ]);
    expect(computeExitCode(report, false)).toBe(1);
  });

  it("skips skipped results", () => {
    const report = makeReport([
      {
        component: { name: "api", dir: "/api", runtime: "node" },
        results: [
          { kind: "lint", tool: "oxlint", passed: true, duration: 0, output: "", skipped: true },
        ],
      },
    ]);
    expect(computeExitCode(report, true)).toBe(0);
  });
});
