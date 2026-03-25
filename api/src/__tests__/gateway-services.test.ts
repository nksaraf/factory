import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import * as gw from "../modules/infra/gateway.service";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Gateway Services", () => {
  let db: Database;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  describe("lookupRouteByDomain", () => {
    it("finds an active route by domain", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "happy-fox-42.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "active",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "happy-fox-42.tunnel.dx.dev");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("tunnel");
      expect(found!.domain).toBe("happy-fox-42.tunnel.dx.dev");
    });

    it("returns null for non-existent domain", async () => {
      const found = await gw.lookupRouteByDomain(db, "nope.tunnel.dx.dev");
      expect(found).toBeNull();
    });

    it("returns null for inactive routes", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "stale.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "expired",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "stale.tunnel.dx.dev");
      expect(found).toBeNull();
    });
  });
});
