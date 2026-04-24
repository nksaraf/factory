import { describe, test, expect } from "bun:test"
import {
  EntityNotFoundError,
  EntityConflictError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ApiUnreachableError,
  RateLimitError,
  ExternalServiceError,
  SubprocessError,
  ConfigurationError,
  QuotaExceededError,
  StateCorruptionError,
  TimeoutError,
  RecoverySuggestion,
  CommonSuggestions,
  hasTag,
  type FactoryError,
} from "./errors"

describe("RecoverySuggestion", () => {
  test("constructs with all fields", () => {
    const s = new RecoverySuggestion({
      action: "dx status",
      description: "Check health",
      command: "dx status --json",
      agentActionable: true,
    })
    expect(s.action).toBe("dx status")
    expect(s.agentActionable).toBe(true)
  })
})

describe("CommonSuggestions", () => {
  test("rerunVerbose", () => {
    const s = CommonSuggestions.rerunVerbose()
    expect(s.action).toContain("--verbose")
  })

  test("checkStatus", () => {
    const s = CommonSuggestions.checkStatus()
    expect(s.action).toBe("dx status")
    expect(s.agentActionable).toBe(true)
  })

  test("checkConfig", () => {
    const s = CommonSuggestions.checkConfig()
    expect(s.action).toBe("dx config")
  })

  test("login", () => {
    const s = CommonSuggestions.login()
    expect(s.action).toContain("login")
  })

  test("checkConnectivity", () => {
    const s = CommonSuggestions.checkConnectivity()
    expect(s.agentActionable).toBe(true)
  })

  test("healState", () => {
    const s = CommonSuggestions.healState()
    expect(s.action).toBe("dx sync")
  })
})

