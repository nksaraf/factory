import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestContext } from "../../test-helpers";

describe("product plane (mounted with health)", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("GET /api/v1/product/modules returns list payload", async () => {
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/product/modules")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(0);
  });
});
