import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { stringify } from "yaml";

import type { ServiceType } from "../lib/detect-service-type.js";

export interface TestProjectOptions {
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

  // Create marker files for component type detection
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
  }

  // Build docker-compose.yaml with services for components + dependencies
  const services: Record<string, Record<string, unknown>> = {};

  for (const [name, cfg] of Object.entries(opts?.components ?? {})) {
    services[name] = {
      build: { context: `./${name}` },
      ...(cfg.port != null
        ? { ports: [`${cfg.port}:${cfg.container_port ?? cfg.port}`] }
        : {}),
    };
  }

  for (const [name, dep] of Object.entries(opts?.dependencies ?? {})) {
    services[name] = {
      image: dep.image,
      ports: [`${dep.port}:${dep.container_port ?? dep.port}`],
      ...(dep.env ? { environment: dep.env } : {}),
    };
  }

  const compose = { services };
  writeFileSync(join(rootDir, "docker-compose.yaml"), stringify(compose), "utf8");

  return {
    rootDir,
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
