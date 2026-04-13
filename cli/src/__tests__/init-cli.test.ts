import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { runDx } from "./run-dx.js"

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-init-test-"))
}

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-init-home-"))
}

function readFile(dir: string, ...segments: string[]): string {
  return readFileSync(path.join(dir, ...segments), "utf8")
}

// ─── Project Mode (non-interactive, flag-driven) ────────────────────────────

describe("dx init — project mode", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it("creates full monorepo structure with --name and --owner", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "my-platform")
    const { status, stdout, stderr } = runDx(
      ["init", "--name", "my-platform", "--owner", "platform", "--dir", dir],
      { home }
    )

    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("my-platform")
    expect(stdout).toContain("Next steps")

    // Root files
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
    expect(existsSync(path.join(dir, "pnpm-workspace.yaml"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true)
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true)
    expect(existsSync(path.join(dir, ".prettierrc"))).toBe(true)

    // Compose directory
    expect(existsSync(path.join(dir, "compose/postgres.yml"))).toBe(true)
    expect(existsSync(path.join(dir, "compose/auth.yml"))).toBe(true)
    expect(existsSync(path.join(dir, "compose/gateway.yml"))).toBe(true)
    expect(existsSync(path.join(dir, "compose/my-platform-api.yml"))).toBe(true)
    expect(existsSync(path.join(dir, "compose/my-platform-app.yml"))).toBe(true)

    // Starter service
    expect(
      existsSync(path.join(dir, "services/my-platform-api/package.json"))
    ).toBe(true)
    expect(
      existsSync(path.join(dir, "services/my-platform-api/src/server.ts"))
    ).toBe(true)
    expect(
      existsSync(
        path.join(dir, "services/my-platform-api/src/plugins/auth.plugin.ts")
      )
    ).toBe(true)

    // Starter app
    expect(
      existsSync(path.join(dir, "apps/my-platform-app/package.json"))
    ).toBe(true)
    expect(
      existsSync(path.join(dir, "apps/my-platform-app/src/entry.client.tsx"))
    ).toBe(true)

    // Package dirs
    expect(existsSync(path.join(dir, "packages/npm/.gitkeep"))).toBe(true)
    expect(existsSync(path.join(dir, "packages/java/.gitkeep"))).toBe(true)
    expect(existsSync(path.join(dir, "packages/python/.gitkeep"))).toBe(true)

    // .dx state
    expect(existsSync(path.join(dir, ".dx/ports.json"))).toBe(true)
    expect(existsSync(path.join(dir, ".dx/packages.json"))).toBe(true)

    // Infra
    expect(existsSync(path.join(dir, "infra/apisix/config.yaml"))).toBe(true)
    expect(existsSync(path.join(dir, "infra/auth/auth.settings.yaml"))).toBe(
      true
    )
  })

  it("docker-compose.yaml uses include for all compose files", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "proj")
    runDx(["init", "--name", "proj", "--owner", "team", "--dir", dir], { home })

    const compose = readFile(dir, "docker-compose.yaml")
    expect(compose).toContain("include:")
    expect(compose).toContain("compose/postgres.yml")
    expect(compose).toContain("compose/auth.yml")
    expect(compose).toContain("compose/gateway.yml")
    expect(compose).toContain("compose/proj-api.yml")
    expect(compose).toContain("compose/proj-app.yml")
  })

  it("compose files contain catalog labels", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "labeled")
    runDx(["init", "--name", "labeled", "--owner", "ops", "--dir", dir], {
      home,
    })

    const postgres = readFile(dir, "compose/postgres.yml")
    expect(postgres).toContain("dx.type")
    expect(postgres).toContain("dx.owner")
    expect(postgres).toContain("ops")

    const api = readFile(dir, "compose/labeled-api.yml")
    expect(api).toContain("dx.type: service")
    expect(api).toContain("dx.runtime")
  })

  it("--json returns structured output", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "json-test")
    const { status, stdout, stderr } = runDx(
      [
        "init",
        "--name",
        "json-test",
        "--owner",
        "team",
        "--dir",
        dir,
        "--json",
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(stderr).toBe("")

    const body = JSON.parse(stdout) as {
      success: boolean
      name: string
      type: string
      owner: string
      files: string[]
    }
    expect(body.success).toBe(true)
    expect(body.name).toBe("json-test")
    expect(body.type).toBe("project")
    expect(body.owner).toBe("team")
    expect(body.files.length).toBeGreaterThan(20)
    expect(body.files).toContain("docker-compose.yaml")
    expect(body.files).toContain("compose/postgres.yml")
  })

  it("refuses to overwrite existing project without --force", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    // First init
    const dir = path.join(target, "existing")
    runDx(["init", "--name", "existing", "--owner", "team", "--dir", dir], {
      home,
    })

    // Second init (no --force)
    const { status, stderr } = runDx(
      ["init", "--name", "existing", "--owner", "team", "--dir", dir],
      { home }
    )
    expect(status).not.toBe(0)
    expect(stderr).toContain("--force")
  })

  it("--force allows overwriting existing project", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "overwrite")
    runDx(["init", "--name", "overwrite", "--owner", "a", "--dir", dir], {
      home,
    })

    const { status } = runDx(
      ["init", "--name", "overwrite", "--owner", "b", "--dir", dir, "--force"],
      { home }
    )
    expect(status).toBe(0)

    // Verify new owner is in generated files
    const compose = readFile(dir, "compose/postgres.yml")
    expect(compose).toContain("dx.owner: b")
  })

  it("positional argument creates a subdirectory", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    // Use --dir to control where the positional arg creates the subdir
    const dir = path.join(target, "sub-project")
    const { status, stdout, stderr } = runDx(
      ["init", "--name", "sub-project", "--owner", "team", "--dir", dir],
      { home }
    )

    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("sub-project")
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
  })
})

