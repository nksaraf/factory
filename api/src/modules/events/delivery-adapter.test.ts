import { describe, expect, it } from "bun:test"
import {
  getDeliveryAdapter,
  listDeliveryAdapters,
  providerToRenderFormat,
  registerDeliveryAdapter,
} from "./delivery-adapter"
import type { DeliveryAdapter } from "./delivery-adapter"

describe("delivery adapter registry", () => {
  it("registers and retrieves adapters", () => {
    const mock: DeliveryAdapter = {
      provider: "test",
      deliver: async () => ({ ok: true }),
    }
    registerDeliveryAdapter(mock)
    expect(getDeliveryAdapter("test")).toBe(mock)
  })

  it("returns null for unregistered provider", () => {
    expect(getDeliveryAdapter("nonexistent")).toBeNull()
  })

  it("lists registered providers", () => {
    const providers = listDeliveryAdapters()
    expect(providers).toContain("test")
  })
})

describe("providerToRenderFormat", () => {
  it("maps chat providers to slack format", () => {
    expect(providerToRenderFormat("slack")).toBe("slack")
    expect(providerToRenderFormat("teams")).toBe("slack")
    expect(providerToRenderFormat("google-chat")).toBe("slack")
  })

  it("maps email to email format", () => {
    expect(providerToRenderFormat("email")).toBe("email")
  })

  it("maps web and unknown to web format", () => {
    expect(providerToRenderFormat("web")).toBe("web")
    expect(providerToRenderFormat("unknown")).toBe("web")
  })
})
