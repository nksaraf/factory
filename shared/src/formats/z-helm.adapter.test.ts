import { createRequire } from "node:module"
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"

import type { CatalogSystem } from "../catalog"

const requireFs = createRequire(import.meta.url)
const actualFs = requireFs("node:fs") as typeof import("node:fs")

const mockExistsSync = mock()
const mockReadFileSync = mock()

mock.module("node:fs", () => ({
  ...actualFs,
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}))

const { HelmFormatAdapter } = await import("./helm.adapter.js")

afterAll(() => {
  mock.restore()
})

beforeEach(() => {
  mockExistsSync.mockReset()
  mockReadFileSync.mockReset()
})

// ─── Helpers ─────────────────────────────────────────────────

function setupHelmChart(
  rootDir: string,
  chartYaml: string,
  valuesYaml?: string
) {
  mockExistsSync.mockImplementation((p: string) => {
    if (p === `${rootDir}/Chart.yaml`) return true
    if (valuesYaml != null && p === `${rootDir}/values.yaml`) return true
    return false
  })
  mockReadFileSync.mockImplementation((p: string) => {
    if (p === `${rootDir}/Chart.yaml`) return chartYaml
    if (p === `${rootDir}/values.yaml`) return valuesYaml ?? ""
    throw new Error(`Unexpected read: ${p}`)
  })
}

// ─── Tests ───────────────────────────────────────────────────

