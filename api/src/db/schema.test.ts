import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { createTestContext, truncateAllTables } from "../test-helpers";

describe("factory drizzle schemas", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("exposes expected factory_* schemas and core tables", async () => {
    const res = await ctx.client.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema LIKE 'factory_%'
       ORDER BY table_schema, table_name`
    );
    const keys = res.rows.map((r) => `${r.table_schema}.${r.table_name}`);
    expect(keys).toContain("factory_product.module");
    expect(keys).toContain("factory_build.repo");
    expect(keys).toContain("factory_agent.agent");
    expect(keys).toContain("factory_commerce.entitlement");
    expect(keys).toContain("factory_fleet.deployment_target");
    expect(keys).toContain("factory_infra.cluster");
    expect(keys).toContain("factory_infra.region");
    expect(keys).toContain("factory_infra.datacenter");
    expect(keys).toContain("factory_infra.host");
    expect(keys).toContain("factory_infra.proxmox_cluster");
    expect(keys).toContain("factory_infra.kube_node");
    expect(keys).toContain("factory_infra.subnet");
    expect(keys).toContain("factory_infra.ip_address");
  });

  it("truncateAllTables clears data", async () => {
    await truncateAllTables(ctx.client);
    const mod = await ctx.client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM factory_product.module`
    );
    expect(mod.rows[0]?.c).toBe(0);
  });
});
