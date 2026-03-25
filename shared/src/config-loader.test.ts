import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  extractInlineComponentBody,
  loadFullConfig,
  mergeComponentYaml,
} from "./config-loader";

describe("mergeComponentYaml", () => {
  it("uses file-only when no inline body", () => {
    const merged = mergeComponentYaml(
      { image: "nginx:alpine", test: "pytest" },
      {}
    );
    expect(merged.image).toBe("nginx:alpine");
    expect(merged.test).toBe("pytest");
  });

  it("inline overrides file fields", () => {
    const merged = mergeComponentYaml(
      { image: "old:1", test: "pytest" },
      { image: "new:2" }
    );
    expect(merged.image).toBe("new:2");
    expect(merged.test).toBe("pytest");
  });

  it("merges dev command and sync", () => {
    const merged = mergeComponentYaml(
      { dev: { command: "a", sync: ["x:y"] } },
      { dev: { command: "b" } }
    );
    expect(merged.dev?.command).toBe("b");
    expect(merged.dev?.sync).toEqual(["x:y"]);
  });

  it("inline dev sync replaces when provided", () => {
    const merged = mergeComponentYaml(
      { dev: { sync: ["old:old"] } },
      { dev: { sync: ["n:n"] } }
    );
    expect(merged.dev?.sync).toEqual(["n:n"]);
  });
});

describe("extractInlineComponentBody + loadFullConfig", () => {
  it("loads inline component config from dx.yaml without dx-component.yaml", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "dx-full-"));
    writeFileSync(
      join(dir, "dx.yaml"),
      `
module: m
team: t
components:
  svc:
    path: ./svc
    port: 9000
    image: nginx:alpine
    test: npm test
`,
      "utf8"
    );
    mkdirSync(join(dir, "svc"), { recursive: true });
    const { module, components } = loadFullConfig(dir);
    expect(module.module).toBe("m");
    expect(components.svc?.image).toBe("nginx:alpine");
    expect(components.svc?.test).toBe("npm test");
  });

  it("inline wins over dx-component.yaml", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "dx-merge-"));
    mkdirSync(join(dir, "c"), { recursive: true });
    writeFileSync(
      join(dir, "dx.yaml"),
      `
module: m
team: t
components:
  c:
    path: ./c
    image: inline:1
`,
      "utf8"
    );
    writeFileSync(
      join(dir, "c", "dx-component.yaml"),
      `image: file:1\ntest: fromfile\n`,
      "utf8"
    );
    const { components } = loadFullConfig(dir);
    expect(components.c?.image).toBe("inline:1");
    expect(components.c?.test).toBe("fromfile");
  });
});

describe("extractInlineComponentBody", () => {
  it("extracts only yaml body keys", () => {
    const ref = {
      path: "./p",
      port: 1,
      worker: false as const,
      image: "x",
      test: "t",
    };
    const b = extractInlineComponentBody(ref);
    expect("path" in b && b.path).toBeFalsy();
    expect(b.image).toBe("x");
    expect(b.test).toBe("t");
  });
});
