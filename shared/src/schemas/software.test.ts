import { describe, expect, test } from "bun:test"

import { ComponentDependencySchema, SystemDependencySchema } from "./software"

describe("SystemDependencySchema (multi-system)", () => {
  test("minimal entry: only `system`", () => {
    const parsed = SystemDependencySchema.parse({ system: "shared-auth" })
    expect(parsed.system).toBe("shared-auth")
    // binding defaults to required (safest failure mode).
    expect(parsed.binding).toBe("required")
    expect(parsed.defaultTarget).toBeUndefined()
    expect(parsed.components).toBeUndefined()
  })

  test("accepts all binding values", () => {
    for (const binding of ["required", "optional", "dev-only"] as const) {
      const parsed = SystemDependencySchema.parse({
        system: "shared-observability",
        binding,
      })
      expect(parsed.binding).toBe(binding)
    }
  })

  test("rejects unknown binding values", () => {
    expect(() =>
      SystemDependencySchema.parse({ system: "x", binding: "mandatory" })
    ).toThrow()
  })

  test("defaultTarget is optional but preserved when set", () => {
    const parsed = SystemDependencySchema.parse({
      system: "shared-auth",
      binding: "required",
      defaultTarget: "workshop-staging",
    })
    expect(parsed.defaultTarget).toBe("workshop-staging")
  })

  test("components filter preserved", () => {
    const parsed = SystemDependencySchema.parse({
      system: "shared-auth",
      components: ["auth-api"],
    })
    expect(parsed.components).toEqual(["auth-api"])
  })

  test("full entry round-trips", () => {
    const input = {
      system: "shared-queues",
      components: ["queue-broker"],
      binding: "required" as const,
      defaultTarget: "workshop-staging",
    }
    expect(SystemDependencySchema.parse(input)).toEqual(input)
  })
})

describe("ComponentDependencySchema (cross-system qualifier)", () => {
  test("same-system ref: no `system` qualifier", () => {
    const parsed = ComponentDependencySchema.parse({ component: "postgres" })
    expect(parsed.component).toBe("postgres")
    expect(parsed.system).toBeUndefined()
    expect(parsed.required).toBe(true)
  })

  test("cross-system ref: `system` present", () => {
    const parsed = ComponentDependencySchema.parse({
      component: "auth-api",
      system: "shared-auth",
      as: "AUTH_SERVICE",
      protocol: "http",
    })
    expect(parsed.system).toBe("shared-auth")
    expect(parsed.as).toBe("AUTH_SERVICE")
  })

  test("optional deps opt out of required", () => {
    const parsed = ComponentDependencySchema.parse({
      component: "notification-api",
      system: "shared-notifications",
      required: false,
    })
    expect(parsed.required).toBe(false)
  })
})
