import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { runDx } from "./run-dx.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-init-test-"));
}

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-init-home-"));
}

function readFile(dir: string, ...segments: string[]): string {
  return readFileSync(path.join(dir, ...segments), "utf8");
}

// ─── Project Mode (non-interactive, flag-driven) ────────────────────────────

describe("dx init — project mode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("creates full monorepo structure with --name and --owner", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "my-platform");
    const { status, stdout, stderr } = runDx(
      ["init", "--name", "my-platform", "--owner", "platform", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("my-platform");
    expect(stdout).toContain("Next steps");

    // Root files
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "pnpm-workspace.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, "catalog.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true);
    expect(existsSync(path.join(dir, ".prettierrc"))).toBe(true);

    // Compose directory
    expect(existsSync(path.join(dir, "compose/postgres.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "compose/auth.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "compose/gateway.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "compose/my-platform-api.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "compose/my-platform-app.yml"))).toBe(true);

    // Starter service
    expect(existsSync(path.join(dir, "services/my-platform-api/package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "services/my-platform-api/src/server.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "services/my-platform-api/src/plugins/auth.plugin.ts"))).toBe(true);

    // Starter app
    expect(existsSync(path.join(dir, "apps/my-platform-app/package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "apps/my-platform-app/src/entry.client.tsx"))).toBe(true);

    // Package dirs
    expect(existsSync(path.join(dir, "packages/npm/.gitkeep"))).toBe(true);
    expect(existsSync(path.join(dir, "packages/java/.gitkeep"))).toBe(true);
    expect(existsSync(path.join(dir, "packages/python/.gitkeep"))).toBe(true);

    // .dx state
    expect(existsSync(path.join(dir, ".dx/ports.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".dx/packages.json"))).toBe(true);

    // Infra
    expect(existsSync(path.join(dir, "infra/apisix/config.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, "infra/auth/auth.settings.yaml"))).toBe(true);
  });

  it("docker-compose.yaml uses include for all compose files", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "proj");
    runDx(["init", "--name", "proj", "--owner", "team", "--dir", dir], { home });

    const compose = readFile(dir, "docker-compose.yaml");
    expect(compose).toContain("include:");
    expect(compose).toContain("compose/postgres.yml");
    expect(compose).toContain("compose/auth.yml");
    expect(compose).toContain("compose/gateway.yml");
    expect(compose).toContain("compose/proj-api.yml");
    expect(compose).toContain("compose/proj-app.yml");
  });

  it("compose files contain catalog labels", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "labeled");
    runDx(["init", "--name", "labeled", "--owner", "ops", "--dir", dir], { home });

    const postgres = readFile(dir, "compose/postgres.yml");
    expect(postgres).toContain("catalog.type");
    expect(postgres).toContain("catalog.owner");
    expect(postgres).toContain("ops");

    const api = readFile(dir, "compose/labeled-api.yml");
    expect(api).toContain("catalog.type: service");
    expect(api).toContain("dx.runtime");
  });

  it("catalog.yaml contains Backstage domain and systems", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "cat");
    runDx(["init", "--name", "cat", "--owner", "eng", "--dir", dir], { home });

    const catalog = readFile(dir, "catalog.yaml");
    expect(catalog).toContain("kind: Domain");
    expect(catalog).toContain("name: cat");
    expect(catalog).toContain("kind: System");
    expect(catalog).toContain("name: apps");
    expect(catalog).toContain("name: services");
    expect(catalog).toContain("name: infra");
    expect(catalog).toContain("owner: eng");
  });

  it("--json returns structured output", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "json-test");
    const { status, stdout, stderr } = runDx(
      ["init", "--name", "json-test", "--owner", "team", "--dir", dir, "--json"],
      { home },
    );

    expect(status).toBe(0);
    expect(stderr).toBe("");

    const body = JSON.parse(stdout) as {
      success: boolean;
      name: string;
      mode: string;
      owner: string;
      files: string[];
    };
    expect(body.success).toBe(true);
    expect(body.name).toBe("json-test");
    expect(body.mode).toBe("project");
    expect(body.owner).toBe("team");
    expect(body.files.length).toBeGreaterThan(20);
    expect(body.files).toContain("docker-compose.yaml");
    expect(body.files).toContain("compose/postgres.yml");
  });

  it("refuses to overwrite existing project without --force", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    // First init
    const dir = path.join(target, "existing");
    runDx(["init", "--name", "existing", "--owner", "team", "--dir", dir], { home });

    // Second init (no --force)
    const { status, stderr } = runDx(
      ["init", "--name", "existing", "--owner", "team", "--dir", dir],
      { home },
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain("--force");
  });

  it("--force allows overwriting existing project", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "overwrite");
    runDx(["init", "--name", "overwrite", "--owner", "a", "--dir", dir], { home });

    const { status } = runDx(
      ["init", "--name", "overwrite", "--owner", "b", "--dir", dir, "--force"],
      { home },
    );
    expect(status).toBe(0);

    // Verify new owner is in generated files
    const compose = readFile(dir, "compose/postgres.yml");
    expect(compose).toContain("catalog.owner: b");
  });

  it("positional argument creates a subdirectory", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    // Use --dir to control where the positional arg creates the subdir
    const dir = path.join(target, "sub-project");
    const { status, stdout, stderr } = runDx(
      ["init", "--name", "sub-project", "--owner", "team", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("sub-project");
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
  });
});

