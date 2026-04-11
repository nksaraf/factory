import { describe, expect, it } from "vitest"
import { canPrincipalSeeEvent, severityGte } from "./scope-resolver"

describe("canPrincipalSeeEvent", () => {
  it("allows org-scoped events for org members", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "org", scopeId: "default" },
        {
          principalId: "prin_alice",
          scopes: [{ kind: "org", id: "default" }],
        }
      )
    ).toBe(true)
  })

  it("allows principal-scoped events for the owning principal", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "principal", scopeId: "prin_alice" },
        {
          principalId: "prin_alice",
          scopes: [{ kind: "org", id: "default" }],
        }
      )
    ).toBe(true)
  })

  it("denies principal-scoped events for other principals", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "principal", scopeId: "prin_alice" },
        {
          principalId: "prin_bob",
          scopes: [{ kind: "org", id: "default" }],
        }
      )
    ).toBe(false)
  })

  it("allows team-scoped events for team members", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "team", scopeId: "team_platform" },
        {
          principalId: "prin_alice",
          scopes: [{ kind: "team", id: "team_platform" }],
        }
      )
    ).toBe(true)
  })

  it("denies system-scoped events for non-admins", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "system", scopeId: "internal" },
        {
          principalId: "prin_alice",
          scopes: [{ kind: "org", id: "default" }],
          isAdmin: false,
        }
      )
    ).toBe(false)
  })

  it("allows system-scoped events for admins", () => {
    expect(
      canPrincipalSeeEvent(
        { scopeKind: "system", scopeId: "internal" },
        {
          principalId: "prin_alice",
          scopes: [{ kind: "org", id: "default" }],
          isAdmin: true,
        }
      )
    ).toBe(true)
  })
})

describe("severityGte", () => {
  it("compares severity levels", () => {
    expect(severityGte("critical", "info")).toBe(true)
    expect(severityGte("info", "warning")).toBe(false)
    expect(severityGte("info", "info")).toBe(true)
  })
})
