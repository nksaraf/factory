import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Database } from "../../db/connection";
import { listRoutes } from "./gateway.service";

/**
 * Generates Traefik file-provider YAML from factory-hosted routes
 * (routes where siteId is null — tunnels, factory sandboxes, preview envs).
 *
 * Traefik watches the output directory and picks up changes automatically.
 */

/**
 * Only these route kinds get per-route Traefik config.
 * High-cardinality kinds (tunnel, preview, sandbox) are routed
 * through the factory gateway via static wildcard Traefik routers.
 */
export const KINDS_WITH_TRAEFIK_ROUTES = ["ingress", "custom_domain"] as const;

export interface TraefikRoute {
  routeId: string;
  kind: string;
  domain: string;
  pathPrefix?: string | null;
  targetService: string;
  targetPort?: number | null;
  protocol: string;
  tlsMode: string;
  middlewares: unknown[];
  priority: number;
  status: string;
}

function routerName(r: TraefikRoute): string {
  return r.routeId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildMatchRule(r: TraefikRoute): string {
  let rule = `Host(\`${r.domain}\`)`;
  if (r.pathPrefix && r.pathPrefix !== "/") {
    rule += ` && PathPrefix(\`${r.pathPrefix}\`)`;
  }
  return rule;
}

function buildServiceUrl(r: TraefikRoute): string {
  const port = r.targetPort ?? 80;
  return `http://${r.targetService}:${port}`;
}

export function generateTraefikYaml(routes: TraefikRoute[]): string {
  if (routes.length === 0) {
    return "# No active factory routes\nhttp:\n  routers: {}\n  services: {}\n";
  }

  const routers: Record<string, { rule: string; service: string; priority: number; entryPoints: string[]; tls?: Record<string, never> }> = {};
  const services: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }> = {};

  for (const r of routes) {
    const name = routerName(r);

    routers[name] = {
      rule: buildMatchRule(r),
      service: name,
      priority: r.priority,
      entryPoints: ["websecure"],
      ...(r.tlsMode !== "none" ? { tls: {} } : {}),
    };

    services[name] = {
      loadBalancer: {
        servers: [{ url: buildServiceUrl(r) }],
      },
    };
  }

  // Build YAML manually to avoid adding a yaml dependency
  const lines: string[] = ["http:", "  routers:"];
  for (const [name, c] of Object.entries(routers)) {
    lines.push(`    ${name}:`);
    lines.push(`      rule: "${c.rule}"`);
    lines.push(`      service: ${c.service}`);
    lines.push(`      priority: ${c.priority}`);
    lines.push(`      entryPoints:`);
    lines.push(`        - websecure`);
    if (c.tls) {
      lines.push(`      tls: {}`);
    }
  }

  lines.push("  services:");
  for (const [name, c] of Object.entries(services)) {
    lines.push(`    ${name}:`);
    lines.push(`      loadBalancer:`);
    lines.push(`        servers:`);
    for (const s of c.loadBalancer.servers) {
      lines.push(`          - url: "${s.url}"`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Atomically write content to a file (write temp → rename).
 * This prevents Traefik from reading a partially-written file.
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  fs.writeFileSync(tmpFile, content, "utf-8");
  fs.renameSync(tmpFile, filePath);
}

/**
 * Sync factory-hosted routes to a Traefik file-provider directory.
 *
 * Fetches all active routes without a siteId (factory-level routes)
 * and writes them as Traefik dynamic config YAML.
 */
export async function syncFactoryRoutes(
  db: Database,
  outputDir: string
): Promise<{ routeCount: number }> {
  // Get active factory-hosted routes (no siteId)
  const { data: allRoutes } = await listRoutes(db, { status: "active" });
  const factoryRoutes = allRoutes.filter(
    (r) => !r.siteId
  ) as TraefikRoute[];

  // Group by kind for separate files
  const byKind = new Map<string, TraefikRoute[]>();
  for (const r of factoryRoutes) {
    const group = byKind.get(r.kind) ?? [];
    group.push(r);
    byKind.set(r.kind, group);
  }

  // Write a file per kind (sandbox-routes.yml, tunnel-routes.yml, etc.)
  const kinds = [...KINDS_WITH_TRAEFIK_ROUTES];
  for (const kind of kinds) {
    const routes = byKind.get(kind) ?? [];
    const yaml = generateTraefikYaml(routes);
    const filePath = path.join(outputDir, `${kind}-routes.yml`);
    atomicWrite(filePath, yaml);
  }

  return { routeCount: factoryRoutes.length };
}