describe("EntityNotFoundError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new EntityNotFoundError({ entity: "Site", identifier: "prod" })
    expect(err.message).toBe("Site not found: prod")
    expect(err.httpStatus).toBe(404)
    expect(err.errorCode).toBe("NOT_FOUND")
    expect(err.cliMetadata).toEqual({ entity: "Site", identifier: "prod" })
    expect(err._tag).toBe("EntityNotFoundError")
  })

  test("effectiveSuggestions defaults", () => {
    const err = new EntityNotFoundError({ entity: "Site", identifier: "prod" })
    expect(err.effectiveSuggestions.length).toBeGreaterThan(0)
  })

  test("caller-provided suggestions override defaults", () => {
    const custom = [
      new RecoverySuggestion({ action: "custom", description: "do this" }),
    ]
    const err = new EntityNotFoundError({
      entity: "Site",
      identifier: "prod",
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("EntityConflictError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new EntityConflictError({ entity: "Site", identifier: "prod" })
    expect(err.message).toContain("already exists")
    expect(err.httpStatus).toBe(409)
    expect(err.errorCode).toBe("CONFLICT")
    expect(err.cliMetadata).toEqual({ entity: "Site", identifier: "prod" })
  })

  test("effectiveSuggestions defaults", () => {
    const err = new EntityConflictError({ entity: "Site", identifier: "prod" })
    expect(err.effectiveSuggestions.length).toBeGreaterThan(0)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "x", description: "y" })]
    const err = new EntityConflictError({
      entity: "S",
      identifier: "i",
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("ValidationError", () => {
  test("message, httpStatus, errorCode", () => {
    const err = new ValidationError({ field: "name", reason: "too short" })
    expect(err.message).toContain("name")
    expect(err.httpStatus).toBe(422)
    expect(err.errorCode).toBe("VALIDATION_ERROR")
  })

  test("cliMetadata includes value when present", () => {
    const err = new ValidationError({
      field: "port",
      reason: "invalid",
      value: 99999,
    })
    expect(err.cliMetadata.value).toBe("99999")
  })

  test("cliMetadata excludes value when absent", () => {
    const err = new ValidationError({ field: "port", reason: "invalid" })
    expect(err.cliMetadata.value).toBeUndefined()
  })

  test("effectiveSuggestions empty by default", () => {
    const err = new ValidationError({ field: "x", reason: "y" })
    expect(err.effectiveSuggestions).toEqual([])
  })
})

describe("AuthenticationError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new AuthenticationError({ reason: "expired token" })
    expect(err.message).toContain("expired token")
    expect(err.httpStatus).toBe(401)
    expect(err.errorCode).toBe("AUTH_DENIED")
    expect(err.cliMetadata).toEqual({})
  })

  test("effectiveSuggestions includes login", () => {
    const err = new AuthenticationError({ reason: "expired" })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("login"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new AuthenticationError({ reason: "x", suggestions: custom })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("AuthorizationError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new AuthorizationError({
      action: "delete",
      resource: "site/prod",
    })
    expect(err.message).toContain("Not authorized")
    expect(err.httpStatus).toBe(403)
    expect(err.errorCode).toBe("AUTH_DENIED")
    expect(err.cliMetadata).toEqual({ action: "delete", resource: "site/prod" })
  })

  test("effectiveSuggestions defaults", () => {
    const err = new AuthorizationError({ action: "a", resource: "r" })
    expect(err.effectiveSuggestions.length).toBeGreaterThan(0)
  })
})

describe("ApiUnreachableError", () => {
  test("message with cause", () => {
    const err = new ApiUnreachableError({
      url: "https://api.example.com",
      cause: "ECONNREFUSED",
    })
    expect(err.message).toContain("api.example.com")
    expect(err.message).toContain("ECONNREFUSED")
    expect(err.httpStatus).toBe(502)
    expect(err.errorCode).toBe("API_UNREACHABLE")
  })

  test("message without cause", () => {
    const err = new ApiUnreachableError({ url: "https://api.example.com" })
    expect(err.message).toBe("API unreachable at https://api.example.com")
  })

  test("cliMetadata", () => {
    const err = new ApiUnreachableError({ url: "https://api.example.com" })
    expect(err.cliMetadata).toEqual({ url: "https://api.example.com" })
  })

  test("effectiveSuggestions includes curl", () => {
    const err = new ApiUnreachableError({ url: "https://api.example.com" })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("curl"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new ApiUnreachableError({ url: "x", suggestions: custom })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("RateLimitError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new RateLimitError({ retryAfterMs: 5000 })
    expect(err.message).toContain("5000ms")
    expect(err.httpStatus).toBe(429)
    expect(err.errorCode).toBe("RATE_LIMIT")
    expect(err.cliMetadata).toEqual({ retryAfterMs: 5000 })
  })

  test("effectiveSuggestions includes retry", () => {
    const err = new RateLimitError({ retryAfterMs: 5000 })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("retry"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new RateLimitError({ retryAfterMs: 100, suggestions: custom })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("ExternalServiceError", () => {
  test("message with statusCode", () => {
    const err = new ExternalServiceError({
      service: "stripe",
      operation: "charge",
      statusCode: 503,
    })
    expect(err.message).toContain("stripe")
    expect(err.message).toContain("503")
    expect(err.httpStatus).toBe(502)
    expect(err.errorCode).toBe("EXTERNAL_SERVICE_ERROR")
  })

  test("message without statusCode", () => {
    const err = new ExternalServiceError({
      service: "stripe",
      operation: "charge",
    })
    expect(err.message).not.toContain("(")
  })

  test("cliMetadata includes statusCode when present", () => {
    const err = new ExternalServiceError({
      service: "s",
      operation: "o",
      statusCode: 500,
    })
    expect(err.cliMetadata.statusCode).toBe(500)
  })

  test("cliMetadata excludes statusCode when absent", () => {
    const err = new ExternalServiceError({ service: "s", operation: "o" })
    expect(err.cliMetadata.statusCode).toBeUndefined()
  })

  test("effectiveSuggestions defaults", () => {
    const err = new ExternalServiceError({ service: "s", operation: "o" })
    expect(err.effectiveSuggestions.length).toBeGreaterThan(0)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new ExternalServiceError({
      service: "s",
      operation: "o",
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("SubprocessError", () => {
  test("message with stderr", () => {
    const err = new SubprocessError({
      command: "docker build",
      exitCode: 1,
      stderr: "no space",
    })
    expect(err.message).toContain("docker build")
    expect(err.message).toContain("no space")
    expect(err.httpStatus).toBe(500)
    expect(err.errorCode).toBe("SUBPROCESS_ERROR")
  })

  test("message without stderr", () => {
    const err = new SubprocessError({ command: "npm install", exitCode: 127 })
    expect(err.message).toBe('Command "npm install" exited with code 127')
  })

  test("cliMetadata includes stderr when present", () => {
    const err = new SubprocessError({
      command: "x",
      exitCode: 1,
      stderr: "fail",
    })
    expect(err.cliMetadata.stderr).toBe("fail")
  })

  test("cliMetadata excludes stderr when absent", () => {
    const err = new SubprocessError({ command: "x", exitCode: 1 })
    expect(err.cliMetadata.stderr).toBeUndefined()
  })

  test("effectiveSuggestions includes --verbose", () => {
    const err = new SubprocessError({ command: "x", exitCode: 1 })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("verbose"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new SubprocessError({
      command: "x",
      exitCode: 1,
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("ConfigurationError", () => {
  test("message, errorCode", () => {
    const err = new ConfigurationError({
      key: "factory.url",
      reason: "not set",
    })
    expect(err.message).toContain("factory.url")
    expect(err.errorCode).toBe("CONFIGURATION_ERROR")
  })

  test("cliMetadata", () => {
    const err = new ConfigurationError({
      key: "factory.url",
      reason: "not set",
    })
    expect(err.cliMetadata).toEqual({ key: "factory.url" })
  })

  test("effectiveSuggestions includes dx config", () => {
    const err = new ConfigurationError({ key: "x", reason: "y" })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("config"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new ConfigurationError({
      key: "x",
      reason: "y",
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("QuotaExceededError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new QuotaExceededError({
      resource: "sites",
      current: 5,
      maximum: 3,
    })
    expect(err.message).toContain("5/3")
    expect(err.httpStatus).toBe(429)
    expect(err.errorCode).toBe("QUOTA_EXCEEDED")
    expect(err.cliMetadata).toEqual({
      resource: "sites",
      current: 5,
      maximum: 3,
    })
  })

  test("effectiveSuggestions empty by default", () => {
    const err = new QuotaExceededError({
      resource: "x",
      current: 1,
      maximum: 1,
    })
    expect(err.effectiveSuggestions).toEqual([])
  })
})

describe("StateCorruptionError", () => {
  test("message with cause", () => {
    const err = new StateCorruptionError({
      path: "/tmp/site.json",
      cause: "invalid JSON",
    })
    expect(err.message).toContain("/tmp/site.json")
    expect(err.message).toContain("invalid JSON")
    expect(err.httpStatus).toBe(500)
    expect(err.errorCode).toBe("STATE_CORRUPTION")
  })

  test("message without cause", () => {
    const err = new StateCorruptionError({ path: "/tmp/site.json" })
    expect(err.message).toBe("State file corrupted at /tmp/site.json")
  })

  test("cliMetadata", () => {
    const err = new StateCorruptionError({ path: "/tmp/x.json" })
    expect(err.cliMetadata).toEqual({ path: "/tmp/x.json" })
  })

  test("effectiveSuggestions includes rm + dx dev", () => {
    const err = new StateCorruptionError({ path: "/tmp/x.json" })
    expect(err.effectiveSuggestions.some((s) => s.action.includes("rm"))).toBe(
      true
    )
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new StateCorruptionError({ path: "x", suggestions: custom })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("TimeoutError", () => {
  test("message, httpStatus, errorCode, cliMetadata", () => {
    const err = new TimeoutError({ operation: "deploy", durationMs: 30000 })
    expect(err.message).toContain("deploy")
    expect(err.message).toContain("30000ms")
    expect(err.httpStatus).toBe(504)
    expect(err.errorCode).toBe("TIMEOUT")
    expect(err.cliMetadata).toEqual({
      timedOutOperation: "deploy",
      durationMs: 30000,
    })
  })

  test("effectiveSuggestions includes retry", () => {
    const err = new TimeoutError({ operation: "fetch", durationMs: 10000 })
    expect(
      err.effectiveSuggestions.some((s) => s.action.includes("retry"))
    ).toBe(true)
  })

  test("caller-provided suggestions", () => {
    const custom = [new RecoverySuggestion({ action: "a", description: "b" })]
    const err = new TimeoutError({
      operation: "x",
      durationMs: 1,
      suggestions: custom,
    })
    expect(err.effectiveSuggestions).toEqual(custom)
  })
})

describe("hasTag", () => {
  test("discriminates correctly", () => {
    const err: FactoryError = new EntityNotFoundError({
      entity: "Site",
      identifier: "x",
    })
    expect(hasTag(err, "EntityNotFoundError")).toBe(true)
    expect(hasTag(err, "ValidationError")).toBe(false)
  })
})
