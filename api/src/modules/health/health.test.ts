import { describe, expect, it } from "vitest"

import { healthController } from "./index"

describe("health controller", () => {
  it("returns ok status", async () => {
    const app = healthController
    const response = await app.handle(new Request("http://localhost/health"))
    const body = (await response.json()) as { status: string; service: string }
    expect(body.status).toBe("ok")
    expect(body.service).toBe("factory-api")
  })
})
