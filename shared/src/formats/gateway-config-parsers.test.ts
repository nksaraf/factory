import { describe, expect, it } from "vitest"

import {
  findParserForImage,
  looksLikeConfigFile,
  parseGatewayConfigs,
  parseVolumeParts,
} from "./gateway-config-parsers"

// ── APISIX fixtures ──────────────────────────────────────────

const APISIX_CONFIG = `
upstreams:
- id: auth-service
  nodes:
    infra-auth:3000: 1
- id: factory-service
  nodes:
    infra-factory:4100: 1
  timeout:
    connect: 5
    send: 30
    read: 120
- id: api-docs
  nodes:
    infra-api-docs:80: 1
routes:
- id: auth
  uri: /api/v1/auth*
  upstream_id: auth-service
- id: factory
  uri: /api/v1/factory*
  upstream_id: factory-service
  enable_websocket: true
- id: webhooks
  uri: /webhooks/*
  upstream_id: factory-service
- id: docs-portal
  uri: /docs
  upstream_id: api-docs
`

// ── Traefik fixtures ─────────────────────────────────────────

const TRAEFIK_CONFIG = `
http:
  routers:
    gateway-router:
      rule: "PathPrefix(\`/api/v1\`)"
      service: infra-gateway
      priority: 200
    webhooks-router:
      rule: "PathPrefix(\`/webhooks\`)"
      service: infra-gateway
      priority: 200
  services:
    infra-gateway:
      loadBalancer:
        servers:
          - url: "http://infra-gateway:8005"
        passHostHeader: true
`

// ── Tests ────────────────────────────────────────────────────

