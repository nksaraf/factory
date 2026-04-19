import { describe, expect, test } from "bun:test"

import {
  normalizeEnvMapping,
  resolveEnvMapping,
  type EndpointMap,
} from "./endpoint-resolver"

describe("resolveEnvMapping", () => {
  test("string entries pass through as-is (fallback-only)", () => {
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_SERVICE_URL: "http://192.168.2.88:4300",
        QUEUE_URL: "amqp://192.168.2.88:5672",
      },
    })
    expect(result).toEqual({
      AUTH_SERVICE_URL: "http://192.168.2.88:4300",
      QUEUE_URL: "amqp://192.168.2.88:5672",
    })
  })

  test("object entry with fallback (no endpoint cache) → uses fallback", () => {
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_SERVICE_URL: {
          component: "auth-api",
          port: "http",
          template: "http://{host}:{port}",
          fallback: "http://192.168.2.88:4300",
        },
      },
    })
    expect(result.AUTH_SERVICE_URL).toBe("http://192.168.2.88:4300")
  })

  test("object entry resolved from endpoint cache → template interpolation", () => {
    const endpoints: EndpointMap = {
      "auth-api": { host: "10.0.1.50", port: 4300 },
    }
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_SERVICE_URL: {
          component: "auth-api",
          port: "http",
          template: "http://{host}:{port}",
          fallback: "http://should-not-use-this",
        },
      },
      endpoints,
    })
    expect(result.AUTH_SERVICE_URL).toBe("http://10.0.1.50:4300")
  })

  test("multi-port component → named port lookup", () => {
    const endpoints: EndpointMap = {
      "auth-api": {
        host: "10.0.1.50",
        port: 4300,
        ports: { http: 4300, grpc: 4301, metrics: 9090 },
      },
    }
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_HTTP_URL: {
          component: "auth-api",
          port: "http",
          template: "http://{host}:{port}",
        },
        AUTH_GRPC_URL: {
          component: "auth-api",
          port: "grpc",
          template: "grpc://{host}:{port}",
        },
        AUTH_METRICS_URL: {
          component: "auth-api",
          port: "metrics",
          template: "http://{host}:{port}/metrics",
        },
      },
      endpoints,
    })
    expect(result.AUTH_HTTP_URL).toBe("http://10.0.1.50:4300")
    expect(result.AUTH_GRPC_URL).toBe("grpc://10.0.1.50:4301")
    expect(result.AUTH_METRICS_URL).toBe("http://10.0.1.50:9090/metrics")
  })

  test("multiple components from same system", () => {
    const endpoints: EndpointMap = {
      "auth-api": { host: "10.0.1.50", port: 4300 },
      "auth-db": { host: "10.0.1.51", port: 5432 },
    }
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_SERVICE_URL: {
          component: "auth-api",
          template: "http://{host}:{port}",
        },
        AUTH_DATABASE_URL: {
          component: "auth-db",
          template: "postgresql://auth:pass@{host}:{port}/auth",
        },
      },
      endpoints,
    })
    expect(result.AUTH_SERVICE_URL).toBe("http://10.0.1.50:4300")
    expect(result.AUTH_DATABASE_URL).toBe(
      "postgresql://auth:pass@10.0.1.51:5432/auth"
    )
  })

  test("no endpoint, no fallback → key omitted (not empty string)", () => {
    const result = resolveEnvMapping({
      envMapping: {
        MISSING_URL: {
          component: "nonexistent",
          template: "http://{host}:{port}",
        },
      },
    })
    expect(result.MISSING_URL).toBeUndefined()
    expect("MISSING_URL" in result).toBe(false)
  })

  test("mixed string + object entries in same mapping", () => {
    const endpoints: EndpointMap = {
      "auth-api": { host: "10.0.1.50", port: 4300 },
    }
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_SERVICE_URL: {
          component: "auth-api",
          template: "http://{host}:{port}",
        },
        LEGACY_KEY: "sk_live_abc123",
      },
      endpoints,
    })
    expect(result.AUTH_SERVICE_URL).toBe("http://10.0.1.50:4300")
    expect(result.LEGACY_KEY).toBe("sk_live_abc123")
  })

  test("default port used when named port not in ports map", () => {
    const endpoints: EndpointMap = {
      "auth-api": { host: "10.0.1.50", port: 4300 },
    }
    const result = resolveEnvMapping({
      envMapping: {
        AUTH_URL: {
          component: "auth-api",
          port: "nonexistent-port-name",
          template: "http://{host}:{port}",
        },
      },
      endpoints,
    })
    // Falls back to the component's default port
    expect(result.AUTH_URL).toBe("http://10.0.1.50:4300")
  })
})

describe("normalizeEnvMapping", () => {
  test("converts deprecated env to envMapping", () => {
    const result = normalizeEnvMapping({
      env: { AUTH_URL: "http://host:4300" },
    })
    expect(result).toEqual({ AUTH_URL: "http://host:4300" })
  })

  test("envMapping entries win over env on same key", () => {
    const result = normalizeEnvMapping({
      env: { AUTH_URL: "http://old-value" },
      envMapping: {
        AUTH_URL: {
          component: "auth-api",
          template: "http://{host}:{port}",
          fallback: "http://new-value",
        },
      },
    })
    // envMapping wins
    expect(typeof result.AUTH_URL).toBe("object")
    expect((result.AUTH_URL as any).fallback).toBe("http://new-value")
  })

  test("both fields merge (different keys)", () => {
    const result = normalizeEnvMapping({
      env: { OLD_KEY: "old" },
      envMapping: { NEW_KEY: "new" },
    })
    expect(result.OLD_KEY).toBe("old")
    expect(result.NEW_KEY).toBe("new")
  })

  test("empty dep → empty mapping", () => {
    expect(normalizeEnvMapping({})).toEqual({})
  })
})
