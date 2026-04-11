import { describe, expect, test } from "bun:test"

import {
  connectionProfileSchema,
  normalizeProfileEntry,
  tunnelSpecSchema,
} from "./connection-context-schemas"

describe("connectionProfileSchema", () => {
  test("parses shorthand string entries", () => {
    const result = connectionProfileSchema.parse({
      description: "staging deps",
      connect: {
        postgres: "staging",
        redis: "staging",
      },
    })
    expect(result.connect.postgres).toBe("staging")
    expect(result.connect.redis).toBe("staging")
  })

  test("parses object entries", () => {
    const result = connectionProfileSchema.parse({
      connect: {
        postgres: { target: "production", readonly: true, backend: "kubectl" },
        auth: { target: "staging" },
      },
    })
    expect(result.connect.postgres).toEqual({
      target: "production",
      readonly: true,
      backend: "kubectl",
    })
    expect(result.connect.auth).toEqual({ target: "staging" })
  })

  test("parses mixed shorthand and object entries", () => {
    const result = connectionProfileSchema.parse({
      connect: {
        postgres: { target: "production", readonly: true },
        redis: "staging",
      },
    })
    expect(typeof result.connect.postgres).toBe("object")
    expect(typeof result.connect.redis).toBe("string")
  })
})

describe("tunnelSpecSchema", () => {
  test("parses full spec", () => {
    const result = tunnelSpecSchema.parse({
      name: "postgres",
      localPort: 15432,
      remoteHost: "staging-postgres.data.svc",
      remotePort: 5432,
      namespace: "data",
      backend: "kubectl",
      connectionString: "postgresql://dev:dev@localhost:15432/db",
    })
    expect(result.name).toBe("postgres")
    expect(result.backend).toBe("kubectl")
  })

  test("defaults backend to direct", () => {
    const result = tunnelSpecSchema.parse({
      name: "postgres",
      localPort: 15432,
      remoteHost: "localhost",
      remotePort: 5432,
    })
    expect(result.backend).toBe("direct")
    expect(result.namespace).toBeUndefined()
    expect(result.connectionString).toBeUndefined()
  })
})

describe("normalizeProfileEntry", () => {
  test("normalizes string shorthand", () => {
    const result = normalizeProfileEntry("staging")
    expect(result).toEqual({
      target: "staging",
      readonly: false,
      backend: "direct",
    })
  })

  test("normalizes object with defaults", () => {
    const result = normalizeProfileEntry({ target: "staging" })
    expect(result).toEqual({
      target: "staging",
      readonly: false,
      backend: "direct",
    })
  })

  test("preserves explicit values", () => {
    const result = normalizeProfileEntry({
      target: "production",
      readonly: true,
      backend: "kubectl",
    })
    expect(result).toEqual({
      target: "production",
      readonly: true,
      backend: "kubectl",
    })
  })
})