// ─── Standalone Mode ────────────────────────────────────────────────────────

describe("dx init — standalone mode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("node-api generates expected files", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "my-api");
    const { status } = runDx(
      ["init", "--standalone", "--type", "node-api", "--name", "my-api", "--owner", "backend", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(path.join(dir, "src/server.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "src/health.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "src/plugins/auth.plugin.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "src/db/connection.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "src/db/schema/index.ts"))).toBe(true);

    const pkg = JSON.parse(readFile(dir, "package.json"));
    expect(pkg.name).toBe("my-api");
    expect(pkg.dependencies).toHaveProperty("elysia");
    expect(pkg.dependencies).toHaveProperty("drizzle-orm");
  });

  it("web-app generates expected files without docker-compose", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "my-app");
    const { status } = runDx(
      ["init", "--standalone", "--type", "web-app", "--name", "my-app", "--owner", "frontend", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "app.config.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "tailwind.config.cjs"))).toBe(true);
    expect(existsSync(path.join(dir, "src/entry.client.tsx"))).toBe(true);
    expect(existsSync(path.join(dir, "src/routes/index/page.tsx"))).toBe(true);
    // web-app should NOT have docker-compose
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false);
  });

  it("java-api generates Spring Boot structure", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "data-svc");
    const { status } = runDx(
      ["init", "--standalone", "--type", "java-api", "--name", "data-svc", "--owner", "data", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "pom.xml"))).toBe(true);
    expect(existsSync(path.join(dir, "server/pom.xml"))).toBe(true);
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true);

    // Java package uses toJavaPackage: "data-svc" -> "datasvc"
    const appJava = path.join(dir, "server/src/main/java/software/lepton/service/datasvc/Application.java");
    expect(existsSync(appJava)).toBe(true);
    expect(readFile(appJava)).toContain("@SpringBootApplication");
  });

  it("python-api generates FastAPI structure", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "ml-svc");
    const { status } = runDx(
      ["init", "--standalone", "--type", "python-api", "--name", "ml-svc", "--owner", "ml", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "pyproject.toml"))).toBe(true);
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(path.join(dir, "src/main.py"))).toBe(true);
    expect(existsSync(path.join(dir, "src/config.py"))).toBe(true);

    const main = readFile(dir, "src/main.py");
    expect(main).toContain("FastAPI");
    expect(main).toContain("/health");
  });

  it("java-lib generates Maven library structure", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "s3-utils");
    const { status } = runDx(
      ["init", "--standalone", "--type", "java-lib", "--name", "s3-utils", "--owner", "platform", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "pom.xml"))).toBe(true);
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true);
    // "s3-utils" -> "s3utils"
    expect(existsSync(path.join(dir, "src/main/java/software/lepton/lib/s3utils/package-info.java"))).toBe(true);
    // No docker-compose for libs
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false);
  });

  it("python-lib generates uv-based library structure", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "my-utils");
    const { status } = runDx(
      ["init", "--standalone", "--type", "python-lib", "--name", "my-utils", "--owner", "data", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "pyproject.toml"))).toBe(true);
    // "my-utils" -> "my_utils" (Python module name)
    expect(existsSync(path.join(dir, "src/my_utils/__init__.py"))).toBe(true);
    expect(existsSync(path.join(dir, "tests/test_my_utils.py"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false);
  });

  it("node-lib generates TypeScript library", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "shared-types");
    const { status } = runDx(
      ["init", "--standalone", "--type", "node-lib", "--name", "shared-types", "--owner", "platform", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
    expect(existsSync(path.join(dir, "src/index.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false);

    const pkg = JSON.parse(readFile(dir, "package.json"));
    expect(pkg.name).toBe("shared-types");
    expect(pkg.type).toBe("module");
  });

  it("ui-lib generates React component library", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "ui-kit");
    const { status } = runDx(
      ["init", "--standalone", "--type", "ui-lib", "--name", "ui-kit", "--owner", "frontend", "--dir", dir],
      { home },
    );

    expect(status).toBe(0);
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "tailwind.config.cjs"))).toBe(true);
    expect(existsSync(path.join(dir, "src/index.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "src/components/.gitkeep"))).toBe(true);

    const pkg = JSON.parse(readFile(dir, "package.json"));
    expect(pkg.peerDependencies).toHaveProperty("react");
  });

  it("--type flag implies standalone mode", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "implied");
    const { status, stdout } = runDx(
      ["init", "--type", "node-lib", "--name", "implied", "--owner", "team", "--dir", dir, "--json"],
      { home },
    );

    expect(status).toBe(0);
    const body = JSON.parse(stdout) as { mode: string; type: string };
    expect(body.mode).toBe("standalone");
    expect(body.type).toBe("node-lib");
  });

  it("rejects invalid --type", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "bad");
    const { status, stderr } = runDx(
      ["init", "--standalone", "--type", "golang-api", "--name", "bad", "--dir", dir],
      { home },
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain("Invalid standalone type");
  });

  it("standalone --json returns structured output with type", () => {
    const home = isolatedHome();
    const target = tmpDir();
    dirs.push(home, target);

    const dir = path.join(target, "json-sa");
    const { status, stdout } = runDx(
      ["init", "--standalone", "--type", "python-api", "--name", "json-sa", "--owner", "ml", "--dir", dir, "--json"],
      { home },
    );

    expect(status).toBe(0);
    const body = JSON.parse(stdout) as {
      success: boolean;
      mode: string;
      type: string;
      files: string[];
    };
    expect(body.success).toBe(true);
    expect(body.mode).toBe("standalone");
    expect(body.type).toBe("python-api");
    expect(body.files).toContain("pyproject.toml");
    expect(body.files).toContain("src/main.py");
  });
});

// ─── Error Handling ─────────────────────────────────────────────────────────

describe("dx init — error handling", () => {
  it("--help shows command usage", () => {
    const home = isolatedHome();
    const { status, stdout, stderr } = runDx(["init", "--help"], { home });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Scaffold");
    expect(stdout).toContain("--standalone");
    expect(stdout).toContain("--type");
  });

  it("standalone mode without --type in non-TTY exits with error", () => {
    const home = isolatedHome();
    const target = tmpDir();
    rmSync(target, { recursive: true, force: true });

    const { status, stderr } = runDx(
      ["init", "--standalone", "--name", "no-type", "--dir", target],
      { home },
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain("--type");

    rmSync(target, { recursive: true, force: true });
  });
});
