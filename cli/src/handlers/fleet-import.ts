/**
 * Fleet import — persist discovered compose stacks as Factory entities.
 *
 * Creates entities in order: infra (host, runtime) → software (system, component)
 * → ops (site, system_deployment, component_deployment).
 */

import type { CatalogSystem } from "@smp/factory-shared/catalog";
import { getFactoryRestClient } from "../client.js";
import type { FactoryClient } from "../lib/api-client.js";
import type { DiscoveredStack, DiscoveryResult } from "./fleet-discover.js";

// ─── Types ────────────────────────────────────────────────────

export interface ImportPlan {
  host: HostPlan;
  dockerRuntime: RuntimePlan;
  stacks: StackPlan[];
}

export interface HostPlan {
  slug: string;
  name: string;
  type: "bare-metal" | "vm";
  ip: string;
  user: string;
  action: "create" | "exists";
}

export interface RuntimePlan {
  slug: string;
  name: string;
  type: "docker-engine" | "compose-project";
  action: "create" | "exists";
}

export interface StackPlan {
  project: string;
  site: SitePlan;
  system: SystemPlan;
  composeRuntime: RuntimePlan;
  components: ComponentPlan[];
  deployment: DeploymentPlan;
}

export interface SitePlan {
  slug: string;
  name: string;
  type: string;
  env: string;
  action: "create" | "exists";
}

export interface SystemPlan {
  slug: string;
  name: string;
  action: "create" | "exists";
}

export interface ComponentPlan {
  slug: string;
  name: string;
  type: string;
  action: "create" | "exists";
}

export interface DeploymentPlan {
  slug: string;
  name: string;
  type: string;
  action: "create" | "exists";
}

export interface ImportResult {
  created: { entity: string; slug: string }[];
  updated: { entity: string; slug: string }[];
  errors: { entity: string; slug: string; error: string }[];
}

// ─── Plan building ────────────────────────────────────────────

/**
 * Build an import plan from discovery results (does not write anything).
 */
export async function buildImportPlan(
  result: DiscoveryResult,
  opts: { siteName?: string },
): Promise<ImportPlan> {
  const hostSlug = result.host;
  const rest = await getFactoryRestClient();

  const dockerSlug = `${hostSlug}--docker`;
  const [hostExists, dockerExists] = await Promise.all([
    entityExists(rest, "infra", "hosts", hostSlug),
    entityExists(rest, "infra", "runtimes", dockerSlug),
  ]);

  // Pre-compute slugs for all stacks, then batch all existence checks
  const parseable = result.stacks.filter((s) => !(s.error && !s.catalog));
  const stackMeta = parseable.map((stack) => {
    const projectName = stack.project.name;
    const systemSlug = inferSystemSlug(stack);
    return {
      stack,
      projectName,
      systemSlug,
      siteSlug: projectName,
      composeSlug: `${hostSlug}--${projectName}`,
      deploymentSlug: `${projectName}--${hostSlug}`,
    };
  });

  // Fire all existence checks in parallel
  const existsChecks = await Promise.all(
    stackMeta.map(async (m) => {
      const [sys, site, compose, dep] = await Promise.all([
        entityExists(rest, "product", "systems", m.systemSlug),
        entityExists(rest, "fleet", "sites", m.siteSlug),
        entityExists(rest, "infra", "runtimes", m.composeSlug),
        entityExists(rest, "fleet", "system-deployments", m.deploymentSlug),
      ]);
      return { systemExists: sys, siteExists: site, composeExists: compose, deploymentExists: dep };
    }),
  );

  // Build component plans in parallel too
  const componentPlans = await Promise.all(
    stackMeta.map((m) => buildComponentPlans(m.stack, m.systemSlug, rest)),
  );

  const stacks: StackPlan[] = stackMeta.map((m, i) => {
    const ex = existsChecks[i];
    return {
      project: m.projectName,
      site: {
        slug: m.siteSlug,
        name: opts.siteName ? `${opts.siteName} / ${m.projectName}` : m.projectName,
        type: inferSiteType(m.stack),
        env: inferEnvironment(m.projectName),
        action: ex.siteExists ? "exists" : "create",
      },
      system: {
        slug: m.systemSlug,
        name: m.systemSlug,
        action: ex.systemExists ? "exists" : "create",
      },
      composeRuntime: {
        slug: m.composeSlug,
        name: `${m.projectName} on ${hostSlug}`,
        type: "compose-project",
        action: ex.composeExists ? "exists" : "create",
      },
      components: componentPlans[i],
      deployment: {
        slug: m.deploymentSlug,
        name: `${m.projectName} on ${hostSlug}`,
        type: inferEnvironment(m.projectName) === "development" ? "dev" : "production",
        action: ex.deploymentExists ? "exists" : "create",
      },
    };
  });

  return {
    host: {
      slug: hostSlug,
      name: hostSlug,
      type: "bare-metal",
      ip: result.target.host,
      user: result.target.user,
      action: hostExists ? "exists" : "create",
    },
    dockerRuntime: {
      slug: dockerSlug,
      name: `Docker on ${hostSlug}`,
      type: "docker-engine",
      action: dockerExists ? "exists" : "create",
    },
    stacks,
  };
}

