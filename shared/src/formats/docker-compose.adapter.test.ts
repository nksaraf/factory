import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { CatalogSystem } from "../catalog";
import { DockerComposeFormatAdapter, discoverComposeFiles } from "./docker-compose.adapter";

// ─── Helpers ──────────────────────────────────────────────────

/**
 * We mock node:fs so the adapter can "read" compose files without
 * touching the real filesystem.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import { existsSync, readFileSync, readdirSync } from "node:fs";

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as unknown as ReturnType<typeof vi.fn>;

function setupComposeFile(
  rootDir: string,
  yamlContent: string,
  filename = "docker-compose.yaml",
) {
  mockExistsSync.mockImplementation((p: string) => {
    return p === `${rootDir}/${filename}`;
  });
  mockReadFileSync.mockReturnValue(yamlContent);
  // Auto-glob: readdirSync on rootDir returns the filename
  mockReaddirSync.mockImplementation((p: string) => {
    if (p === rootDir) return [filename];
    return [];
  });
}

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockReaddirSync.mockReset();
  // Default: readdirSync returns empty array
  mockReaddirSync.mockReturnValue([]);
});

// ─── Classification heuristics ───────────────────────────────

describe("DockerComposeFormatAdapter", () => {
  describe("classification heuristics", () => {
    it("classifies service with build context as Component", () => {
      setupComposeFile("/myproject", `
services:
  webapp:
    build:
      context: ./app
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.webapp).toBeDefined();
      expect(result.system.resources.webapp).toBeUndefined();
    });

    it("classifies postgres image as Resource (database)", () => {
      setupComposeFile("/myproject", `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.postgres).toBeDefined();
      expect(result.system.resources.postgres.spec.type).toBe("database");
    });

    it("classifies redis image as Resource (cache)", () => {
      setupComposeFile("/myproject", `
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.redis).toBeDefined();
      expect(result.system.resources.redis.spec.type).toBe("cache");
    });

    it("classifies rabbitmq image as Resource (queue)", () => {
      setupComposeFile("/myproject", `
services:
  mq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.mq).toBeDefined();
      expect(result.system.resources.mq.spec.type).toBe("queue");
    });

    it("classifies minio image as Resource (storage)", () => {
      setupComposeFile("/myproject", `
services:
  storage:
    image: minio/minio
    ports:
      - "9000:9000"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.storage).toBeDefined();
      expect(result.system.resources.storage.spec.type).toBe("storage");
    });

    it("classifies elasticsearch image as Resource (search)", () => {
      setupComposeFile("/myproject", `
services:
  es:
    image: elasticsearch:8
    ports:
      - "9200:9200"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.es).toBeDefined();
      expect(result.system.resources.es.spec.type).toBe("search");
    });

    it("classifies traefik image as Resource (gateway)", () => {
      setupComposeFile("/myproject", `
services:
  proxy:
    image: traefik:v3
    ports:
      - "80:80"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.proxy).toBeDefined();
      expect(result.system.resources.proxy.spec.type).toBe("gateway");
    });

    it("classifies custom image with no build as Component (default)", () => {
      setupComposeFile("/myproject", `
services:
  myservice:
    image: myorg/myservice:latest
    ports:
      - "8080:8080"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.myservice).toBeDefined();
    });

    it("classifies by name: 'db' → Resource", () => {
      setupComposeFile("/myproject", `
services:
  db:
    image: mycompany/custom-db:latest
    ports:
      - "5432:5432"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.db).toBeDefined();
    });

    it("classifies by name: 'postgres' → Resource", () => {
      setupComposeFile("/myproject", `
services:
  postgres:
    image: mycompany/custom-pg:latest
    ports:
      - "5432:5432"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.postgres).toBeDefined();
    });
  });

  describe("port parsing", () => {
    it("parses '8080:80' → host 8080, container 80", () => {
      setupComposeFile("/myproject", `
services:
  pg:
    image: postgres:16
    ports:
      - "8080:80"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const res = result.system.resources.pg;
      expect(res.spec.ports[0]?.port).toBe(8080);
      // containerPort is set when it differs from host
      expect(res.spec.containerPort).toBe(80);
    });

    it("parses '8080' → host 8080, container 8080", () => {
      setupComposeFile("/myproject", `
services:
  app:
    build:
      context: .
    ports:
      - "8080"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const comp = result.system.components.app;
      expect(comp.spec.ports[0]?.port).toBe(8080);
    });

    it("parses '127.0.0.1:8080:80' → host 8080, container 80", () => {
      setupComposeFile("/myproject", `
services:
  pg:
    image: postgres:16
    ports:
      - "127.0.0.1:8080:80"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const res = result.system.resources.pg;
      expect(res.spec.ports[0]?.port).toBe(8080);
      expect(res.spec.containerPort).toBe(80);
    });
  });

  describe("component conversion", () => {
    it("maps build context and dockerfile", () => {
      setupComposeFile("/myproject", `
services:
  api:
    build:
      context: ./services/api
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const comp = result.system.components.api;
      expect(comp.spec.build?.context).toBe("./services/api");
      expect(comp.spec.build?.dockerfile).toBe("Dockerfile.prod");
    });

    it("maps image for image-based components", () => {
      setupComposeFile("/myproject", `
services:
  frontend:
    image: myorg/frontend:v2
    ports:
      - "8080:80"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.frontend.spec.image).toBe(
        "myorg/frontend:v2",
      );
    });

    it("maps ports correctly", () => {
      setupComposeFile("/myproject", `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
      - "3001:3001"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const ports = result.system.components.api.spec.ports;
      expect(ports).toHaveLength(2);
      expect(ports[0]?.port).toBe(3000);
      expect(ports[1]?.port).toBe(3001);
    });

    it("maps environment variables", () => {
      setupComposeFile("/myproject", `
services:
  api:
    build:
      context: .
    environment:
      NODE_ENV: production
      PORT: "3000"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.api.spec.environment).toEqual({
        NODE_ENV: "production",
        PORT: "3000",
      });
    });

    it("maps command to dev config", () => {
      setupComposeFile("/myproject", `
services:
  api:
    build:
      context: .
    command: npm run dev
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.api.spec.dev?.command).toBe(
        "npm run dev",
      );
    });
  });

  describe("resource conversion", () => {
    it("maps image correctly", () => {
      setupComposeFile("/myproject", `
services:
  pg:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.pg.spec.image).toBe("postgres:16-alpine");
    });

    it("maps environment correctly", () => {
      setupComposeFile("/myproject", `
services:
  pg:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: admin
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.pg.spec.environment).toEqual({
        POSTGRES_DB: "mydb",
        POSTGRES_USER: "admin",
      });
    });

    it("maps volumes correctly", () => {
      setupComposeFile("/myproject", `
services:
  pg:
    image: postgres:16
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.pg.spec.volumes).toEqual([
        "pgdata:/var/lib/postgresql/data",
      ]);
    });

    it("maps healthcheck from string test", () => {
      setupComposeFile("/myproject", `
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
`);
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.resources.pg.spec.healthcheck).toBe(
        "pg_isready -U postgres",
      );
    });
  });

  describe("system naming", () => {
    it("uses directory basename as system name", () => {
      setupComposeFile("/home/user/my-awesome-project", `
services:
  api:
    build:
      context: .
`, "docker-compose.yaml");
      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/home/user/my-awesome-project");
      expect(result.system.metadata.name).toBe("my-awesome-project");
    });
  });

  describe("detect", () => {
    it("detects docker-compose.yaml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("docker-compose.yaml"),
      );
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return ["docker-compose.yaml"];
        return [];
      });
      const adapter = new DockerComposeFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(true);
    });

    it("detects compose.yml", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("compose.yml"),
      );
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return ["compose.yml"];
        return [];
      });
      const adapter = new DockerComposeFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(true);
    });

    it("returns false when no compose file exists", () => {
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([]);
      const adapter = new DockerComposeFormatAdapter();
      expect(adapter.detect("/myproject")).toBe(false);
    });
  });

  describe("multi-file discovery", () => {
    it("auto-globs multiple compose files at root", () => {
      const files = ["compose.yaml", "docker-compose.db.yaml", "docker-compose.monitoring.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        // compose/ dir does not exist; individual files exist
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("compose.yaml")) return "services:\n  api:\n    build:\n      context: .\n";
        if (p.endsWith("db.yaml")) return "services:\n  pg:\n    image: postgres:16\n";
        if (p.endsWith("monitoring.yaml")) return "services:\n  grafana:\n    image: grafana/grafana\n";
        return "";
      });

      const result = discoverComposeFiles("/myproject");
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        "/myproject/compose.yaml",
        "/myproject/docker-compose.db.yaml",
        "/myproject/docker-compose.monitoring.yaml",
      ]);
    });

    it("excludes files with x-dx.overlay: true", () => {
      const files = ["docker-compose.yaml", "docker-compose.prod.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return "services:\n  api:\n    build:\n      context: .\n";
        if (p.endsWith("prod.yaml")) return "x-dx:\n  overlay: true\nservices:\n  api:\n    deploy:\n      replicas: 3\n";
        return "";
      });

      const result = discoverComposeFiles("/myproject");
      expect(result).toEqual(["/myproject/docker-compose.yaml"]);
    });

    it("excludes files with non-matching x-dx.environment", () => {
      const files = ["docker-compose.yaml", "docker-compose.staging.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return "services:\n  api:\n    build:\n      context: .\n";
        if (p.endsWith("staging.yaml")) return "x-dx:\n  environment: staging\nservices:\n  api:\n    replicas: 2\n";
        return "";
      });

      // Default environment is "local" — staging file excluded
      const result = discoverComposeFiles("/myproject");
      expect(result).toEqual(["/myproject/docker-compose.yaml"]);

      // With matching environment — staging file included
      const result2 = discoverComposeFiles("/myproject", { environment: "staging" });
      expect(result2).toEqual([
        "/myproject/docker-compose.staging.yaml",
        "/myproject/docker-compose.yaml",
      ]);
    });

    it("explicitFiles overrides all auto-discovery", () => {
      // Even though there are many files on disk, only explicit ones are returned
      mockReaddirSync.mockReturnValue(["docker-compose.yaml", "docker-compose.db.yaml", "docker-compose.extra.yaml"]);
      mockExistsSync.mockImplementation((p: string) => {
        return p === "/myproject/docker-compose.yaml" || p === "/myproject/docker-compose.db.yaml";
      });

      const result = discoverComposeFiles("/myproject", {
        explicitFiles: ["docker-compose.yaml", "docker-compose.db.yaml"],
      });
      expect(result).toEqual([
        "/myproject/docker-compose.yaml",
        "/myproject/docker-compose.db.yaml",
      ]);
    });

    it("explicitFiles skips missing files with warning", () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p === "/myproject/docker-compose.yaml";
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = discoverComposeFiles("/myproject", {
        explicitFiles: ["docker-compose.yaml", "docker-compose.missing.yaml"],
      });
      expect(result).toEqual(["/myproject/docker-compose.yaml"]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("docker-compose.missing.yaml"),
      );
      warnSpy.mockRestore();
    });

    it("compose/ folder takes priority over auto-glob at root", () => {
      mockExistsSync.mockImplementation((p: string) => {
        // compose/ dir exists, and root also has compose files
        return p === "/myproject/compose" || p === "/myproject/docker-compose.yaml";
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject/compose") return ["base.yaml", "db.yaml"];
        if (p === "/myproject") return ["docker-compose.yaml"];
        return [];
      });

      const result = discoverComposeFiles("/myproject");
      expect(result).toEqual([
        "/myproject/compose/base.yaml",
        "/myproject/compose/db.yaml",
      ]);
    });

    it("ignores non-compose yaml files in auto-glob", () => {
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return ["docker-compose.yaml", "values.yaml", "config.yaml", "README.md"];
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return p === "/myproject/docker-compose.yaml";
      });
      mockReadFileSync.mockReturnValue("services:\n  api:\n    build:\n      context: .\n");

      const result = discoverComposeFiles("/myproject");
      expect(result).toEqual(["/myproject/docker-compose.yaml"]);
    });
  });

  describe("deep merge across compose files", () => {
    it("deep-merges environment variables for the same service", () => {
      // Files sort alphabetically: docker-compose.yaml (base) then docker-compose.z-override.yaml
      const files = ["docker-compose.yaml", "docker-compose.z-override.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return `
services:
  api:
    build:
      context: ./api
    environment:
      NODE_ENV: production
      PORT: "3000"
    ports:
      - "3000:3000"
`;
        if (p.endsWith("z-override.yaml")) return `
services:
  api:
    environment:
      DEBUG: "true"
      NODE_ENV: development
`;
        return "";
      });

      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const api = result.system.components.api;
      // Environment should be merged: override wins for NODE_ENV, DEBUG added, PORT preserved
      expect(api.spec.environment).toEqual({
        NODE_ENV: "development",
        PORT: "3000",
        DEBUG: "true",
      });
      // Build context should be preserved from base
      expect(api.spec.build?.context).toBe("./api");
    });

    it("concatenates and deduplicates ports across files", () => {
      const files = ["docker-compose.yaml", "docker-compose.extra.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
`;
        if (p.endsWith("extra.yaml")) return `
services:
  api:
    ports:
      - "3000:3000"
      - "9090:9090"
`;
        return "";
      });

      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const ports = result.system.components.api.spec.ports;
      // Should have both ports, with 3000 deduplicated
      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port)).toEqual([3000, 9090]);
    });

    it("deep-merges labels across files", () => {
      // Files sort alphabetically: docker-compose.yaml (base) then docker-compose.z-labels.yaml
      const files = ["docker-compose.yaml", "docker-compose.z-labels.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return `
services:
  api:
    build:
      context: .
    labels:
      catalog.type: service
      catalog.owner: backend
`;
        if (p.endsWith("z-labels.yaml")) return `
services:
  api:
    labels:
      catalog.description: "Main API"
      catalog.owner: platform
`;
        return "";
      });

      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      const api = result.system.components.api;
      // owner overridden by second file, description added, type preserved
      expect(api.spec.type).toBe("service");
      expect(api.metadata.description).toBe("Main API");
      expect(api.spec.owner).toBe("platform");
    });

    it("adds new services from overlay files", () => {
      const files = ["docker-compose.yaml", "docker-compose.db.yaml"];
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === "/myproject") return files;
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        return files.some((f) => p === `/myproject/${f}`);
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith("docker-compose.yaml")) return `
services:
  api:
    build:
      context: .
    ports:
      - "3000:3000"
`;
        if (p.endsWith("db.yaml")) return `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`;
        return "";
      });

      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.parse("/myproject");
      expect(result.system.components.api).toBeDefined();
      expect(result.system.resources.postgres).toBeDefined();
      expect(result.system.resources.postgres.spec.type).toBe("database");
    });
  });

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
      };

      const adapter = new DockerComposeFormatAdapter();
      const result = adapter.generate(system);

      expect(result.files["docker-compose.yaml"]).toBeDefined();
      const content = result.files["docker-compose.yaml"];
      expect(content).toContain("services:");
      expect(content).toContain("postgres:16");
    });
  });
});