describe("HelmFormatAdapter", () => {
  describe("detect", () => {
    it("returns true when Chart.yaml exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith("Chart.yaml"))
      const adapter = new HelmFormatAdapter()
      expect(adapter.detect("/my-chart")).toBe(true)
    })

    it("returns false when Chart.yaml does not exist", () => {
      mockExistsSync.mockReturnValue(false)
      const adapter = new HelmFormatAdapter()
      expect(adapter.detect("/empty-dir")).toBe(false)
    })
  })

  describe("parse", () => {
    it("parses Chart.yaml + values.yaml into a CatalogSystem with correct component", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: my-app
description: A sample Helm chart
type: application
version: 0.1.0
appVersion: "1.0.0"
`,
        `
replicaCount: 3
image:
  repository: nginx
  tag: "1.21"
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: false
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi
`
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")

      expect(result.system.kind).toBe("System")
      expect(result.system.metadata.name).toBe("my-app")
      expect(result.system.metadata.description).toBe("A sample Helm chart")
      expect(result.system.components["my-app"]).toBeDefined()
      expect(result.sourceVersion).toBe("v2")
    })

    it("maps image, ports, replicas, and resources correctly", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: webapp
version: 0.1.0
`,
        `
replicaCount: 2
image:
  repository: myorg/webapp
  tag: "v3.2"
service:
  port: 8080
resources:
  limits:
    cpu: 200m
    memory: 256Mi
`
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")
      const comp = result.system.components.webapp

      expect(comp.spec.image).toBe("myorg/webapp:v3.2")
      expect(comp.spec.ports).toEqual([
        { name: "http", port: 8080, protocol: "http" },
      ])
      expect(comp.spec.replicas).toBe(2)
      expect(comp.spec.compute).toEqual({
        min: undefined,
        max: { cpu: "200m", memory: "256Mi" },
      })
    })

    it("maps ingress.enabled to isPublic", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: public-app
version: 0.1.0
`,
        `
ingress:
  enabled: true
  hosts:
    - host: example.com
`
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")
      expect(result.system.components["public-app"].spec.isPublic).toBe(true)
    })

    it("maps chart dependencies to Resources for infra names", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: my-app
version: 0.1.0
dependencies:
  - name: postgresql
    version: "12.0.0"
    repository: https://charts.bitnami.com/bitnami
  - name: redis
    version: "17.0.0"
    repository: https://charts.bitnami.com/bitnami
`,
        `
replicaCount: 1
`
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")

      expect(result.system.resources.postgresql).toBeDefined()
      expect(result.system.resources.postgresql.spec.type).toBe("database")
      expect(result.system.resources.redis).toBeDefined()
      expect(result.system.resources.redis.spec.type).toBe("cache")
    })

    it("maps non-infra chart dependencies to Components", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: my-app
version: 0.1.0
dependencies:
  - name: frontend
    version: "1.0.0"
    repository: https://example.com/charts
`,
        `
replicaCount: 1
`
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")

      expect(result.system.components.frontend).toBeDefined()
      expect(result.system.components.frontend.spec.type).toBe("service")
    })

    it("stores appVersion in formatExtensions", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: my-app
version: 0.2.0
appVersion: "2.5.0"
`,
        ``
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")
      expect(result.system.formatExtensions?.helm?.appVersion).toBe("2.5.0")
      expect(result.system.formatExtensions?.helm?.chartVersion).toBe("0.2.0")
    })

    it("uses dependency alias when present", () => {
      setupHelmChart(
        "/my-chart",
        `
apiVersion: v2
name: my-app
version: 0.1.0
dependencies:
  - name: postgresql
    version: "12.0.0"
    alias: db
`,
        ``
      )

      const adapter = new HelmFormatAdapter()
      const result = adapter.parse("/my-chart")
      expect(result.system.resources.db).toBeDefined()
      expect(result.system.resources.db.spec.type).toBe("database")
    })
  })

  describe("generate", () => {
    it("generates Chart.yaml and values.yaml from CatalogSystem", () => {
      const system: CatalogSystem = {
        kind: "System",
        metadata: {
          name: "my-app",
          namespace: "default",
          description: "My application",
        },
        spec: { owner: "team-backend" },
        components: {
          "my-app": {
            kind: "Component",
            metadata: { name: "my-app", namespace: "default" },
            spec: {
              type: "service",
              image: "myorg/my-app:v1.2.3",
              ports: [{ name: "http", port: 8080, protocol: "http" }],
              replicas: 3,
              compute: {
                min: { cpu: "125m", memory: "256Mi" },
                max: { cpu: "250m", memory: "512Mi" },
              },
              isPublic: true,
            },
          },
        },
        resources: {},
        connections: [],
        formatExtensions: {
          helm: {
            appVersion: "1.2.3",
            chartVersion: "0.3.0",
          },
        },
      }

      const adapter = new HelmFormatAdapter()
      const result = adapter.generate(system)

      expect(result.files["Chart.yaml"]).toBeDefined()
      expect(result.files["values.yaml"]).toBeDefined()

      const chartContent = result.files["Chart.yaml"]
      expect(chartContent).toContain("name: my-app")
      expect(chartContent).toContain("apiVersion: v2")
      expect(chartContent).toContain("appVersion: 1.2.3")
      expect(chartContent).toContain("version: 0.3.0")

      const valuesContent = result.files["values.yaml"]
      expect(valuesContent).toContain("replicaCount: 3")
      expect(valuesContent).toContain("repository: myorg/my-app")
      expect(valuesContent).toContain("tag: v1.2.3")
      expect(valuesContent).toContain("port: 8080")
      expect(valuesContent).toContain("enabled: true")
      expect(valuesContent).toContain("cpu: 250m")
      expect(valuesContent).toContain("memory: 512Mi")
    })

    it("warns about multiple components", () => {
      const system: CatalogSystem = {
        kind: "System",
        metadata: { name: "multi", namespace: "default" },
        spec: { owner: "team" },
        components: {
          api: {
            kind: "Component",
            metadata: { name: "api", namespace: "default" },
            spec: { type: "service", ports: [] },
          },
          worker: {
            kind: "Component",
            metadata: { name: "worker", namespace: "default" },
            spec: { type: "worker", ports: [] },
          },
        },
        resources: {},
        connections: [],
      }

      const adapter = new HelmFormatAdapter()
      const result = adapter.generate(system)
      expect(
        result.warnings.some((w) => w.includes("additional component"))
      ).toBe(true)
    })

    it("warns about connections", () => {
      const system: CatalogSystem = {
        kind: "System",
        metadata: { name: "connected", namespace: "default" },
        spec: { owner: "team" },
        components: {
          api: {
            kind: "Component",
            metadata: { name: "api", namespace: "default" },
            spec: { type: "service", ports: [] },
          },
        },
        resources: {},
        connections: [
          {
            name: "db-conn",
            targetModule: "infra",
            targetComponent: "postgres",
            envVar: "DATABASE_URL",
          },
        ],
      }

      const adapter = new HelmFormatAdapter()
      const result = adapter.generate(system)
      expect(result.warnings.some((w) => w.includes("Connections"))).toBe(true)
    })
  })
})