describe("gateway-config-parsers", () => {
  describe("findParserForImage", () => {
    it("matches apache/apisix:3.11.0-debian", () => {
      expect(findParserForImage("apache/apisix:3.11.0-debian")).not.toBeNull()
    })

    it("matches traefik:v3.6.8", () => {
      expect(findParserForImage("traefik:v3.6.8")).not.toBeNull()
    })

    it("matches plain apisix", () => {
      expect(findParserForImage("apisix")).not.toBeNull()
    })

    it("returns null for non-gateway images", () => {
      expect(findParserForImage("postgres:15")).toBeNull()
      expect(findParserForImage("redis:7")).toBeNull()
      expect(findParserForImage("nginx:alpine")).toBeNull() // nginx not registered yet
    })
  })

  describe("looksLikeConfigFile", () => {
    it("accepts config file extensions", () => {
      expect(looksLikeConfigFile("/etc/apisix/apisix.yaml")).toBe(true)
      expect(looksLikeConfigFile("/etc/traefik/dynamic.yml")).toBe(true)
      expect(looksLikeConfigFile("/etc/haproxy/haproxy.conf")).toBe(true)
      expect(looksLikeConfigFile("/app/config.toml")).toBe(true)
      expect(looksLikeConfigFile("/app/config.json")).toBe(true)
    })

    it("rejects non-config paths", () => {
      expect(looksLikeConfigFile("/data/db")).toBe(false)
      expect(looksLikeConfigFile("/var/log/access")).toBe(false)
      expect(looksLikeConfigFile("/app/binary")).toBe(false)
    })
  })

  describe("parseVolumeParts", () => {
    it("parses host:container volume", () => {
      const result = parseVolumeParts(
        "./infra/apisix/apisix.yaml:/usr/local/apisix/conf/apisix.yaml:ro"
      )
      expect(result).toEqual({
        hostPath: "./infra/apisix/apisix.yaml",
        containerPath: "/usr/local/apisix/conf/apisix.yaml",
      })
    })

    it("parses without :ro suffix", () => {
      const result = parseVolumeParts("./config.yaml:/etc/config.yaml")
      expect(result).toEqual({
        hostPath: "./config.yaml",
        containerPath: "/etc/config.yaml",
      })
    })

    it("skips named volumes", () => {
      expect(parseVolumeParts("pgdata:/var/lib/postgresql/data")).toBeNull()
    })

    it("returns null for bare paths", () => {
      expect(parseVolumeParts("/single/path")).toBeNull()
    })
  })

  describe("APISIX parser", () => {
    const parser = findParserForImage("apache/apisix:3.11.0-debian")!

    it("extracts upstream targets", () => {
      const targets = parser.parse(APISIX_CONFIG, "apisix.yaml")
      expect(targets).toHaveLength(3)

      const auth = targets.find((t) => t.service === "infra-auth")
      expect(auth).toEqual({
        service: "infra-auth",
        port: 3000,
        routes: ["/api/v1/auth*"],
      })

      const factory = targets.find((t) => t.service === "infra-factory")
      expect(factory).toEqual({
        service: "infra-factory",
        port: 4100,
        routes: ["/api/v1/factory*", "/webhooks/*"],
      })

      const docs = targets.find((t) => t.service === "infra-api-docs")
      expect(docs).toEqual({
        service: "infra-api-docs",
        port: 80,
        routes: ["/docs"],
      })
    })

    it("handles inline upstream on route", () => {
      const config = `
routes:
- id: inline-route
  uri: /inline*
  upstream:
    nodes:
      my-service:8080: 1
`
      const targets = parser.parse(config, "test.yaml")
      expect(targets).toHaveLength(1)
      expect(targets[0]).toEqual({
        service: "my-service",
        port: 8080,
        routes: ["/inline*"],
      })
    })

    it("handles array-form nodes", () => {
      const config = `
upstreams:
- id: array-upstream
  nodes:
    - host: my-service
      port: 9090
      weight: 2
`
      const targets = parser.parse(config, "test.yaml")
      expect(targets).toHaveLength(1)
      expect(targets[0]).toEqual({
        service: "my-service",
        port: 9090,
        weight: 2,
      })
    })

    it("returns empty for empty config", () => {
      expect(parser.parse("", "test.yaml")).toEqual([])
      expect(parser.parse("{}", "test.yaml")).toEqual([])
    })

    it("returns empty for malformed YAML", () => {
      expect(parser.parse("{{invalid", "test.yaml")).toEqual([])
    })

    it("returns empty for config without upstreams", () => {
      const config = `
global_rules:
- id: 1
  plugins:
    real-ip:
      source: http_x_forwarded_for
`
      expect(parser.parse(config, "test.yaml")).toEqual([])
    })
  })

  describe("Traefik parser", () => {
    const parser = findParserForImage("traefik:v3.6.8")!

    it("extracts loadBalancer targets with routes", () => {
      const targets = parser.parse(TRAEFIK_CONFIG, "dynamic.yml")
      expect(targets).toHaveLength(1)
      expect(targets[0]).toEqual({
        service: "infra-gateway",
        port: 8005,
        routes: ["/api/v1", "/webhooks"],
      })
    })

    it("handles URL without explicit port (defaults to 80)", () => {
      const config = `
http:
  services:
    frontend:
      loadBalancer:
        servers:
          - url: "http://my-app"
`
      const targets = parser.parse(config, "test.yml")
      expect(targets).toHaveLength(1)
      expect(targets[0]).toEqual({
        service: "my-app",
        port: 80,
      })
    })

    it("handles HTTPS URL without port (defaults to 443)", () => {
      const config = `
http:
  services:
    secure:
      loadBalancer:
        servers:
          - url: "https://my-app"
`
      const targets = parser.parse(config, "test.yml")
      expect(targets[0]!.port).toBe(443)
    })

    it("extracts Path() rule (not just PathPrefix)", () => {
      const config = `
http:
  routers:
    exact:
      rule: "Path(\`/exact\`)"
      service: my-svc
  services:
    my-svc:
      loadBalancer:
        servers:
          - url: "http://backend:3000"
`
      const targets = parser.parse(config, "test.yml")
      expect(targets[0]!.routes).toEqual(["/exact"])
    })

    it("returns empty for empty config", () => {
      expect(parser.parse("", "test.yml")).toEqual([])
      expect(parser.parse("{}", "test.yml")).toEqual([])
    })

    it("returns empty for config without http section", () => {
      const config = `
tcp:
  routers:
    tcp-route:
      rule: "HostSNI(*)"
`
      expect(parser.parse(config, "test.yml")).toEqual([])
    })
  })

  describe("parseGatewayConfigs integration", () => {
    it("parses real APISIX config from project", () => {
      const warnings: string[] = []
      const targets = parseGatewayConfigs(
        "apache/apisix:3.11.0-debian",
        [
          "./infra/apisix/config.yaml:/usr/local/apisix/conf/config.yaml:ro",
          "./infra/apisix/apisix.yaml:/usr/local/apisix/conf/apisix.yaml:ro",
        ],
        process.cwd() + "/..", // shared/ → project root
        warnings
      )

      // Should find targets from apisix.yaml (config.yaml has no upstreams)
      expect(targets.length).toBeGreaterThanOrEqual(3)
      expect(targets.find((t) => t.service === "infra-auth")).toBeDefined()
      expect(targets.find((t) => t.service === "infra-factory")).toBeDefined()
      expect(targets.find((t) => t.service === "infra-api-docs")).toBeDefined()
    })

    it("parses real Traefik config from project", () => {
      const warnings: string[] = []
      const targets = parseGatewayConfigs(
        "traefik:v3.6.8",
        ["./infra/traefik/dynamic.yml:/etc/traefik/dynamic/dynamic.yml:ro"],
        process.cwd() + "/..",
        warnings
      )

      expect(targets.length).toBeGreaterThanOrEqual(1)
      expect(targets.find((t) => t.service === "infra-gateway")).toBeDefined()
    })

    it("returns empty for non-gateway images", () => {
      const targets = parseGatewayConfigs(
        "postgres:15",
        ["./data:/var/lib/postgresql/data"],
        "/some/dir"
      )
      expect(targets).toEqual([])
    })

    it("deduplicates targets across files", () => {
      // If same service:port appears in multiple files, only include once
      const warnings: string[] = []
      const targets = parseGatewayConfigs(
        "apache/apisix:3.11.0-debian",
        [
          "./infra/apisix/apisix.yaml:/usr/local/apisix/conf/apisix.yaml:ro",
          // Same file mounted twice (hypothetical)
          "./infra/apisix/apisix.yaml:/usr/local/apisix/conf/backup.yaml:ro",
        ],
        process.cwd() + "/..",
        warnings
      )

      // Each target should appear only once
      const services = targets.map((t) => `${t.service}:${t.port}`)
      expect(new Set(services).size).toBe(services.length)
    })

    it("handles missing files gracefully", () => {
      const warnings: string[] = []
      const targets = parseGatewayConfigs(
        "apache/apisix:3.11.0-debian",
        ["./nonexistent.yaml:/etc/config.yaml:ro"],
        "/tmp",
        warnings
      )
      expect(targets).toEqual([])
      expect(warnings.length).toBe(1)
    })
  })
})