// ─── Execution ────────────────────────────────────────────────

/**
 * Execute an import plan — create all entities in Factory.
 */
export async function executeImportPlan(
  plan: ImportPlan,
): Promise<ImportResult> {
  const rest = await getFactoryRestClient();
  const result: ImportResult = { created: [], updated: [], errors: [] };

  // 1. Host
  if (plan.host.action === "create") {
    await upsert(rest, result, "infra", "hosts", plan.host.slug, {
      slug: plan.host.slug,
      name: plan.host.name,
      type: plan.host.type,
      spec: {
        hostname: plan.host.ip,
        ipAddress: plan.host.ip,
        accessUser: plan.host.user,
        accessMethod: "ssh",
        os: "linux",
        lifecycle: "active",
      },
    });
  }

  // Resolve host ID
  const hostId = await resolveId(rest, "infra", "hosts", plan.host.slug);

  // 2. Docker engine runtime
  if (plan.dockerRuntime.action === "create") {
    await upsert(rest, result, "infra", "runtimes", plan.dockerRuntime.slug, {
      slug: plan.dockerRuntime.slug,
      name: plan.dockerRuntime.name,
      type: "docker-engine",
      hostId,
      spec: { status: "ready" },
    });
  }

  const dockerRuntimeId = await resolveId(rest, "infra", "runtimes", plan.dockerRuntime.slug);

  // 3. Per-stack entities
  for (const stack of plan.stacks) {
    // 3a. Compose-project runtime
    if (stack.composeRuntime.action === "create") {
      await upsert(rest, result, "infra", "runtimes", stack.composeRuntime.slug, {
        slug: stack.composeRuntime.slug,
        name: stack.composeRuntime.name,
        type: "compose-project",
        hostId,
        parentRuntimeId: dockerRuntimeId,
        spec: { status: "ready" },
      });
    }

    const composeRuntimeId = await resolveId(rest, "infra", "runtimes", stack.composeRuntime.slug);

    // 3b. System (reusable template)
    if (stack.system.action === "create") {
      await upsert(rest, result, "product", "systems", stack.system.slug, {
        slug: stack.system.slug,
        name: stack.system.name,
      });
    }

    const systemId = await resolveId(rest, "product", "systems", stack.system.slug);

    // 3c. Components
    for (const comp of stack.components) {
      if (comp.action === "create") {
        await upsert(rest, result, "product", "components", comp.slug, {
          slug: comp.slug,
          name: comp.name,
          type: comp.type,
          systemId,
        });
      }
    }

    // 3d. Site
    if (stack.site.action === "create") {
      await upsert(rest, result, "fleet", "sites", stack.site.slug, {
        slug: stack.site.slug,
        name: stack.site.name,
        spec: {
          type: stack.site.type,
          status: "active",
        },
      });
    }

    const siteId = await resolveId(rest, "fleet", "sites", stack.site.slug);

    // 3e. System deployment
    if (stack.deployment.action === "create") {
      await upsert(rest, result, "fleet", "system-deployments", stack.deployment.slug, {
        slug: stack.deployment.slug,
        name: stack.deployment.name,
        type: stack.deployment.type,
        systemId,
        siteId,
        runtimeId: composeRuntimeId,
        spec: {
          status: "active",
          runtime: "compose",
          trigger: "manual",
        },
      });
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────

async function entityExists(
  rest: FactoryClient,
  module: string,
  entity: string,
  slug: string,
): Promise<boolean> {
  try {
    const res = await rest.getEntity(module, entity, slug);
    return res?.data != null;
  } catch {
    return false;
  }
}

async function resolveId(
  rest: FactoryClient,
  module: string,
  entity: string,
  slug: string,
): Promise<string | undefined> {
  try {
    const res = await rest.getEntity(module, entity, slug);
    const data = res?.data;
    if (!data) return undefined;
    return data.id as string | undefined;
  } catch {
    return undefined;
  }
}

async function upsert(
  rest: FactoryClient,
  result: ImportResult,
  module: string,
  entity: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const exists = await entityExists(rest, module, entity, slug);
    if (exists) {
      try {
        await rest.updateEntity(module, entity, slug, body);
        result.updated.push({ entity: `${module}.${entity}`, slug });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ entity: `${module}.${entity}`, slug, error: `UPDATE: ${msg}` });
      }
    } else {
      try {
        await rest.createEntity(module, entity, body);
        result.created.push({ entity: `${module}.${entity}`, slug });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ entity: `${module}.${entity}`, slug, error: `POST: ${msg}` });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push({ entity: `${module}.${entity}`, slug, error: msg });
  }
}

