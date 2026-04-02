import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { createTestContext, truncateAllTables } from "../../test-helpers";
import { productModule } from "../../db/schema/product";
import { orgTeam } from "../../db/schema/org";

describe("commerce plane API", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("creates a customer with trial status and cust_ ID prefix", async () => {
    await truncateAllTables(ctx.client);
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme Corp" }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { customerId: string; name: string; slug: string; status: string };
    };
    expect(json.success).toBe(true);
    expect(json.data.customerId).toMatch(/^cust_/);
    expect(json.data.name).toBe("Acme Corp");
    expect(json.data.slug).toBe("acme-corp");
    expect(json.data.status).toBe("trial");
  });

  it("lists and gets customers", async () => {
    await truncateAllTables(ctx.client);

    // Create two customers
    const res1 = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alpha Inc" }),
      })
    );
    const cust1 = (await res1.json()) as {
      data: { customerId: string; name: string };
    };

    const res2 = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Beta LLC" }),
      })
    );
    const cust2 = (await res2.json()) as {
      data: { customerId: string; name: string };
    };

    // List
    const listRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers")
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      success: boolean;
      data: { name: string }[];
      total: number;
    };
    expect(listJson.success).toBe(true);
    expect(listJson.data.length).toBe(2);
    expect(listJson.total).toBe(2);

    // Get by ID
    const getRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/customers/${cust1.data.customerId}`
      )
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      success: boolean;
      data: { customerId: string; name: string };
    };
    expect(getJson.success).toBe(true);
    expect(getJson.data.name).toBe("Alpha Inc");
  });

  it("returns 404 for unknown customer", async () => {
    await truncateAllTables(ctx.client);
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers/cust_nonexistent")
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toBe("not_found");
  });

  it("updates customer status from trial to active", async () => {
    await truncateAllTables(ctx.client);
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Gamma Co" }),
      })
    );
    const created = (await createRes.json()) as {
      data: { customerId: string; status: string };
    };
    expect(created.data.status).toBe("trial");

    const patchRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/customers/${created.data.customerId}/update`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        }
      )
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      success: boolean;
      data: { customerId: string; status: string };
    };
    expect(patched.success).toBe(true);
    expect(patched.data.status).toBe("active");
  });

  it("creates and lists plans with includedModules", async () => {
    await truncateAllTables(ctx.client);
    const createRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Starter Plan",
          includedModules: ["billing", "analytics"],
        }),
      })
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      success: boolean;
      data: {
        planId: string;
        name: string;
        slug: string;
        includedModules: string[];
      };
    };
    expect(created.success).toBe(true);
    expect(created.data.planId).toMatch(/^pln_/);
    expect(created.data.name).toBe("Starter Plan");
    expect(created.data.slug).toBe("starter-plan");
    expect(created.data.includedModules).toEqual(["billing", "analytics"]);

    const listRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/plans")
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      success: boolean;
      data: { planId: string; name: string }[];
      total: number;
    };
    expect(listed.success).toBe(true);
    expect(listed.data.length).toBe(1);
    expect(listed.data[0]!.name).toBe("Starter Plan");
  });

  it("grants, lists, and revokes entitlements", async () => {
    await truncateAllTables(ctx.client);

    // Create a customer
    const custRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Delta Corp" }),
      })
    );
    const cust = (await custRes.json()) as {
      data: { customerId: string };
    };

    // Create a team first (module.team_id FK)
    const [team] = await ctx.db
      .insert(orgTeam)
      .values({ name: "platform", slug: "platform" })
      .returning();

    // Insert a product module directly
    const [mod] = await ctx.db
      .insert(productModule)
      .values({
        name: "notifications",
        slug: "notifications",
        teamId: team!.teamId,
        lifecycleState: "active",
      })
      .returning();

    // Grant entitlement
    const grantRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/entitlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: cust.data.customerId,
          moduleId: mod!.moduleId,
          quotas: { maxUsers: 100 },
        }),
      })
    );
    expect(grantRes.status).toBe(200);
    const granted = (await grantRes.json()) as {
      success: boolean;
      data: {
        entitlementId: string;
        customerId: string;
        moduleId: string;
        status: string;
        quotas: Record<string, number>;
      };
    };
    expect(granted.success).toBe(true);
    expect(granted.data.entitlementId).toMatch(/^ent_/);
    expect(granted.data.customerId).toBe(cust.data.customerId);
    expect(granted.data.moduleId).toBe(mod!.moduleId);
    expect(granted.data.status).toBe("active");
    expect(granted.data.quotas).toEqual({ maxUsers: 100 });

    // List filtered by customerId
    const listRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/entitlements?customerId=${cust.data.customerId}`
      )
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      success: boolean;
      data: { entitlementId: string }[];
      total: number;
    };
    expect(listed.success).toBe(true);
    expect(listed.data.length).toBe(1);
    expect(listed.total).toBe(1);

    // Revoke
    const revokeRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/entitlements/delete?id=${granted.data.entitlementId}`,
        { method: "POST" }
      )
    );
    expect(revokeRes.status).toBe(200);
    const revoked = (await revokeRes.json()) as {
      success: boolean;
      data: { entitlementId: string; status: string };
    };
    expect(revoked.success).toBe(true);
    expect(revoked.data.status).toBe("revoked");
  });

  it("returns usage summary with active and total counts", async () => {
    await truncateAllTables(ctx.client);

    // Create a customer
    const custRes = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Echo Ltd" }),
      })
    );
    const cust = (await custRes.json()) as {
      data: { customerId: string };
    };

    // Create a team first (module.team_id FK)
    const [team] = await ctx.db
      .insert(orgTeam)
      .values({ name: "platform", slug: "platform" })
      .returning();

    // Insert two product modules
    const [mod1] = await ctx.db
      .insert(productModule)
      .values({
        name: "payments",
        slug: "payments",
        teamId: team!.teamId,
        lifecycleState: "active",
      })
      .returning();
    const [mod2] = await ctx.db
      .insert(productModule)
      .values({
        name: "reporting",
        slug: "reporting",
        teamId: team!.teamId,
        lifecycleState: "active",
      })
      .returning();

    // Grant two entitlements
    await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/entitlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: cust.data.customerId,
          moduleId: mod1!.moduleId,
        }),
      })
    );
    const ent2Res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/commerce/entitlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: cust.data.customerId,
          moduleId: mod2!.moduleId,
        }),
      })
    );
    const ent2 = (await ent2Res.json()) as {
      data: { entitlementId: string };
    };

    // Revoke one entitlement
    await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/entitlements/delete?id=${ent2.data.entitlementId}`,
        { method: "POST" }
      )
    );

    // Check usage summary
    const usageRes = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/commerce/usage?customerId=${cust.data.customerId}`
      )
    );
    expect(usageRes.status).toBe(200);
    const usage = (await usageRes.json()) as {
      success: boolean;
      data: {
        customerId: string;
        activeEntitlements: number;
        totalEntitlements: number;
      }[];
    };
    expect(usage.success).toBe(true);
    expect(usage.data.length).toBe(1);
    expect(usage.data[0]!.customerId).toBe(cust.data.customerId);
    expect(usage.data[0]!.activeEntitlements).toBe(1);
    expect(usage.data[0]!.totalEntitlements).toBe(2);
  });
});
