import { describe, test, expect } from "vitest";
import {
  NetworkLinkTypeSchema,
  NetworkLinkEndpointKindSchema,
  NetworkLinkSpecSchema,
  NetworkLinkSchema,
  CreateNetworkLinkSchema,
} from "@smp/factory-shared/schemas/infra";
import { traceFrom, validateEndpointsWithReader, type GraphReader } from "../modules/infra/trace";

describe("networkLink schemas", () => {
  test("NetworkLinkTypeSchema accepts valid types", () => {
    for (const t of ["proxy", "direct", "tunnel", "nat", "firewall", "mesh", "peering"]) {
      expect(NetworkLinkTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  test("NetworkLinkEndpointKindSchema accepts substrate/host/runtime", () => {
    for (const k of ["substrate", "host", "runtime"]) {
      expect(NetworkLinkEndpointKindSchema.safeParse(k).success).toBe(true);
    }
  });

  test("NetworkLinkSpecSchema validates a proxy link spec", () => {
    const result = NetworkLinkSpecSchema.safeParse({
      ingressPort: 443,
      egressPort: 9090,
      ingressProtocol: "https",
      egressProtocol: "http",
      tls: { termination: "edge", certResolver: "letsencrypt" },
      match: { hosts: ["*.tunnel.dx.dev", "*.preview.dx.dev"] },
    });
    expect(result.success).toBe(true);
  });

  test("NetworkLinkSpecSchema defaults work for minimal spec", () => {
    const result = NetworkLinkSpecSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.priority).toBe(0);
    expect(result.middlewares).toEqual([]);
  });

  test("NetworkLinkSchema validates full entity with reconciliation", () => {
    const result = NetworkLinkSchema.safeParse({
      id: "nlnk_test",
      slug: "traefik-to-gw",
      name: "Traefik → Factory Gateway",
      type: "proxy",
      sourceKind: "runtime",
      sourceId: "rt_traefik",
      targetKind: "runtime",
      targetId: "rt_gateway",
      spec: {},
      status: {},
      generation: 0,
      observedGeneration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  test("CreateNetworkLinkSchema validates input", () => {
    const result = CreateNetworkLinkSchema.safeParse({
      slug: "traefik-to-gw",
      name: "Traefik → Factory Gateway",
      type: "proxy",
      sourceKind: "runtime",
      sourceId: "rt_traefik",
      targetKind: "runtime",
      targetId: "rt_gateway",
      spec: {
        ingressPort: 443,
        egressPort: 9090,
        ingressProtocol: "https",
        egressProtocol: "http",
        tls: { termination: "edge" },
        match: { hosts: ["*.tunnel.dx.dev"] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("CreateNetworkLinkSchema rejects invalid type", () => {
    const result = CreateNetworkLinkSchema.safeParse({
      slug: "bad", name: "Bad", type: "invalid",
      sourceKind: "runtime", sourceId: "x",
      targetKind: "runtime", targetId: "y",
    });
    expect(result.success).toBe(false);
  });

  test("CreateNetworkLinkSchema rejects invalid endpoint kind", () => {
    const result = CreateNetworkLinkSchema.safeParse({
      slug: "bad", name: "Bad", type: "proxy",
      sourceKind: "invalid", sourceId: "x",
      targetKind: "runtime", targetId: "y",
    });
    expect(result.success).toBe(false);
  });
});

// ── Graph trace tests ────────────────────────────────────────

describe("traceFrom", () => {
  test("walks a linear chain A → B → C", async () => {
    const reader: GraphReader = {
      findLinks: async (_kind, id, direction) => {
        if (direction === "outbound") {
          if (id === "rt_a") return [{ id: "nlnk_1", slug: "a-to-b", name: "A→B", type: "proxy", sourceKind: "runtime", sourceId: "rt_a", targetKind: "runtime", targetId: "rt_b", spec: { ingressPort: 443, egressPort: 9090, ingressProtocol: "https", egressProtocol: "http", tls: { termination: "edge" } } }];
          if (id === "rt_b") return [{ id: "nlnk_2", slug: "b-to-c", name: "B→C", type: "proxy", sourceKind: "runtime", sourceId: "rt_b", targetKind: "runtime", targetId: "rt_c", spec: { ingressPort: 9090, egressPort: 8080, ingressProtocol: "http", egressProtocol: "http" } }];
        }
        return [];
      },
      findEntity: async (_kind, id) => {
        const entities: Record<string, any> = {
          "rt_a": { id: "rt_a", slug: "traefik", name: "Traefik", type: "reverse-proxy" },
          "rt_b": { id: "rt_b", slug: "factory-gw", name: "Factory Gateway", type: "reverse-proxy" },
          "rt_c": { id: "rt_c", slug: "prod-ns", name: "Production NS", type: "k8s-namespace" },
        };
        return entities[id] ?? null;
      },
    };

    const result = await traceFrom(reader, "runtime", "rt_a", "outbound");
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0].link.slug).toBe("a-to-b");
    expect(result.hops[0].entity.slug).toBe("factory-gw");
    expect(result.hops[1].link.slug).toBe("b-to-c");
    expect(result.hops[1].entity.slug).toBe("prod-ns");
    expect(result.origin.slug).toBe("traefik");
  });

  test("detects cycles and stops", async () => {
    const reader: GraphReader = {
      findLinks: async (_kind, id) => {
        if (id === "rt_a") return [{ id: "nlnk_1", slug: "a-to-b", name: "A→B", type: "proxy", sourceKind: "runtime", sourceId: "rt_a", targetKind: "runtime", targetId: "rt_b", spec: {} }];
        if (id === "rt_b") return [{ id: "nlnk_2", slug: "b-to-a", name: "B→A", type: "proxy", sourceKind: "runtime", sourceId: "rt_b", targetKind: "runtime", targetId: "rt_a", spec: {} }];
        return [];
      },
      findEntity: async (_kind, id) => {
        const entities: Record<string, any> = {
          "rt_a": { id: "rt_a", slug: "a", name: "A", type: "reverse-proxy" },
          "rt_b": { id: "rt_b", slug: "b", name: "B", type: "reverse-proxy" },
        };
        return entities[id] ?? null;
      },
    };

    const result = await traceFrom(reader, "runtime", "rt_a", "outbound");
    expect(result.hops).toHaveLength(1); // stops at B, won't loop back to A
  });

  test("inbound trace walks backwards", async () => {
    const reader: GraphReader = {
      findLinks: async (_kind, id, direction) => {
        if (direction === "inbound" && id === "rt_c") return [{ id: "nlnk_2", slug: "b-to-c", name: "B→C", type: "proxy", sourceKind: "runtime", sourceId: "rt_b", targetKind: "runtime", targetId: "rt_c", spec: {} }];
        if (direction === "inbound" && id === "rt_b") return [{ id: "nlnk_1", slug: "a-to-b", name: "A→B", type: "proxy", sourceKind: "runtime", sourceId: "rt_a", targetKind: "runtime", targetId: "rt_b", spec: {} }];
        return [];
      },
      findEntity: async (_kind, id) => {
        const entities: Record<string, any> = {
          "rt_a": { id: "rt_a", slug: "traefik", name: "Traefik", type: "reverse-proxy" },
          "rt_b": { id: "rt_b", slug: "factory-gw", name: "Factory GW", type: "reverse-proxy" },
          "rt_c": { id: "rt_c", slug: "prod-ns", name: "Prod NS", type: "k8s-namespace" },
        };
        return entities[id] ?? null;
      },
    };

    const result = await traceFrom(reader, "runtime", "rt_c", "inbound");
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0].entity.slug).toBe("factory-gw");
    expect(result.hops[1].entity.slug).toBe("traefik");
  });

  test("throws NotFoundError when starting entity does not exist", async () => {
    const reader: GraphReader = {
      findLinks: async () => [],
      findEntity: async () => null,
    };
    await expect(
      traceFrom(reader, "runtime", "rt_missing", "outbound"),
    ).rejects.toThrow("Entity not found: runtime/rt_missing");
  });

  test("empty graph returns no hops", async () => {
    const reader: GraphReader = {
      findLinks: async () => [],
      findEntity: async () => ({ id: "rt_x", slug: "lonely", name: "Lonely", type: "systemd" }),
    };
    const result = await traceFrom(reader, "runtime", "rt_x", "outbound");
    expect(result.hops).toHaveLength(0);
    expect(result.origin.slug).toBe("lonely");
  });
});

// ── Validation tests ─────────────────────────────────────────

describe("validateEndpointsWithReader", () => {
  const existingReader: GraphReader = {
    findLinks: async () => [],
    findEntity: async (_kind, id) => {
      const entities: Record<string, any> = {
        "rt_a": { id: "rt_a", slug: "a", name: "A", type: "reverse-proxy" },
        "rt_b": { id: "rt_b", slug: "b", name: "B", type: "reverse-proxy" },
      };
      return entities[id] ?? null;
    },
  };

  test("passes when both source and target exist", async () => {
    await expect(
      validateEndpointsWithReader(existingReader, {
        sourceKind: "runtime", sourceId: "rt_a",
        targetKind: "runtime", targetId: "rt_b",
      }),
    ).resolves.toBeUndefined();
  });

  test("throws NotFoundError when source does not exist", async () => {
    await expect(
      validateEndpointsWithReader(existingReader, {
        sourceKind: "runtime", sourceId: "rt_missing",
        targetKind: "runtime", targetId: "rt_b",
      }),
    ).rejects.toThrow("Source entity not found");
  });

  test("throws NotFoundError when target does not exist", async () => {
    await expect(
      validateEndpointsWithReader(existingReader, {
        sourceKind: "runtime", sourceId: "rt_a",
        targetKind: "runtime", targetId: "rt_missing",
      }),
    ).rejects.toThrow("Target entity not found");
  });

  test("skips validation when kind/id not provided", async () => {
    await expect(
      validateEndpointsWithReader(existingReader, {}),
    ).resolves.toBeUndefined();
  });
});