// ─── Classification helpers ──────────────────────────────────

/**
 * Infer a reusable system slug from container images.
 * Stacks using the same well-known images share a system entity.
 */
export function inferSystemSlug(stack: DiscoveredStack): string {
  const images = stack.containers.map((c) => c.image.toLowerCase());

  if (images.some((i) => i.includes("supabase/"))) return "supabase";
  if (images.some((i) => i.includes("hasura/"))) return "hasura";
  if (images.some((i) => i.includes("airflow"))) return "airflow";
  if (images.some((i) => i.includes("traefik"))) return "traefik";
  if (images.some((i) => i.includes("elasticsearch"))) return "elasticsearch";
  if (images.some((i) => i.includes("coolify"))) return "coolify";
  if (images.some((i) => i.includes("grafana"))) return "grafana";
  if (images.some((i) => i.includes("graphhopper"))) return "graphhopper";
  if (images.some((i) => i.includes("martin") || i.includes("tileserv"))) return "tile-server";

  return stack.project.name;
}

function inferSiteType(stack: DiscoveredStack): string {
  const name = stack.project.name.toLowerCase();
  if (name.includes("dev") || name.includes("staging") || name.includes("stg")) return "shared";
  if (name.includes("prod")) return "dedicated";
  return "on-prem";
}

function inferEnvironment(projectName: string): string {
  const name = projectName.toLowerCase();
  if (name.includes("-dev") || name.endsWith("-dev")) return "development";
  if (name.includes("-stg") || name.includes("-staging")) return "staging";
  if (name.includes("-prod")) return "production";
  return "production"; // default to production for running services
}

const VALID_COMPONENT_TYPES = new Set([
  "service", "worker", "task", "cronjob", "website", "library",
  "cli", "agent", "gateway", "ml-model", "database", "cache",
  "queue", "storage", "search",
]);

function mapCatalogType(catalogType: string | undefined): string {
  if (!catalogType) return "service";
  const t = catalogType.toLowerCase();
  if (VALID_COMPONENT_TYPES.has(t)) return t;
  // Map catalog resource types
  if (t === "postgres" || t === "postgresql" || t === "mysql" || t === "mongo" || t === "mongodb") return "database";
  if (t === "redis" || t === "memcached") return "cache";
  if (t === "rabbitmq" || t === "kafka" || t === "nats") return "queue";
  if (t === "s3" || t === "minio") return "storage";
  if (t === "elasticsearch" || t === "meilisearch" || t === "typesense") return "search";
  if (t === "nginx" || t === "traefik" || t === "kong" || t === "envoy") return "gateway";
  return "service";
}

async function buildComponentPlans(
  stack: DiscoveredStack,
  systemSlug: string,
  rest: FactoryClient,
): Promise<ComponentPlan[]> {
  if (!stack.catalog) return [];

  const plans: ComponentPlan[] = [];
  const components = stack.catalog.components ?? {};
  const resources = stack.catalog.resources ?? {};

  for (const [name, comp] of Object.entries(components)) {
    const slug = `${systemSlug}--${name}`;
    const exists = await entityExists(rest, "product", "components", slug);
    plans.push({
      slug,
      name,
      type: mapCatalogType(comp.spec?.type),
      action: exists ? "exists" : "create",
    });
  }

  for (const [name, res] of Object.entries(resources)) {
    const slug = `${systemSlug}--${name}`;
    const exists = await entityExists(rest, "product", "components", slug);
    plans.push({
      slug,
      name,
      type: mapCatalogType(res.spec?.type),
      action: exists ? "exists" : "create",
    });
  }

  return plans;
}
