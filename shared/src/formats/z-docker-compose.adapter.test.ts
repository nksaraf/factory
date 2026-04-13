import { createRequire } from "node:module"
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test"

import type { CatalogSystem } from "../catalog"

const requireFs = createRequire(import.meta.url)
const actualFs = requireFs("node:fs") as typeof import("node:fs")

const mockExistsSync = mock()
const mockReadFileSync = mock()
const mockReaddirSync = mock()

mock.module("node:fs", () => ({
  ...actualFs,
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}))

const { DockerComposeFormatAdapter, discoverComposeFiles } =
  await import("./docker-compose.adapter.js")

afterAll(() => {
  mock.restore()
})

function setupComposeFile(
  rootDir: string,
  yamlContent: string,
  filename = "docker-compose.yaml"
) {
  mockExistsSync.mockImplementation((p: string) => {
    return p === `${rootDir}/${filename}`
  })
  mockReadFileSync.mockReturnValue(yamlContent)
  // Auto-glob: readdirSync on rootDir returns the filename
  mockReaddirSync.mockImplementation((p: string) => {
    if (p === rootDir) return [filename]
    return []
  })
}

beforeEach(() => {
  mockExistsSync.mockReset()
  mockReadFileSync.mockReset()
  mockReaddirSync.mockReset()
  // Default: readdirSync returns empty array
  mockReaddirSync.mockReturnValue([])
})

// ─── Classification heuristics ───────────────────────────────

