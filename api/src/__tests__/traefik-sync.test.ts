import { describe, expect, it } from "vitest";
import { generateTraefikYaml, type TraefikRoute } from "../modules/gateway/traefik-sync";

describe("generateTraefikYaml", () => {
  const baseRoute: TraefikRoute = {
    routeId: "rte_abc123",
    kind: "sandbox",
    domain: "my-sandbox.preview.dx.dev",
    pathPrefix: null,
    targetService: "sandbox-svc",
    targetPort: 3000,
    protocol: "http",
    tlsMode: "auto",
    middlewares: [],
    priority: 100,
    status: "active",
  };

  it("generates empty config for no routes", () => {
    const yaml = generateTraefikYaml([]);
    expect(yaml).toContain("routers: {}");
    expect(yaml).toContain("services: {}");
  });

  it("generates router and service for a single route", () => {
    const yaml = generateTraefikYaml([baseRoute]);
    expect(yaml).toContain("rte_abc123:");
    expect(yaml).toContain('rule: "Host(`my-sandbox.preview.dx.dev`)"');
    expect(yaml).toContain("service: rte_abc123");
    expect(yaml).toContain("priority: 100");
    expect(yaml).toContain('url: "http://sandbox-svc:3000"');
    expect(yaml).toContain("tls: {}");
  });

  it("includes path prefix in match rule", () => {
    const r: TraefikRoute = { ...baseRoute, pathPrefix: "/api/v1" };
    const yaml = generateTraefikYaml([r]);
    expect(yaml).toContain('Host(`my-sandbox.preview.dx.dev`) && PathPrefix(`/api/v1`)');
  });

  it("skips tls when tlsMode is none", () => {
    const r: TraefikRoute = { ...baseRoute, tlsMode: "none" };
    const yaml = generateTraefikYaml([r]);
    expect(yaml).not.toContain("tls:");
  });

  it("defaults to port 80 when no targetPort", () => {
    const r: TraefikRoute = { ...baseRoute, targetPort: null };
    const yaml = generateTraefikYaml([r]);
    expect(yaml).toContain('url: "http://sandbox-svc:80"');
  });

  it("generates multiple routes", () => {
    const routes: TraefikRoute[] = [
      { ...baseRoute, routeId: "rte_1", domain: "a.preview.dx.dev" },
      { ...baseRoute, routeId: "rte_2", domain: "b.preview.dx.dev" },
    ];
    const yaml = generateTraefikYaml(routes);
    expect(yaml).toContain("rte_1:");
    expect(yaml).toContain("rte_2:");
    expect(yaml).toContain("a.preview.dx.dev");
    expect(yaml).toContain("b.preview.dx.dev");
  });
});