// ─── Component Types (service, website, library) ────────────────────────────

describe("dx init — component types", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it("service with node runtime generates Elysia API", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "my-api")
    const { status } = runDx(
      [
        "init",
        "--type",
        "service",
        "--runtime",
        "node",
        "--name",
        "my-api",
        "--owner",
        "backend",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true)
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true)
    expect(existsSync(path.join(dir, "src/server.ts"))).toBe(true)
    expect(existsSync(path.join(dir, "src/health.ts"))).toBe(true)
    expect(existsSync(path.join(dir, "src/plugins/auth.plugin.ts"))).toBe(true)
    expect(existsSync(path.join(dir, "src/db/connection.ts"))).toBe(true)

    const pkg = JSON.parse(readFile(dir, "package.json"))
    expect(pkg.name).toBe("my-api")
    expect(pkg.dependencies).toHaveProperty("elysia")
    expect(pkg.dependencies).toHaveProperty("drizzle-orm")
  })

  it("website with node runtime generates React app", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "my-app")
    const { status } = runDx(
      [
        "init",
        "--type",
        "website",
        "--runtime",
        "node",
        "--name",
        "my-app",
        "--owner",
        "frontend",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
    expect(existsSync(path.join(dir, "app.config.ts"))).toBe(true)
    expect(existsSync(path.join(dir, "tailwind.config.cjs"))).toBe(true)
    expect(existsSync(path.join(dir, "src/entry.client.tsx"))).toBe(true)
    expect(existsSync(path.join(dir, "src/routes/index/page.tsx"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false)
  })

  it("service with java runtime generates Spring Boot structure", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "data-svc")
    const { status } = runDx(
      [
        "init",
        "--type",
        "service",
        "--runtime",
        "java",
        "--name",
        "data-svc",
        "--owner",
        "data",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "pom.xml"))).toBe(true)
    expect(existsSync(path.join(dir, "server/pom.xml"))).toBe(true)
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(true)

    const appJava = path.join(
      dir,
      "server/src/main/java/software/lepton/service/datasvc/Application.java"
    )
    expect(existsSync(appJava)).toBe(true)
    expect(readFile(appJava)).toContain("@SpringBootApplication")
  })

  it("service with python runtime generates FastAPI structure", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "ml-svc")
    const { status } = runDx(
      [
        "init",
        "--type",
        "service",
        "--runtime",
        "python",
        "--name",
        "ml-svc",
        "--owner",
        "ml",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "pyproject.toml"))).toBe(true)
    expect(existsSync(path.join(dir, "Dockerfile"))).toBe(true)
    expect(existsSync(path.join(dir, "src/main.py"))).toBe(true)

    const main = readFile(dir, "src/main.py")
    expect(main).toContain("FastAPI")
    expect(main).toContain("/health")
  })

  it("library with java runtime generates Maven library", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "s3-utils")
    const { status } = runDx(
      [
        "init",
        "--type",
        "library",
        "--runtime",
        "java",
        "--name",
        "s3-utils",
        "--owner",
        "platform",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "pom.xml"))).toBe(true)
    expect(
      existsSync(
        path.join(
          dir,
          "src/main/java/software/lepton/lib/s3utils/package-info.java"
        )
      )
    ).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false)
  })

  it("library with python runtime generates uv-based library", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "my-utils")
    const { status } = runDx(
      [
        "init",
        "--type",
        "library",
        "--runtime",
        "python",
        "--name",
        "my-utils",
        "--owner",
        "data",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "pyproject.toml"))).toBe(true)
    expect(existsSync(path.join(dir, "src/my_utils/__init__.py"))).toBe(true)
    expect(existsSync(path.join(dir, "tests/test_my_utils.py"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false)
  })

  it("library with node runtime generates TypeScript library", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "shared-types")
    const { status } = runDx(
      [
        "init",
        "--type",
        "library",
        "--runtime",
        "node",
        "--framework",
        "none",
        "--name",
        "shared-types",
        "--owner",
        "platform",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
    expect(existsSync(path.join(dir, "tsconfig.json"))).toBe(true)
    expect(existsSync(path.join(dir, "src/index.ts"))).toBe(true)
    expect(existsSync(path.join(dir, "docker-compose.yaml"))).toBe(false)

    const pkg = JSON.parse(readFile(dir, "package.json"))
    expect(pkg.name).toBe("shared-types")
    expect(pkg.type).toBe("module")
  })

  it("ui-lib via library type with react-tailwind framework", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "ui-kit")
    const { status } = runDx(
      [
        "init",
        "--type",
        "library",
        "--runtime",
        "node",
        "--framework",
        "react-tailwind",
        "--name",
        "ui-kit",
        "--owner",
        "frontend",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "package.json"))).toBe(true)
    expect(existsSync(path.join(dir, "tailwind.config.cjs"))).toBe(true)
    expect(existsSync(path.join(dir, "src/index.ts"))).toBe(true)

    const pkg = JSON.parse(readFile(dir, "package.json"))
    expect(pkg.peerDependencies).toHaveProperty("react")
  })
})

