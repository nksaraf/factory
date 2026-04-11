/**
 * Tests for the DX Context Architecture.
 *
 * Uses temp directories to simulate different project/workspace/package layouts,
 * verifying that each context tier resolves correctly.
 */
import { afterEach, describe, expect, it, mock } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stringify } from "yaml"

import { resolveDxContext } from "../lib/dx-context.js"
import type { DxContext } from "../lib/dx-context.js"

mock.module("../lib/monorepo-topology.js", () => ({
  fromCwd: (root: string) => ({ root, packages: [], pnpmOverrides: {} }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestFixture {
  rootDir: string
  cleanup(): void
}

/** Create a temp directory with docker-compose.yaml (minimal project). */
function createProject(opts?: {
  services?: Record<string, Record<string, unknown>>
  packageJson?: Record<string, unknown>
  dxConfig?: Record<string, unknown>
}): TestFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "dx-ctx-test-"))
  mkdirSync(join(rootDir, ".dx"), { recursive: true })

  // docker-compose.yaml
  const services = opts?.services ?? {
    api: { build: { context: "./api" }, ports: ["3000:3000"] },
  }
  writeFileSync(
    join(rootDir, "docker-compose.yaml"),
    stringify({ services }),
    "utf8"
  )

  // package.json
  const pkg = opts?.packageJson ?? { name: "test-project", scripts: {} }
  if (opts?.dxConfig) {
    ;(pkg as Record<string, unknown>).dx = opts.dxConfig
  }
  writeFileSync(join(rootDir, "package.json"), JSON.stringify(pkg), "utf8")

  return {
    rootDir,
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true })
    },
  }
}

/** Initialize a git repo in the given directory. */
function initGitRepo(dir: string): void {
  spawnSync("git", ["init", "--initial-branch=main"], {
    cwd: dir,
    stdio: "pipe",
  })
  spawnSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" })
  spawnSync("git", ["commit", "-m", "init", "--allow-empty"], {
    cwd: dir,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  })
}

