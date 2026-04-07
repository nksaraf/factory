/**
 * Route target resolver.
 *
 * Walks the entity graph to turn abstract route targets
 * (`{tenantSlug, systemDeploymentSlug, port}`) into concrete
 * `{address, port}` pairs. Runtime-type-aware:
 *   k8s-namespace → deterministic service DNS
 *   systemd       → host IP
 *   others        → error (deferred)
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { systemDeployment, componentDeployment, tenant } from "../../db/schema/ops";
import { component } from "../../db/schema/software-v2";
import { runtime, host } from "../../db/schema/infra-v2";
import type { RouteTarget, RouteStatus } from "@smp/factory-shared/schemas/infra";

// ── DbReader interface (testable abstraction) ──────────────

export interface SystemDeploymentRow {
  id: string;
  slug: string;
  tenantSlug: string;
  runtimeId: string | null;
  spec: Record<string, unknown>;
}

export interface ComponentDeploymentRow {
  systemDeploymentId: string;
  componentId: string;
}

export interface ComponentRow {
  id: string;
  slug: string;
  spec: { ports?: Array<{ name: string; port: number; protocol?: string }> } & Record<string, unknown>;
}

export interface RuntimeRow {
  id: string;
  type: string;
  hostId: string | null;
  slug: string;
}

export interface HostRow {
  id: string;
  spec: { ipAddress?: string } & Record<string, unknown>;
}

export interface DbReader {
  findSystemDeployments(slugs: string[], tenantSlugs: string[]): Promise<SystemDeploymentRow[]>;
  findComponentDeployments(systemDeploymentIds: string[]): Promise<ComponentDeploymentRow[]>;
  findComponents(componentIds: string[]): Promise<ComponentRow[]>;
  findRuntimes(runtimeIds: string[]): Promise<RuntimeRow[]>;
  findHosts(hostIds: string[]): Promise<HostRow[]>;
}

// ── Resolver ───────────────────────────────────────────────

export async function resolveRouteTargets(
  targets: RouteTarget[],
  reader: DbReader,
): Promise<RouteStatus> {
  if (targets.length === 0) {
    return { resolvedTargets: [], phase: "resolved", resolvedAt: new Date() };
  }

  // 1. Collect unique slug pairs
  const sdSlugs = [...new Set(targets.map((t) => t.systemDeploymentSlug))];
  const tenantSlugs = [...new Set(targets.map((t) => t.tenantSlug))];

  // 2. Batch-load system deployments
  const sds = await reader.findSystemDeployments(sdSlugs, tenantSlugs);
  const sdByKey = new Map(sds.map((sd) => [`${sd.tenantSlug}:${sd.slug}`, sd]));

  // Check for missing system deployments
  const missing: string[] = [];
  for (const t of targets) {
    if (!sdByKey.has(`${t.tenantSlug}:${t.systemDeploymentSlug}`)) {
      missing.push(`${t.tenantSlug}/${t.systemDeploymentSlug}`);
    }
  }
  if (missing.length > 0) {
    return {
      resolvedTargets: [],
      phase: "error",
      resolutionError: `System deployment(s) not found: ${missing.join(", ")}`,
      resolvedAt: new Date(),
    };
  }

  // 3. Batch-load component deployments
  const sdIds = [...new Set(sds.map((sd) => sd.id))];
  const cds = await reader.findComponentDeployments(sdIds);

  // 4. Batch-load components (for port matching + slug)
  const componentIds = [...new Set(cds.map((cd) => cd.componentId))];
  const components = componentIds.length > 0
    ? await reader.findComponents(componentIds)
    : [];
  const componentById = new Map(components.map((c) => [c.id, c]));

  // 5. Batch-load runtimes
  const runtimeIds = [...new Set(sds.filter((sd) => sd.runtimeId).map((sd) => sd.runtimeId!))];
  const runtimes = runtimeIds.length > 0
    ? await reader.findRuntimes(runtimeIds)
    : [];
  const runtimeById = new Map(runtimes.map((r) => [r.id, r]));

  // 6. Batch-load hosts (only needed for systemd/bare-metal)
  const hostIds = [...new Set(runtimes.filter((r) => r.hostId).map((r) => r.hostId!))];
  const hosts = hostIds.length > 0
    ? await reader.findHosts(hostIds)
    : [];
  const hostById = new Map(hosts.map((h) => [h.id, h]));

  // 7. Resolve each target
  const resolvedTargets: RouteStatus["resolvedTargets"] = [];
  const errors: string[] = [];

  for (const target of targets) {
    const sd = sdByKey.get(`${target.tenantSlug}:${target.systemDeploymentSlug}`)!;

    if (!sd.runtimeId) {
      errors.push(`${target.systemDeploymentSlug}: no runtime assigned`);
      continue;
    }

    const rt = runtimeById.get(sd.runtimeId);
    if (!rt) {
      errors.push(`${target.systemDeploymentSlug}: runtime ${sd.runtimeId} not found`);
      continue;
    }

    // Find the component matching this port
    const sdCds = cds.filter((cd) => cd.systemDeploymentId === sd.id);
    let matchedComponent: ComponentRow | undefined;

    for (const cd of sdCds) {
      const comp = componentById.get(cd.componentId);
      if (comp?.spec.ports?.some((p) => p.port === target.port)) {
        matchedComponent = comp;
        break;
      }
    }

    const componentSlug = matchedComponent?.slug ?? "unknown";

    // Runtime-type dispatch
    switch (rt.type) {
      case "k8s-namespace": {
        const namespace = (sd.spec as Record<string, unknown>).namespace as string | undefined;
        if (!namespace) {
          errors.push(`${target.systemDeploymentSlug}: k8s-namespace runtime but no namespace in spec`);
          continue;
        }
        resolvedTargets.push({
          systemDeploymentSlug: target.systemDeploymentSlug,
          componentSlug,
          address: `${componentSlug}.${namespace}.svc.cluster.local`,
          port: target.port,
          weight: target.weight,
          runtimeType: rt.type,
          geo: target.geo,
        });
        break;
      }

      case "systemd":
      case "bare-metal": {
        if (!rt.hostId) {
          errors.push(`${target.systemDeploymentSlug}: ${rt.type} runtime has no host`);
          continue;
        }
        const h = hostById.get(rt.hostId);
        if (!h?.spec.ipAddress) {
          errors.push(`${target.systemDeploymentSlug}: host ${rt.hostId} has no IP address`);
          continue;
        }
        resolvedTargets.push({
          systemDeploymentSlug: target.systemDeploymentSlug,
          componentSlug,
          address: h.spec.ipAddress,
          port: target.port,
          weight: target.weight,
          runtimeType: rt.type,
          geo: target.geo,
        });
        break;
      }

      case "compose-project": {
        errors.push(`${target.systemDeploymentSlug}: compose-project port mapping not yet supported`);
        continue;
      }

      case "reverse-proxy":
      case "k8s-cluster":
      case "docker-engine": {
        errors.push(`${target.systemDeploymentSlug}: runtime type '${rt.type}' cannot host workloads directly`);
        continue;
      }

      default: {
        errors.push(`${target.systemDeploymentSlug}: unknown runtime type '${rt.type}'`);
        continue;
      }
    }
  }

  if (errors.length > 0 && resolvedTargets.length === 0) {
    return {
      resolvedTargets: [],
      phase: "error",
      resolutionError: errors.join("; "),
      resolvedAt: new Date(),
    };
  }

  return {
    resolvedTargets,
    phase: errors.length > 0 ? "error" : "resolved",
    resolutionError: errors.length > 0 ? errors.join("; ") : undefined,
    resolvedAt: new Date(),
  };
}

// ── Drizzle DbReader ───────────────────────────────────────

export function drizzleDbReader(db: Database): DbReader {
  return {
    async findSystemDeployments(slugs, tenantSlugs) {
      if (slugs.length === 0) return [];

      // Join system_deployment → tenant to get tenantSlug
      const rows = await db
        .select({
          id: systemDeployment.id,
          slug: systemDeployment.slug,
          tenantSlug: tenant.slug,
          runtimeId: systemDeployment.runtimeId,
          spec: systemDeployment.spec,
        })
        .from(systemDeployment)
        .innerJoin(tenant, eq(systemDeployment.tenantId, tenant.id))
        .where(
          and(
            inArray(systemDeployment.slug, slugs),
            inArray(tenant.slug, tenantSlugs),
          ),
        );

      return rows as SystemDeploymentRow[];
    },

    async findComponentDeployments(systemDeploymentIds) {
      if (systemDeploymentIds.length === 0) return [];

      const rows = await db
        .select({
          systemDeploymentId: componentDeployment.systemDeploymentId,
          componentId: componentDeployment.componentId,
        })
        .from(componentDeployment)
        .where(inArray(componentDeployment.systemDeploymentId, systemDeploymentIds));

      return rows;
    },

    async findComponents(componentIds) {
      if (componentIds.length === 0) return [];

      const rows = await db
        .select({
          id: component.id,
          slug: component.slug,
          spec: component.spec,
        })
        .from(component)
        .where(inArray(component.id, componentIds));

      return rows as ComponentRow[];
    },

    async findRuntimes(runtimeIds) {
      if (runtimeIds.length === 0) return [];

      const rows = await db
        .select({
          id: runtime.id,
          type: runtime.type,
          hostId: runtime.hostId,
          slug: runtime.slug,
        })
        .from(runtime)
        .where(inArray(runtime.id, runtimeIds));

      return rows;
    },

    async findHosts(hostIds) {
      if (hostIds.length === 0) return [];

      const rows = await db
        .select({
          id: host.id,
          spec: host.spec,
        })
        .from(host)
        .where(inArray(host.id, hostIds));

      return rows as HostRow[];
    },
  };
}