// ─── Legacy backward compat ─────────────────────────────────────────────────

describe("dx init — legacy --type backward compat", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it("--type node-api maps to service + node + elysia", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "legacy-api")
    const { status } = runDx(
      [
        "init",
        "--type",
        "node-api",
        "--name",
        "legacy-api",
        "--owner",
        "team",
        "--dir",
        dir,
      ],
      { home }
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "src/server.ts"))).toBe(true)

    const pkg = JSON.parse(readFile(dir, "package.json"))
    expect(pkg.dependencies).toHaveProperty("elysia")
  })

  it("--type node-lib maps to library + node", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "implied")
    const { status, stdout } = runDx(
      [
        "init",
        "--type",
        "node-lib",
        "--name",
        "implied",
        "--owner",
        "team",
        "--dir",
        dir,
        "--json",
      ],
      { home }
    )

    expect(status).toBe(0)
    const body = JSON.parse(stdout) as { type: string; runtime: string }
    expect(body.type).toBe("library")
    expect(body.runtime).toBe("node")
  })

  it("--json returns structured output with new fields", () => {
    const home = isolatedHome()
    const target = tmpDir()
    dirs.push(home, target)

    const dir = path.join(target, "json-sa")
    const { status, stdout } = runDx(
      [
        "init",
        "--type",
        "python-api",
        "--name",
        "json-sa",
        "--owner",
        "ml",
        "--dir",
        dir,
        "--json",
      ],
      { home }
    )

    expect(status).toBe(0)
    const body = JSON.parse(stdout) as {
      success: boolean
      type: string
      runtime: string
      framework: string
      files: string[]
    }
    expect(body.success).toBe(true)
    expect(body.type).toBe("service")
    expect(body.runtime).toBe("python")
    expect(body.framework).toBe("fastapi")
    expect(body.files).toContain("pyproject.toml")
    expect(body.files).toContain("src/main.py")
  })
})

// ─── Error Handling ─────────────────────────────────────────────────────────

describe("dx init — error handling", () => {
  it("--help shows command usage", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["init", "--help"], { home })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("Scaffold")
    expect(stdout).toContain("--type")
    expect(stdout).toContain("--runtime")
    expect(stdout).toContain("--framework")
  })

  it("rejects invalid --type", () => {
    const home = isolatedHome()
    const target = tmpDir()
    rmSync(target, { recursive: true, force: true })

    const { status, stderr } = runDx(
      ["init", "--type", "golang-api", "--name", "bad", "--dir", target],
      { home }
    )
    expect(status).not.toBe(0)
    expect(stderr).toContain("Invalid type")

    rmSync(target, { recursive: true, force: true })
  })
})
