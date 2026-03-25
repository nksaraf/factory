import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { stringify } from "yaml";

import type { ServiceType } from "../lib/detect-service-type.js";

export interface TestProjectOptions {
  module?: string;
  team?: string;
  components?: Record<
    string,
    {
      type?: ServiceType;
      port?: number;
      container_port?: number;
    }
  >;
  dependencies?: Record<
    string,
    {
      image: string;
      port: number;
      container_port?: number;
      env?: Record<string, string>;
    }
  >;
}

export interface TestProject {
  rootDir: string;
  cleanup(): void;
}

const MARKER_FILES: Record<string, string> = {
  node: "package.json",
  python: "pyproject.toml",
  java: "pom.xml",
};

export function createTestProject(opts?: TestProjectOptions): TestProject {
  const rootDir = mkdtempSync(join(tmpdir(), "dx-test-"));
  mkdirSync(join(rootDir, ".dx"), { recursive: true });

  const components: Record<string, Record<string, unknown>> = {};
  for (const [name, cfg] of Object.entries(opts?.components ?? {})) {
    const compDir = join(rootDir, name);
    mkdirSync(compDir, { recursive: true });

    if (cfg.type) {
      const marker = MARKER_FILES[cfg.type];
      if (marker) {
        writeFileSync(
          join(compDir, marker),
          cfg.type === "node" ? '{"name":"test"}' : "",
          "utf8",
        );
      }
    }

    components[name] = {
      path: `./${name}`,
      ...(cfg.port != null ? { port: cfg.port } : {}),
      ...(cfg.container_port != null
        ? { container_port: cfg.container_port }
        : {}),
    };
  }

  const dxYaml = {
    module: opts?.module ?? "test",
    team: opts?.team ?? "test-team",
    components,
    dependencies: opts?.dependencies ?? {},
    connections: {},
  };

  writeFileSync(join(rootDir, "dx.yaml"), stringify(dxYaml), "utf8");

  return {
    rootDir,
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
