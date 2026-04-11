import { describe, expect, it } from "bun:test"
import path from "node:path"

import {
  loadDxProjectConfig,
  loadDxProjectConfigOrDefaults,
  loadPackageJson,
  loadPackageScripts,
} from "../lib/dx-project-config.js"

const fixtures = path.resolve(__dirname, "fixtures/dx-config")
const fixture = (name: string) => path.join(fixtures, name)

describe("dx-project-config", () => {
  // ── loadDxProjectConfig ───────────────────────────────

  describe("loadDxProjectConfig", () => {
    it("loads full config with all fields", () => {
      const config = loadDxProjectConfig(fixture("full"))
      expect(config).not.toBeNull()
      expect(config!.version).toBe("1.2.0")
      expect(config!.type).toBe("monorepo")
      expect(config!.team).toBe("platform-eng")
      expect(config!.conventions.commits).toBe("conventional")
      expect(config!.conventions.branching).toBe("trunk")
      expect(config!.deploy.preview).toEqual({
        trigger: "pull-request",
        ttl: "72h",
      })
      expect(config!.deploy.production).toEqual({
        trigger: "release-tag",
        approval: true,
      })
    })

    it("fills defaults for missing fields in minimal config", () => {
      const config = loadDxProjectConfig(fixture("minimal"))
      expect(config).not.toBeNull()
      expect(config!.team).toBe("backend")
      // defaults
      expect(config!.version).toBe("0.0.0")
      expect(config!.type).toBe("service")
      expect(config!.conventions.commits).toBe("conventional")
      expect(config!.conventions.branching).toBe("trunk")
    })

    it("returns null when no dx key exists", () => {
      expect(loadDxProjectConfig(fixture("no-dx-key"))).toBeNull()
    })

    it("returns null when no package.json exists", () => {
      expect(loadDxProjectConfig(fixture("no-package"))).toBeNull()
    })

    it("returns null for invalid JSON", () => {
      expect(loadDxProjectConfig(fixture("invalid-json"))).toBeNull()
    })

    it("preserves raw dx object", () => {
      const config = loadDxProjectConfig(fixture("full"))
      expect(config!.raw).toHaveProperty("version", "1.2.0")
      expect(config!.raw).toHaveProperty("type", "monorepo")
    })
  })

  // ── loadDxProjectConfigOrDefaults ─────────────────────

  describe("loadDxProjectConfigOrDefaults", () => {
    it("returns config when dx key exists", () => {
      const config = loadDxProjectConfigOrDefaults(fixture("full"))
      expect(config.type).toBe("monorepo")
    })

    it("returns defaults when no dx key", () => {
      const config = loadDxProjectConfigOrDefaults(fixture("no-dx-key"))
      expect(config.version).toBe("0.0.0")
      expect(config.type).toBe("service")
      expect(config.team).toBe("local")
    })

    it("returns defaults when no package.json", () => {
      const config = loadDxProjectConfigOrDefaults(fixture("no-package"))
      expect(config.type).toBe("service")
    })
  })

  // ── loadPackageScripts ────────────────────────────────

  describe("loadPackageScripts", () => {
    it("loads scripts from package.json", () => {
      const scripts = loadPackageScripts(fixture("scripts-only"))
      expect(scripts.test).toBe("vitest run")
      expect(scripts.lint).toBe("eslint .")
      expect(scripts.format).toBe("prettier --write .")
      expect(scripts.dev).toBe("next dev")
      expect(scripts.build).toBe("next build")
    })

    it("returns empty object when no scripts key", () => {
      const scripts = loadPackageScripts(fixture("no-dx-key"))
      expect(scripts).toEqual({})
    })

    it("returns empty object when no package.json", () => {
      const scripts = loadPackageScripts(fixture("no-package"))
      expect(scripts).toEqual({})
    })
  })

  // ── loadPackageJson ───────────────────────────────────

  describe("loadPackageJson", () => {
    it("loads full package.json", () => {
      const pkg = loadPackageJson(fixture("full"))
      expect(pkg).not.toBeNull()
      expect(pkg!.name).toBe("@lepton/full-project")
      expect(pkg!.dx).toBeDefined()
    })

    it("returns null when no package.json", () => {
      expect(loadPackageJson(fixture("no-package"))).toBeNull()
    })

    it("returns null for invalid JSON", () => {
      expect(loadPackageJson(fixture("invalid-json"))).toBeNull()
    })
  })
})
