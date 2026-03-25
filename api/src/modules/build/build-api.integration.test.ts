import { and, eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { createTestContext, truncateAllTables } from "../../test-helpers";
import { componentSpec, productModule } from "../../db/schema/product";
import { allocateSlug } from "../../lib/slug";

describe("build plane API", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.client.close();
  });

  it("creates and lists repos", async () => {
    await truncateAllTables(ctx.client);
    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "billing-git",
          kind: "product-module",
          teamId: "team-1",
          gitUrl: "https://example.com/billing.git",
          defaultBranch: "main",
        }),
      })
    );
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      success: boolean;
      data: { repoId: string; name: string; slug: string };
    };
    expect(created.success).toBe(true);
    expect(created.data.name).toBe("billing-git");
    expect(created.data.slug).toBe("billing-git");

    const list = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/repos")
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { name: string }[] };
    expect(body.data.some((r) => r.name === "billing-git")).toBe(true);

    const one = await ctx.app.handle(
      new Request(
        `http://localhost/api/v1/factory/build/repos/${created.data.repoId}`
      )
    );
    expect(one.status).toBe(200);
  });

  it("registers module versions when product module exists", async () => {
    await truncateAllTables(ctx.client);
    await ctx.db.insert(productModule).values({
      name: "billing",
      slug: "billing",
      team: "platform",
      lifecycleState: "active",
    });

    const res = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/modules/billing/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1.0.0" }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { version: string };
    };
    expect(json.data.version).toBe("1.0.0");

    const list = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/modules/billing/versions")
    );
    const listed = (await list.json()) as { data: { version: string }[] };
    expect(listed.data[0]?.version).toBe("1.0.0");
  });

  it("creates artifacts and links component artifacts", async () => {
    await truncateAllTables(ctx.client);
    const [mod] = await ctx.db
      .insert(productModule)
      .values({
        name: "billing",
        slug: "billing",
        team: "platform",
        lifecycleState: "active",
      })
      .returning();

    const [cmp] = await ctx.db
      .insert(componentSpec)
      .values({
        moduleId: mod!.moduleId,
        name: "api",
        slug: "api",
        kind: "server",
      })
      .returning();

    const ver = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/modules/billing/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1.0.0" }),
      })
    );
    const verJson = (await ver.json()) as {
      data: { moduleVersionId: string };
    };

    const art = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageRef: "registry.example/billing-api:1.0.0",
          imageDigest: "sha256:abc",
        }),
      })
    );
    expect(art.status).toBe(200);
    const artJson = (await art.json()) as {
      data: { artifactId: string };
    };

    const link = await ctx.app.handle(
      new Request("http://localhost/api/v1/factory/build/component-artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          moduleVersionId: verJson.data.moduleVersionId,
          componentId: cmp!.componentId,
          artifactId: artJson.data.artifactId,
        }),
      })
    );
    expect(link.status).toBe(200);
  });

  it("allocates scoped slugs per module when labels slugify the same", async () => {
    await truncateAllTables(ctx.client);
    const [mod] = await ctx.db
      .insert(productModule)
      .values({
        name: "svc",
        slug: "svc",
        team: "platform",
        lifecycleState: "active",
      })
      .returning();

    const moduleId = mod!.moduleId;
    const isTaken = async (slug: string) => {
      const [r] = await ctx.db
        .select()
        .from(componentSpec)
        .where(
          and(eq(componentSpec.moduleId, moduleId), eq(componentSpec.slug, slug))
        )
        .limit(1);
      return r != null;
    };

    const slugA = await allocateSlug({ baseLabel: "Foo", isTaken });
    await ctx.db.insert(componentSpec).values({
      moduleId,
      name: "Foo",
      slug: slugA,
      kind: "server",
    });

    const slugB = await allocateSlug({ baseLabel: "FOO", isTaken });
    expect(slugB).toBe("foo-2");
    await ctx.db.insert(componentSpec).values({
      moduleId,
      name: "FOO",
      slug: slugB,
      kind: "server",
    });
  });
});