describe("DockerComposeFormatAdapter", () => {
  describe("classification heuristics", () => {
    it("classifies service with build context as Component", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  webapp:
    build:
      context: ./app
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.webapp).toBeDefined()
      expect(result.system.resources.webapp).toBeUndefined()
    })

    it("classifies postgres image as Resource (database)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.postgres).toBeDefined()
      expect(result.system.resources.postgres.spec.type).toBe("database")
    })

    it("classifies redis image as Resource (cache)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.redis).toBeDefined()
      expect(result.system.resources.redis.spec.type).toBe("cache")
    })

    it("classifies rabbitmq image as Resource (queue)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  mq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.mq).toBeDefined()
      expect(result.system.resources.mq.spec.type).toBe("queue")
    })

    it("classifies minio image as Resource (storage)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  storage:
    image: minio/minio
    ports:
      - "9000:9000"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.storage).toBeDefined()
      expect(result.system.resources.storage.spec.type).toBe("storage")
    })

    it("classifies elasticsearch image as Resource (search)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  es:
    image: elasticsearch:8
    ports:
      - "9200:9200"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.es).toBeDefined()
      expect(result.system.resources.es.spec.type).toBe("search")
    })

    it("classifies traefik image as Resource (gateway)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  proxy:
    image: traefik:v3
    ports:
      - "80:80"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.proxy).toBeDefined()
      expect(result.system.resources.proxy.spec.type).toBe("gateway")
    })

    it("classifies custom image with no build as Component (default)", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  myservice:
    image: myorg/myservice:latest
    ports:
      - "8080:8080"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.myservice).toBeDefined()
    })

    it("classifies by name: 'db' → Resource", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  db:
    image: mycompany/custom-db:latest
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.db).toBeDefined()
    })

    it("classifies by name: 'postgres' → Resource", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  postgres:
    image: mycompany/custom-pg:latest
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.postgres).toBeDefined()
    })
  })

  describe("port parsing", () => {
    it("parses '8080:80' → host 8080, container 80", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16
    ports:
      - "8080:80"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const res = result.system.resources.pg
      expect(res.spec.ports[0]?.port).toBe(8080)
      // containerPort is set when it differs from host
      expect(res.spec.containerPort).toBe(80)
    })

    it("parses '8080' → host 8080, container 8080", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  app:
    build:
      context: .
    ports:
      - "8080"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const comp = result.system.components.app
      expect(comp.spec.ports[0]?.port).toBe(8080)
    })

    it("parses '127.0.0.1:8080:80' → host 8080, container 80", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16
    ports:
      - "127.0.0.1:8080:80"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const res = result.system.resources.pg
      expect(res.spec.ports[0]?.port).toBe(8080)
      expect(res.spec.containerPort).toBe(80)
    })
  })

  describe("component conversion", () => {
    it("maps build context and dockerfile", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  api:
    build:
      context: ./services/api
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const comp = result.system.components.api
      expect(comp.spec.build?.context).toBe("./services/api")
      expect(comp.spec.build?.dockerfile).toBe("Dockerfile.prod")
    })

    it("maps image for image-based components", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  frontend:
    image: myorg/frontend:v2
    ports:
      - "8080:80"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.frontend.spec.image).toBe(
        "myorg/frontend:v2"
      )
    })

    it("maps ports correctly", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
      - "3001:3001"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const ports = result.system.components.api.spec.ports
      expect(ports).toHaveLength(2)
      expect(ports[0]?.port).toBe(3000)
      expect(ports[1]?.port).toBe(3001)
    })

    it("maps environment variables", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  api:
    build:
      context: .
    environment:
      NODE_ENV: production
      PORT: "3000"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.api.spec.environment).toEqual({
        NODE_ENV: "production",
        PORT: "3000",
      })
    })

    it("does not use Docker command as dev command", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  api:
    build:
      context: .
    command: npm run dev
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      // Docker's command: is a container entrypoint override, not a dev command.
      // Only dx.dev.command label should set spec.dev.command.
      expect(result.system.components.api.spec.dev).toBeUndefined()
    })

    it("maps dx.dev.command label to dev config", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  api:
    build:
      context: .
    labels:
      dx.dev.command: "pnpm dev"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.api.spec.dev?.command).toBe("pnpm dev")
    })
  })

  describe("resource conversion", () => {
    it("maps image correctly", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.pg.spec.image).toBe("postgres:16-alpine")
    })

    it("maps environment correctly", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: admin
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.pg.spec.environment).toEqual({
        POSTGRES_DB: "mydb",
        POSTGRES_USER: "admin",
      })
    })

    it("maps volumes correctly", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.pg.spec.volumes).toEqual([
        "pgdata:/var/lib/postgresql/data",
      ])
    })

    it("maps healthcheck from string test", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  pg:
    image: postgres:16
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.resources.pg.spec.healthcheck).toBe(
        "pg_isready -U postgres"
      )
    })
  })

  describe("system naming", () => {
    it("uses directory basename as system name", () => {
      setupComposeFile(
        "/home/user/my-awesome-project",
        `
services:
  api:
    build:
      context: .
`,
        "docker-compose.yaml"
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/home/user/my-awesome-project")
      expect(result.system.metadata.name).toBe("my-awesome-project")
    })
  })

  describe("detect", () => {
    it("detects docker-compose.yaml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("docker-compose.yaml")
      )
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return ["docker-compose.yaml"]
        return []
      })
      const adapter = new DockerComposeFormatAdapter()
      expect(adapter.detect("/myproject")).toBe(true)
    })

    it("detects compose.yml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("compose.yml")
      )
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return ["compose.yml"]
        return []
      })
      const adapter = new DockerComposeFormatAdapter()
      expect(adapter.detect("/myproject")).toBe(true)
    })

    it("returns false when no compose file exists", () => {
      mockExistsSync.mockReturnValue(false)
      mockReaddirSync.mockReturnValue([])
      const adapter = new DockerComposeFormatAdapter()
      expect(adapter.detect("/myproject")).toBe(false)
    })
  })

  describe("multi-file discovery", () => {
    it("auto-globs multiple compose files at root", () => {
      const files = [
        "compose.yaml",
        "docker-compose.db.yaml",
        "docker-compose.monitoring.yaml",
      ]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        // compose/ dir does not exist; individual files exist
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("compose.yaml"))
          return "services:\n  api:\n    build:\n      context: .\n"
        if (p.endsWith("db.yaml"))
          return "services:\n  pg:\n    image: postgres:16\n"
        if (p.endsWith("monitoring.yaml"))
          return "services:\n  grafana:\n    image: grafana/grafana\n"
        return ""
      })

      const result = discoverComposeFiles("/myproject")
      expect(result).toHaveLength(3)
      expect(result).toEqual([
        "/myproject/compose.yaml",
        "/myproject/docker-compose.db.yaml",
        "/myproject/docker-compose.monitoring.yaml",
      ])
    })

    it("excludes files with x-dx.overlay: true", () => {
      const files = ["docker-compose.yaml", "docker-compose.prod.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return "services:\n  api:\n    build:\n      context: .\n"
        if (p.endsWith("prod.yaml"))
          return "x-dx:\n  overlay: true\nservices:\n  api:\n    deploy:\n      replicas: 3\n"
        return ""
      })

      const result = discoverComposeFiles("/myproject")
      expect(result).toEqual(["/myproject/docker-compose.yaml"])
    })

    it("excludes files with non-matching x-dx.environment", () => {
      const files = ["docker-compose.yaml", "docker-compose.staging.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return "services:\n  api:\n    build:\n      context: .\n"
        if (p.endsWith("staging.yaml"))
          return "x-dx:\n  environment: staging\nservices:\n  api:\n    replicas: 2\n"
        return ""
      })

      // Default environment is "local" — staging file excluded
      const result = discoverComposeFiles("/myproject")
      expect(result).toEqual(["/myproject/docker-compose.yaml"])

      // With matching environment — staging file included
      const result2 = discoverComposeFiles("/myproject", {
        environment: "staging",
      })
      expect(result2).toEqual([
        "/myproject/docker-compose.staging.yaml",
        "/myproject/docker-compose.yaml",
      ])
    })

    it("explicitFiles overrides all auto-discovery", () => {
      // Even though there are many files on disk, only explicit ones are returned
      mockReaddirSync.mockReturnValue([
        "docker-compose.yaml",
        "docker-compose.db.yaml",
        "docker-compose.extra.yaml",
      ])
      mockExistsSync.mockImplementation((p: string) => {
        return (
          p === "/myproject/docker-compose.yaml" ||
          p === "/myproject/docker-compose.db.yaml"
        )
      })

      const result = discoverComposeFiles("/myproject", {
        explicitFiles: ["docker-compose.yaml", "docker-compose.db.yaml"],
      })
      expect(result).toEqual([
        "/myproject/docker-compose.yaml",
        "/myproject/docker-compose.db.yaml",
      ])
    })

    it("explicitFiles skips missing files with warning", () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p === "/myproject/docker-compose.yaml"
      })
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

      const result = discoverComposeFiles("/myproject", {
        explicitFiles: ["docker-compose.yaml", "docker-compose.missing.yaml"],
      })
      expect(result).toEqual(["/myproject/docker-compose.yaml"])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("docker-compose.missing.yaml")
      )
      warnSpy.mockRestore()
    })

    it("compose/ folder takes priority over auto-glob at root", () => {
      mockExistsSync.mockImplementation((p: string) => {
        // compose/ dir exists, and root also has compose files
        return (
          p === "/myproject/compose" || p === "/myproject/docker-compose.yaml"
        )
      })
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject/compose") return ["base.yaml", "db.yaml"]
        if (p === "/myproject") return ["docker-compose.yaml"]
        return []
      })

      const result = discoverComposeFiles("/myproject")
      expect(result).toEqual([
        "/myproject/compose/base.yaml",
        "/myproject/compose/db.yaml",
      ])
    })

    it("ignores non-compose yaml files in auto-glob", () => {
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject")
          return [
            "docker-compose.yaml",
            "values.yaml",
            "config.yaml",
            "README.md",
          ]
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return p === "/myproject/docker-compose.yaml"
      })
      mockReadFileSync.mockReturnValue(
        "services:\n  api:\n    build:\n      context: .\n"
      )

      const result = discoverComposeFiles("/myproject")
      expect(result).toEqual(["/myproject/docker-compose.yaml"])
    })
  })

  describe("deep merge across compose files", () => {
    it("deep-merges environment variables for the same service", () => {
      // Files sort alphabetically: docker-compose.yaml (base) then docker-compose.z-override.yaml
      const files = ["docker-compose.yaml", "docker-compose.z-override.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return `
services:
  api:
    build:
      context: ./api
    environment:
      NODE_ENV: production
      PORT: "3000"
    ports:
      - "3000:3000"
`
        if (p.endsWith("z-override.yaml"))
          return `
services:
  api:
    environment:
      DEBUG: "true"
      NODE_ENV: development
`
        return ""
      })

      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const api = result.system.components.api
      // Environment should be merged: override wins for NODE_ENV, DEBUG added, PORT preserved
      expect(api.spec.environment).toEqual({
        NODE_ENV: "development",
        PORT: "3000",
        DEBUG: "true",
      })
      // Build context should be preserved from base
      expect(api.spec.build?.context).toBe("./api")
    })

    it("concatenates and deduplicates ports across files", () => {
      const files = ["docker-compose.yaml", "docker-compose.extra.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
`
        if (p.endsWith("extra.yaml"))
          return `
services:
  api:
    ports:
      - "3000:3000"
      - "9090:9090"
`
        return ""
      })

      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const ports = result.system.components.api.spec.ports
      // Should have both ports, with 3000 deduplicated
      expect(ports).toHaveLength(2)
      expect(ports.map((p) => p.port)).toEqual([3000, 9090])
    })

    it("deep-merges labels across files", () => {
      // Files sort alphabetically: docker-compose.yaml (base) then docker-compose.z-labels.yaml
      const files = ["docker-compose.yaml", "docker-compose.z-labels.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return `
services:
  api:
    build:
      context: .
    labels:
      dx.type: service
      dx.owner: backend
`
        if (p.endsWith("z-labels.yaml"))
          return `
services:
  api:
    labels:
      dx.description: "Main API"
      dx.owner: platform
`
        return ""
      })

      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const api = result.system.components.api
      // owner overridden by second file, description added, type preserved
      expect(api.spec.type).toBe("service")
      expect(api.metadata.description).toBe("Main API")
      expect(api.spec.owner).toBe("platform")
    })

    it("adds new services from overlay files", () => {
      const files = ["docker-compose.yaml", "docker-compose.db.yaml"]
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files
        return []
      })
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`)
      })
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml"))
          return `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
`
        if (p.endsWith("db.yaml"))
          return `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
        return ""
      })

      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components.api).toBeDefined()
      expect(result.system.resources.postgres).toBeDefined()
      expect(result.system.resources.postgres.spec.type).toBe("database")
    })
  })

  describe("generate", () => {
    it("generates docker-compose.yaml from CatalogSystem", () => {
      const system: CatalogSystem = {
        kind: "System",
        metadata: { name: "myapp", namespace: "default" },
        spec: { owner: "team" },
        components: {
          api: {
            kind: "Component",
            metadata: { name: "api", namespace: "default" },
            spec: {
              type: "service",
              build: { context: "./api" },
              ports: [{ name: "http", port: 3000, protocol: "http" }],
              environment: { NODE_ENV: "production" },
            },
          },
        },
        resources: {
          postgres: {
            kind: "Resource",
            metadata: { name: "postgres", namespace: "default" },
            spec: {
              type: "database",
              image: "postgres:16",
              ports: [{ name: "default", port: 5432, protocol: "tcp" }],
              environment: { POSTGRES_DB: "mydb" },
            },
          },
        },
        connections: [],
      }

      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.generate(system)

      expect(result.files["docker-compose.yaml"]).toBeDefined()
      const content = result.files["docker-compose.yaml"]
      expect(content).toContain("services:")
      expect(content).toContain("postgres:16")
    })
  })

  // ─── depEnv: dx.dep label parsing + convention auto-detection ──

  describe("depEnv label parsing", () => {
    it("parses dx.dep.<dep>.env.<var> labels into depEnv", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  metabase:
    image: metabase/metabase:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      MB_DB_TYPE: postgres
    labels:
      dx.kind: Resource
      dx.dep.postgres.env.MB_DB_HOST: "{host}"
      dx.dep.postgres.env.MB_DB_PORT: "{port}"
      dx.dep.postgres.env.MB_DB_USER: "{POSTGRES_USER}"
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const metabase = result.system.resources.metabase
      expect(metabase).toBeDefined()
      expect(metabase.spec.depEnv).toBeDefined()
      expect(metabase.spec.depEnv!.postgres).toEqual({
        MB_DB_HOST: "{host}",
        MB_DB_PORT: "{port}",
        MB_DB_USER: "{POSTGRES_USER}",
      })
    })

    it("explicit dx.dep labels override convention auto-detection", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  app:
    image: myapp:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgres://user:pass@postgres:5432/db"
    labels:
      dx.dep.postgres.env.CUSTOM_HOST: "{host}"
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const app = result.system.components.app
      expect(app).toBeDefined()
      // Explicit label wins — convention should be skipped for 'postgres' dep
      expect(app.spec.depEnv!.postgres).toEqual({
        CUSTOM_HOST: "{host}",
      })
      // DATABASE_URL should NOT be in depEnv (explicit override blocks convention)
      expect(app.spec.depEnv!.postgres.DATABASE_URL).toBeUndefined()
    })
  })

  describe("depEnv convention auto-detection", () => {
    it("auto-detects URL-style env vars referencing dep hostname", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  auth:
    image: auth:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      AUTH_DATABASE_URL: "postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@postgres:5432/\${POSTGRES_DB:-postgres}"
    labels:
      dx.kind: Resource
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const auth = result.system.resources.auth
      expect(auth).toBeDefined()
      expect(auth.spec.depEnv).toBeDefined()
      expect(auth.spec.depEnv!.postgres).toBeDefined()
      expect(auth.spec.depEnv!.postgres.AUTH_DATABASE_URL).toBeDefined()
    })

    it("preserves raw ${VAR:-default} patterns in auto-detected depEnv", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  app:
    build:
      context: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_URL: "postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-secret}@postgres:5432/mydb"
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const app = result.system.components.app
      expect(app.spec.depEnv!.postgres.DB_URL).toContain(
        "${POSTGRES_USER:-postgres}"
      )
      expect(app.spec.depEnv!.postgres.DB_URL).toContain(
        "${POSTGRES_PASSWORD:-secret}"
      )
      // Should NOT be resolved to the default values
      expect(app.spec.depEnv!.postgres.DB_URL).not.toBe(
        "postgres://postgres:secret@postgres:5432/mydb"
      )
    })

    it("does not auto-detect when env var does not contain dep hostname", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  app:
    build:
      context: .
    depends_on:
      redis:
        condition: service_healthy
    environment:
      APP_NAME: "my-app"
      LOG_LEVEL: "debug"
  redis:
    image: redis:7
    ports:
      - "6379:6379"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const app = result.system.components.app
      // No env vars reference "redis" hostname → no depEnv
      expect(app.spec.depEnv).toBeUndefined()
    })

    it("auto-detects HTTP-style env vars for service deps", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  factory:
    build:
      context: .
    depends_on:
      auth:
        condition: service_healthy
    environment:
      AUTH_JWKS_URL: "http://auth:3000/api/v1/auth/.well-known/jwks.json"
  auth:
    image: auth:latest
    ports:
      - "8180:3000"
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      const factory = result.system.components.factory
      expect(factory.spec.depEnv).toBeDefined()
      expect(factory.spec.depEnv!.auth).toBeDefined()
      expect(factory.spec.depEnv!.auth.AUTH_JWKS_URL).toContain("auth:3000")
    })
  })

  describe("init container detection", () => {
    it("detects service with restart:no + init name suffix as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  postgres:
    image: postgres:15
    restart: unless-stopped
    ports:
      - "5432:5432"
  postgres-init:
    image: postgres:15
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    command: ["/bin/bash", "/init.sh"]
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["postgres-init"]).toBeDefined()
      expect(result.system.components["postgres-init"].spec.type).toBe("init")
      expect(result.system.components["postgres-init"].spec.initFor).toBe(
        "postgres"
      )
    })

    it("detects service with restart:no + migrate suffix as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  spicedb:
    image: authzed/spicedb:latest
    restart: unless-stopped
    ports:
      - "50051:50051"
  spicedb-migrate:
    image: authzed/spicedb:latest
    restart: "no"
    command: ["datastore", "migrate", "head"]
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["spicedb-migrate"]).toBeDefined()
      expect(result.system.components["spicedb-migrate"].spec.type).toBe("init")
      // Same image match resolves parent
      expect(result.system.components["spicedb-migrate"].spec.initFor).toBe(
        "spicedb"
      )
    })

    it("detects restart:no + no ports + depends_on as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  db:
    image: postgres:15
    restart: unless-stopped
    ports:
      - "5432:5432"
  my-setup:
    image: alpine:latest
    restart: "no"
    command: ["echo", "done"]
    depends_on:
      - db
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["my-setup"]).toBeDefined()
      expect(result.system.components["my-setup"].spec.type).toBe("init")
    })

    it("does NOT detect restart:no + no ports alone (no depends_on) as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  standalone-job:
    image: alpine:latest
    restart: "no"
    command: ["echo", "done"]
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      // Without depends_on, a portless restart:no container is NOT classified as init
      expect(result.system.components["standalone-job"]).toBeDefined()
      expect(result.system.components["standalone-job"].spec.type).not.toBe(
        "init"
      )
    })

    it("detects service_completed_successfully dependents as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  db:
    image: postgres:15
    restart: unless-stopped
    ports:
      - "5432:5432"
  seed-data:
    image: myorg/seeder:latest
    restart: "no"
    ports:
      - "9999:9999"
  app:
    image: myorg/app:latest
    restart: unless-stopped
    depends_on:
      seed-data:
        condition: service_completed_successfully
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["seed-data"]).toBeDefined()
      expect(result.system.components["seed-data"].spec.type).toBe("init")
    })

    it("does NOT detect service with restart:unless-stopped as init", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  my-worker:
    image: myorg/worker:latest
    restart: unless-stopped
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["my-worker"]).toBeDefined()
      expect(result.system.components["my-worker"].spec.type).toBe("service")
    })

    it("respects explicit dx.type:init label", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  custom-init:
    image: myorg/custom:latest
    restart: always
    labels:
      dx.type: init
      dx.initFor: main-service
  main-service:
    image: myorg/main:latest
    restart: unless-stopped
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      expect(result.system.components["custom-init"].spec.type).toBe("init")
      expect(result.system.components["custom-init"].spec.initFor).toBe(
        "main-service"
      )
    })

    it("init container is classified as component even with infra image", () => {
      setupComposeFile(
        "/myproject",
        `
services:
  postgres:
    image: postgres:15
    restart: unless-stopped
    ports:
      - "5432:5432"
  postgres-init:
    image: postgis/postgis:16-3.4-alpine
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    command: ["/bin/bash", "/ensure-db.sh"]
`
      )
      const adapter = new DockerComposeFormatAdapter()
      const result = adapter.parse("/myproject")
      // Should be a component (init), not a resource
      expect(result.system.components["postgres-init"]).toBeDefined()
      expect(result.system.components["postgres-init"].spec.type).toBe("init")
      expect(result.system.resources["postgres-init"]).toBeUndefined()
    })
  })
})