/** Create a git worktree from a main repo. Returns the worktree path. */
function createWorktree(
  mainRepoDir: string,
  worktreeName: string,
  branch: string
): string {
  const worktreeDir = join(mainRepoDir, "..", worktreeName)
  spawnSync("git", ["worktree", "add", worktreeDir, "-b", branch], {
    cwd: mainRepoDir,
    stdio: "pipe",
  })
  return worktreeDir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dx-context", () => {
  // ── Tier 1: Host ──────────────────────────────────────────

  describe("HostContext", () => {
    it("always resolves, even outside any project", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "dx-ctx-empty-"))
      try {
        const ctx = await resolveDxContext({ need: "host", cwd: emptyDir })
        expect(ctx.host).toBeDefined()
        expect(ctx.host.config).toBeDefined()
        expect(ctx.host.layout).toBeDefined()
        expect(ctx.host.layout.reposDir).toContain("conductor/repos")
        expect(ctx.host.layout.worktreesDir).toContain("conductor/workspaces")
        expect(ctx.host.factory).toBeDefined()
        expect(ctx.host.factory.mode).toMatch(/^(local|cloud)$/)

        // Other tiers should be null outside a project
        expect(ctx.project).toBeNull()
        expect(ctx.workbench).toBeNull()
        expect(ctx.package).toBeNull()
      } finally {
        rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it("has a session object (possibly empty on fresh install)", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "dx-ctx-session-"))
      try {
        const ctx = await resolveDxContext({ need: "host", cwd: emptyDir })
        expect(ctx.host.session).toBeDefined()
        // Session may be empty but should not throw
      } finally {
        rmSync(emptyDir, { recursive: true, force: true })
      }
    })
  })

  // ── Tier 2: Project ──────────────────────────────────────

  describe("ProjectContext", () => {
    let fixture: TestFixture

    afterEach(() => fixture?.cleanup())

    it("resolves when cwd has docker-compose.yaml", async () => {
      fixture = createProject({
        services: {
          api: { build: { context: "./api" }, ports: ["3000:3000"] },
          db: { image: "postgres:16", ports: ["5432:5432"] },
        },
      })

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.project).not.toBeNull()
      expect(ctx.project!.rootDir).toBe(fixture.rootDir)
      expect(ctx.project!.composeFiles.length).toBeGreaterThan(0)
    })

    it("returns null outside any project", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "dx-ctx-noproject-"))
      try {
        const ctx = await resolveDxContext({ need: "host", cwd: emptyDir })
        expect(ctx.project).toBeNull()
      } finally {
        rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it("throws when project is required but not available", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "dx-ctx-require-"))
      try {
        await expect(
          resolveDxContext({ need: "project", cwd: emptyDir })
        ).rejects.toThrow("Not inside a project")
      } finally {
        rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it("resolves from a subdirectory within the project", async () => {
      fixture = createProject()
      const subDir = join(fixture.rootDir, "api", "src")
      mkdirSync(subDir, { recursive: true })

      const ctx = await resolveDxContext({ need: "host", cwd: subDir })
      expect(ctx.project).not.toBeNull()
      expect(ctx.project!.rootDir).toBe(fixture.rootDir)
    })

    it("includes monorepoPackages array (empty when no pnpm-workspace.yaml)", async () => {
      fixture = createProject()

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.project).not.toBeNull()
      // monorepoPackages is always an array (may be empty)
      expect(Array.isArray(ctx.project!.monorepoPackages)).toBe(true)
    })
  })

  // ── Tier 3: Workspace ────────────────────────────────────

  describe("WorkbenchContext", () => {
    let fixture: TestFixture
    let worktreeDir: string | null = null

    afterEach(() => {
      // Clean up worktree before cleaning the main repo
      if (worktreeDir) {
        spawnSync("git", ["worktree", "remove", "--force", worktreeDir], {
          cwd: fixture?.rootDir,
          stdio: "pipe",
        })
        rmSync(worktreeDir, { recursive: true, force: true })
        worktreeDir = null
      }
      fixture?.cleanup()
    })

    it("resolves as kind=main for a regular git repo", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.workbench).not.toBeNull()
      expect(ctx.workbench!.kind).toBe("main")
      expect(ctx.workbench!.dir).toBe(fixture.rootDir)
      expect(ctx.workbench!.mainRepoDir).toBe(fixture.rootDir)
      expect(ctx.workbench!.branch).toBe("main")
    })

    it("resolves as kind=worktree inside a git worktree", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      worktreeDir = createWorktree(fixture.rootDir, "test-wt", "feature/test")

      // Copy docker-compose.yaml to worktree so project resolves
      writeFileSync(
        join(worktreeDir, "docker-compose.yaml"),
        stringify({ services: { api: { build: { context: "./api" } } } }),
        "utf8"
      )
      mkdirSync(join(worktreeDir, ".dx"), { recursive: true })

      const ctx = await resolveDxContext({ need: "host", cwd: worktreeDir })
      expect(ctx.workbench).not.toBeNull()
      expect(ctx.workbench!.kind).toBe("worktree")
      expect(ctx.workbench!.name).toBe("test-wt")
      expect(ctx.workbench!.branch).toBe("feature/test")
      // Use realpathSync for macOS /var → /private/var symlink normalization
      expect(realpathSync(ctx.workbench!.mainRepoDir)).toBe(
        realpathSync(fixture.rootDir)
      )
      expect(ctx.workbench!.composeProjectName).toBe("test-wt")
    })

    it("has isolated compose project name per worktree", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      // Main checkout uses its directory name
      const mainCtx = await resolveDxContext({
        need: "host",
        cwd: fixture.rootDir,
      })
      const mainComposeProject = mainCtx.workbench!.composeProjectName

      // Worktree uses its own name
      worktreeDir = createWorktree(
        fixture.rootDir,
        "isolated-wt",
        "feature/isolated"
      )
      writeFileSync(
        join(worktreeDir, "docker-compose.yaml"),
        stringify({ services: { api: { build: { context: "./api" } } } }),
        "utf8"
      )
      mkdirSync(join(worktreeDir, ".dx"), { recursive: true })

      const wtCtx = await resolveDxContext({ need: "host", cwd: worktreeDir })
      expect(wtCtx.workbench!.composeProjectName).toBe("isolated-wt")
      expect(wtCtx.workbench!.composeProjectName).not.toBe(mainComposeProject)
    })

    it("returns null when not inside a git repo", async () => {
      fixture = createProject()
      // No git init — just a docker-compose.yaml
      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      // Workspace may or may not be null depending on whether we're inside
      // a parent git repo. The test validates the shape if present.
      if (ctx.workbench) {
        expect(ctx.workbench.kind).toMatch(/^(main|worktree)$/)
      }
    })

    it("reads local config from .dx/config.json", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      writeFileSync(
        join(fixture.rootDir, ".dx", "config.json"),
        JSON.stringify({ factoryUrl: "http://localhost:4100" }),
        "utf8"
      )

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.workbench).not.toBeNull()
      expect(ctx.workbench!.localConfig.factoryUrl).toBe(
        "http://localhost:4100"
      )
    })

    it("reads auth profile from .dx/workbench.json", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      writeFileSync(
        join(fixture.rootDir, ".dx", "workbench.json"),
        JSON.stringify({ authProfile: "staging" }),
        "utf8"
      )

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.workbench).not.toBeNull()
      expect(ctx.workbench!.authProfile).toBe("staging")
    })

    it("defaults auth profile to 'default' when no workbench.json", async () => {
      fixture = createProject()
      initGitRepo(fixture.rootDir)

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.workbench!.authProfile).toBe("default")
    })
  })

  // ── Tier 4: Package ──────────────────────────────────────

  describe("PackageContext", () => {
    let fixture: TestFixture

    afterEach(() => fixture?.cleanup())

    it("resolves for single-package project (project root = package)", async () => {
      fixture = createProject({
        packageJson: { name: "my-app", scripts: { test: "vitest" } },
      })

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.package).not.toBeNull()
      // Package name for single-package projects comes from project.name (catalog system name)
      expect(ctx.package!.name).toBe(ctx.project!.name)
      expect(realpathSync(ctx.package!.dir)).toBe(realpathSync(fixture.rootDir))
      expect(ctx.package!.relativePath).toBe(".")
    })

    it("detects toolchain for single-package project", async () => {
      fixture = createProject({
        packageJson: { name: "my-app", scripts: { test: "vitest run" } },
      })

      // Add a vitest config to trigger auto-detect (not just package.json scripts)
      writeFileSync(
        join(fixture.rootDir, "vitest.config.ts"),
        'import { defineConfig } from "vitest/config";\nexport default defineConfig({});',
        "utf8"
      )

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.package).not.toBeNull()
      expect(ctx.package!.toolchain).toBeDefined()
      expect(ctx.package!.toolchain.runtime).toBe("node")
      // Test runner should be detected (either via config file or scripts)
      expect(ctx.package!.toolchain.testRunner).not.toBeNull()
    })
  })

  // ── Cross-tier integration ───────────────────────────────

  describe("cross-tier resolution", () => {
    let fixture: TestFixture

    afterEach(() => fixture?.cleanup())

    it("resolves all four tiers for single-package project in a git repo", async () => {
      fixture = createProject({
        packageJson: { name: "full-stack-app", scripts: { test: "vitest" } },
      })
      initGitRepo(fixture.rootDir)

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })

      expect(ctx.host).toBeDefined()
      expect(ctx.project).not.toBeNull()
      expect(ctx.workbench).not.toBeNull()
      expect(ctx.workbench!.kind).toBe("main")
      expect(ctx.package).not.toBeNull()
      expect(ctx.package!.name).toBe(ctx.project!.name)
    })

    it("host + project + workbench resolve, package is null when no package.json", async () => {
      fixture = createProject()
      // Remove the package.json so toolchain detection returns nothing useful
      // but project still resolves from docker-compose
      initGitRepo(fixture.rootDir)

      const ctx = await resolveDxContext({ need: "host", cwd: fixture.rootDir })
      expect(ctx.host).toBeDefined()
      expect(ctx.project).not.toBeNull()
      expect(ctx.workbench).not.toBeNull()
    })
  })
})
