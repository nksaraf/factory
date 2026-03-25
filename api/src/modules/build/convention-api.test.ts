import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { createTestContext } from "../../test-helpers";

describe("conventions validate API", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("validates branch names with optional conventions payload", async () => {
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/conventions/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "branch",
          value: "feature/BILL-123-test",
          conventions: {
            branches: {
              pattern: "{type}/{ticket}-{slug}",
              types: ["feature", "hotfix"],
              require_ticket: true,
            },
          },
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { valid: boolean };
    };
    expect(json.success).toBe(true);
    expect(json.data.valid).toBe(true);
  });

  it("rejects invalid commits when conventional format required", async () => {
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/conventions/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "commit",
          value: "not conventional",
          conventions: {
            commits: { format: "conventional", require_scope: false },
          },
        }),
      })
    );
    const json = (await res.json()) as {
      data: { valid: boolean };
    };
    expect(json.data.valid).toBe(false);
  });
});
