import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import {
  catalogSystem,
  catalogComponent,
  catalogResource,
  catalogApi,
  catalogEntityLink,
} from "../../db/schema/catalog";
import { orgTeam } from "../../db/schema/org";
import { productModule, componentSpec } from "../../db/schema/product";
import type { CatalogSystem } from "@smp/factory-shared/catalog";

// ---------------------------------------------------------------------------
// 1. syncCatalogSystem
// ---------------------------------------------------------------------------

export async function syncCatalogSystem(
  db: Database,
  catalog: CatalogSystem
) {
  const { metadata, spec, components, resources, apis } = catalog;
  const now = new Date();

  // ── Resolve owner team by slug ──────────────────────────────
  const ownerSlug = spec.owner;
  let team = await findTeamBySlug(db, ownerSlug);
  if (!team) {
    team = await createTeam(db, ownerSlug);
  }

  // ── Upsert system ──────────────────────────────────────────
  const systemRow = await upsertSystem(db, {
    namespace: metadata.namespace,
    name: metadata.name,
    title: metadata.title,
    description: metadata.description,
    ownerTeamId: team.teamId,
    lifecycle: spec.lifecycle ?? "production",
    labels: metadata.labels ?? {},
    annotations: metadata.annotations ?? {},
    tags: metadata.tags ?? [],
    links: metadata.links ?? [],
    spec: spec as Record<string, unknown>,
    updatedAt: now,
  });

  const systemId = systemRow.systemId;

  // ── Upsert components ──────────────────────────────────────
  let componentsUpserted = 0;
  for (const [compName, comp] of Object.entries(components)) {
    await upsertComponent(db, {
      systemId,
      name: compName,
      namespace: comp.metadata.namespace,
      title: comp.metadata.title,
      description: comp.metadata.description,
      type: comp.spec.type,
      lifecycle: comp.spec.lifecycle ?? "production",
      ownerTeamId: team.teamId,
      isPublic: comp.spec.isPublic ?? false,
      stateful: comp.spec.stateful ?? false,
      ports: comp.spec.ports ?? [],
      healthcheck: comp.spec.healthchecks ?? null,
      replicas: comp.spec.replicas ?? 1,
      cpu: comp.spec.compute?.min?.cpu ?? "100m",
      memory: comp.spec.compute?.min?.memory ?? "128Mi",
      labels: comp.metadata.labels ?? {},
      annotations: comp.metadata.annotations ?? {},
      tags: comp.metadata.tags ?? [],
      links: comp.metadata.links ?? [],
      spec: comp.spec as Record<string, unknown>,
      updatedAt: now,
    });
    componentsUpserted++;
  }

  // ── Upsert resources ───────────────────────────────────────
  let resourcesUpserted = 0;
  for (const [resName, res] of Object.entries(resources)) {
    await upsertResource(db, {
      systemId,
      name: resName,
      namespace: res.metadata.namespace,
      title: res.metadata.title,
      description: res.metadata.description,
      type: res.spec.type,
      lifecycle: res.spec.lifecycle ?? "production",
      ownerTeamId: team.teamId,
      image: res.spec.image ?? null,
      ports: res.spec.ports ?? [],
      containerPort: res.spec.containerPort ?? null,
      environment: res.spec.environment ?? {},
      volumes: res.spec.volumes ?? [],
      healthcheck: res.spec.healthcheck ?? null,
      labels: res.metadata.labels ?? {},
      annotations: res.metadata.annotations ?? {},
      tags: res.metadata.tags ?? [],
      spec: res.spec as Record<string, unknown>,
      updatedAt: now,
    });
    resourcesUpserted++;
  }

  // ── Upsert APIs ────────────────────────────────────────────
  let apisUpserted = 0;
  if (apis) {
    for (const [apiName, api] of Object.entries(apis)) {
      await upsertApi(db, {
        systemId,
        name: apiName,
        namespace: api.metadata.namespace,
        title: api.metadata.title,
        description: api.metadata.description,
        type: api.spec.type,
        lifecycle: api.spec.lifecycle ?? "production",
        ownerTeamId: team.teamId,
        definition: api.spec.definition ?? null,
        labels: api.metadata.labels ?? {},
        annotations: api.metadata.annotations ?? {},
        spec: api.spec as Record<string, unknown>,
        updatedAt: now,
      });
      apisUpserted++;
    }
  }

  // ── Link to factory_product module by slug ─────────────────
  let linked = 0;
  const [mod] = await db
    .select()
    .from(productModule)
    .where(eq(productModule.slug, metadata.name))
    .limit(1);

  if (mod) {
    await linkCatalogToModule(db, systemId, mod.moduleId);
    linked++;
  }

  return { systemId, componentsUpserted, resourcesUpserted, apisUpserted, linked };
}

// ---------------------------------------------------------------------------
// 2. getCatalogSystem
// ---------------------------------------------------------------------------

export async function getCatalogSystem(
  db: Database,
  namespace: string,
  name: string
): Promise<CatalogSystem | null> {
  const [sys] = await db
    .select()
    .from(catalogSystem)
    .where(
      and(
        eq(catalogSystem.namespace, namespace),
        eq(catalogSystem.name, name)
      )
    )
    .limit(1);

  if (!sys) return null;

  const comps = await db
    .select()
    .from(catalogComponent)
    .where(eq(catalogComponent.systemId, sys.systemId));

  const ress = await db
    .select()
    .from(catalogResource)
    .where(eq(catalogResource.systemId, sys.systemId));

  const apiRows = await db
    .select()
    .from(catalogApi)
    .where(eq(catalogApi.systemId, sys.systemId));

  // Resolve owner slug
  let ownerSlug = "unknown";
  if (sys.ownerTeamId) {
    const [team] = await db
      .select()
      .from(orgTeam)
      .where(eq(orgTeam.teamId, sys.ownerTeamId))
      .limit(1);
    if (team) ownerSlug = team.slug;
  }

  const components: CatalogSystem["components"] = {};
  for (const c of comps) {
    components[c.name] = {
      kind: "Component",
      metadata: {
        name: c.name,
        namespace: c.namespace,
        title: c.title ?? undefined,
        description: c.description ?? undefined,
        labels: (c.labels as Record<string, string>) ?? undefined,
        annotations: (c.annotations as Record<string, string>) ?? undefined,
        tags: (c.tags as string[]) ?? undefined,
        links: (c.links as Array<{ url: string; title?: string; icon?: string; type?: string }>) ?? undefined,
      },
      spec: {
        type: c.type,
        lifecycle: c.lifecycle as CatalogSystem["components"][string]["spec"]["lifecycle"],
        owner: ownerSlug,
        isPublic: c.isPublic,
        stateful: c.stateful,
        ports: c.ports as CatalogSystem["components"][string]["spec"]["ports"],
        healthchecks: c.healthcheck as CatalogSystem["components"][string]["spec"]["healthchecks"],
        replicas: c.replicas,
        compute: { min: { cpu: c.cpu, memory: c.memory } },
      },
    };
  }

  const resources: CatalogSystem["resources"] = {};
  for (const r of ress) {
    resources[r.name] = {
      kind: "Resource",
      metadata: {
        name: r.name,
        namespace: r.namespace,
        title: r.title ?? undefined,
        description: r.description ?? undefined,
        labels: (r.labels as Record<string, string>) ?? undefined,
        annotations: (r.annotations as Record<string, string>) ?? undefined,
        tags: (r.tags as string[]) ?? undefined,
      },
      spec: {
        type: r.type,
        lifecycle: r.lifecycle as CatalogSystem["resources"][string]["spec"]["lifecycle"],
        owner: ownerSlug,
        image: r.image ?? "",
        ports: r.ports as CatalogSystem["resources"][string]["spec"]["ports"],
        containerPort: r.containerPort ?? undefined,
        environment: (r.environment as Record<string, string>) ?? undefined,
        volumes: (r.volumes as string[]) ?? undefined,
        healthcheck: r.healthcheck ?? undefined,
      },
    };
  }

  const apis: CatalogSystem["apis"] = {};
  for (const a of apiRows) {
    apis[a.name] = {
      kind: "API",
      metadata: {
        name: a.name,
        namespace: a.namespace,
        title: a.title ?? undefined,
        description: a.description ?? undefined,
        labels: (a.labels as Record<string, string>) ?? undefined,
        annotations: (a.annotations as Record<string, string>) ?? undefined,
      },
      spec: {
        type: a.type as "openapi" | "asyncapi" | "graphql" | "grpc",
        lifecycle: (a.lifecycle ?? "production") as "experimental" | "development" | "production" | "deprecated",
        owner: ownerSlug,
        definition: a.definition ?? "",
      },
    };
  }

  return {
    kind: "System",
    metadata: {
      name: sys.name,
      namespace: sys.namespace,
      title: sys.title ?? undefined,
      description: sys.description ?? undefined,
      labels: (sys.labels as Record<string, string>) ?? undefined,
      annotations: (sys.annotations as Record<string, string>) ?? undefined,
      tags: (sys.tags as string[]) ?? undefined,
      links: (sys.links as Array<{ url: string; title?: string; icon?: string; type?: string }>) ?? undefined,
    },
    spec: {
      owner: ownerSlug,
      lifecycle: sys.lifecycle as CatalogSystem["spec"]["lifecycle"],
    },
    components,
    resources,
    apis,
    connections: [],
  };
}

// ---------------------------------------------------------------------------
// 3. linkCatalogToModule
// ---------------------------------------------------------------------------

export async function linkCatalogToModule(
  db: Database,
  systemId: string,
  moduleId: string
) {
  // Link system -> module
  await upsertEntityLink(db, {
    catalogEntityKind: "System",
    catalogEntityId: systemId,
    factorySchema: "factory_product",
    factoryTable: "module",
    factoryEntityId: moduleId,
  });

  // Link matching components by slug
  const comps = await db
    .select()
    .from(catalogComponent)
    .where(eq(catalogComponent.systemId, systemId));

  const specs = await db
    .select()
    .from(componentSpec)
    .where(eq(componentSpec.moduleId, moduleId));

  const specBySlug = new Map(specs.map((s) => [s.slug, s]));

  for (const comp of comps) {
    const matchingSpec = specBySlug.get(comp.name);
    if (matchingSpec) {
      await upsertEntityLink(db, {
        catalogEntityKind: "Component",
        catalogEntityId: comp.componentId,
        factorySchema: "factory_product",
        factoryTable: "component_spec",
        factoryEntityId: matchingSpec.componentId,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. unlinkCatalogEntity
// ---------------------------------------------------------------------------

export async function unlinkCatalogEntity(
  db: Database,
  catalogEntityKind: string,
  catalogEntityId: string
) {
  await db
    .delete(catalogEntityLink)
    .where(
      and(
        eq(catalogEntityLink.catalogEntityKind, catalogEntityKind),
        eq(catalogEntityLink.catalogEntityId, catalogEntityId)
      )
    );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function findTeamBySlug(db: Database, slug: string) {
  const [row] = await db
    .select()
    .from(orgTeam)
    .where(eq(orgTeam.slug, slug))
    .limit(1);
  return row ?? null;
}

async function createTeam(db: Database, slugValue: string) {
  const slug = await allocateSlug({
    baseLabel: slugValue,
    explicitSlug: slugValue,
    isTaken: async (s) => {
      const [r] = await db
        .select()
        .from(orgTeam)
        .where(eq(orgTeam.slug, s))
        .limit(1);
      return r != null;
    },
  });
  const [row] = await db
    .insert(orgTeam)
    .values({ name: slugValue, slug })
    .returning();
  return row!;
}

async function upsertSystem(
  db: Database,
  data: {
    namespace: string;
    name: string;
    title?: string;
    description?: string;
    ownerTeamId: string;
    lifecycle: string;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    tags: unknown[];
    links: unknown[];
    spec: Record<string, unknown>;
    updatedAt: Date;
  }
) {
  const [existing] = await db
    .select()
    .from(catalogSystem)
    .where(
      and(
        eq(catalogSystem.namespace, data.namespace),
        eq(catalogSystem.name, data.name)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(catalogSystem)
      .set({
        title: data.title,
        description: data.description,
        ownerTeamId: data.ownerTeamId,
        lifecycle: data.lifecycle,
        labels: data.labels,
        annotations: data.annotations,
        tags: data.tags,
        links: data.links,
        spec: data.spec,
        updatedAt: data.updatedAt,
      })
      .where(eq(catalogSystem.systemId, existing.systemId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(catalogSystem)
    .values({
      namespace: data.namespace,
      name: data.name,
      title: data.title,
      description: data.description,
      ownerTeamId: data.ownerTeamId,
      lifecycle: data.lifecycle,
      labels: data.labels,
      annotations: data.annotations,
      tags: data.tags,
      links: data.links,
      spec: data.spec,
    })
    .returning();
  return inserted!;
}

async function upsertComponent(
  db: Database,
  data: {
    systemId: string;
    name: string;
    namespace: string;
    title?: string;
    description?: string;
    type: string;
    lifecycle: string;
    ownerTeamId: string;
    isPublic: boolean;
    stateful: boolean;
    ports: unknown[];
    healthcheck: unknown;
    replicas: number;
    cpu: string;
    memory: string;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    tags: unknown[];
    links: unknown[];
    spec: Record<string, unknown>;
    updatedAt: Date;
  }
) {
  const [existing] = await db
    .select()
    .from(catalogComponent)
    .where(
      and(
        eq(catalogComponent.systemId, data.systemId),
        eq(catalogComponent.name, data.name)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(catalogComponent)
      .set({
        namespace: data.namespace,
        title: data.title,
        description: data.description,
        type: data.type,
        lifecycle: data.lifecycle,
        ownerTeamId: data.ownerTeamId,
        isPublic: data.isPublic,
        stateful: data.stateful,
        ports: data.ports,
        healthcheck: data.healthcheck,
        replicas: data.replicas,
        cpu: data.cpu,
        memory: data.memory,
        labels: data.labels,
        annotations: data.annotations,
        tags: data.tags,
        links: data.links,
        spec: data.spec,
        updatedAt: data.updatedAt,
      })
      .where(eq(catalogComponent.componentId, existing.componentId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(catalogComponent)
    .values({
      systemId: data.systemId,
      name: data.name,
      namespace: data.namespace,
      title: data.title,
      description: data.description,
      type: data.type,
      lifecycle: data.lifecycle,
      ownerTeamId: data.ownerTeamId,
      isPublic: data.isPublic,
      stateful: data.stateful,
      ports: data.ports,
      healthcheck: data.healthcheck,
      replicas: data.replicas,
      cpu: data.cpu,
      memory: data.memory,
      labels: data.labels,
      annotations: data.annotations,
      tags: data.tags,
      links: data.links,
      spec: data.spec,
    })
    .returning();
  return inserted!;
}

async function upsertResource(
  db: Database,
  data: {
    systemId: string;
    name: string;
    namespace: string;
    title?: string;
    description?: string;
    type: string;
    lifecycle: string;
    ownerTeamId: string;
    image: string | null;
    ports: unknown[];
    containerPort: number | null;
    environment: Record<string, unknown>;
    volumes: unknown[];
    healthcheck: string | null;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    tags: unknown[];
    spec: Record<string, unknown>;
    updatedAt: Date;
  }
) {
  const [existing] = await db
    .select()
    .from(catalogResource)
    .where(
      and(
        eq(catalogResource.systemId, data.systemId),
        eq(catalogResource.name, data.name)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(catalogResource)
      .set({
        namespace: data.namespace,
        title: data.title,
        description: data.description,
        type: data.type,
        lifecycle: data.lifecycle,
        ownerTeamId: data.ownerTeamId,
        image: data.image,
        ports: data.ports,
        containerPort: data.containerPort,
        environment: data.environment,
        volumes: data.volumes,
        healthcheck: data.healthcheck,
        labels: data.labels,
        annotations: data.annotations,
        tags: data.tags,
        spec: data.spec,
        updatedAt: data.updatedAt,
      })
      .where(eq(catalogResource.resourceId, existing.resourceId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(catalogResource)
    .values({
      systemId: data.systemId,
      name: data.name,
      namespace: data.namespace,
      title: data.title,
      description: data.description,
      type: data.type,
      lifecycle: data.lifecycle,
      ownerTeamId: data.ownerTeamId,
      image: data.image,
      ports: data.ports,
      containerPort: data.containerPort,
      environment: data.environment,
      volumes: data.volumes,
      healthcheck: data.healthcheck,
      labels: data.labels,
      annotations: data.annotations,
      tags: data.tags,
      spec: data.spec,
    })
    .returning();
  return inserted!;
}

async function upsertApi(
  db: Database,
  data: {
    systemId: string;
    name: string;
    namespace: string;
    title?: string;
    description?: string;
    type: string;
    lifecycle: string;
    ownerTeamId: string;
    definition: string | null;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    spec: Record<string, unknown>;
    updatedAt: Date;
  }
) {
  const [existing] = await db
    .select()
    .from(catalogApi)
    .where(
      and(
        eq(catalogApi.systemId, data.systemId),
        eq(catalogApi.name, data.name)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(catalogApi)
      .set({
        namespace: data.namespace,
        title: data.title,
        description: data.description,
        type: data.type,
        lifecycle: data.lifecycle,
        ownerTeamId: data.ownerTeamId,
        definition: data.definition,
        labels: data.labels,
        annotations: data.annotations,
        spec: data.spec,
        updatedAt: data.updatedAt,
      })
      .where(eq(catalogApi.apiId, existing.apiId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(catalogApi)
    .values({
      systemId: data.systemId,
      name: data.name,
      namespace: data.namespace,
      title: data.title,
      description: data.description,
      type: data.type,
      lifecycle: data.lifecycle,
      ownerTeamId: data.ownerTeamId,
      definition: data.definition,
      labels: data.labels,
      annotations: data.annotations,
      spec: data.spec,
    })
    .returning();
  return inserted!;
}

async function upsertEntityLink(
  db: Database,
  data: {
    catalogEntityKind: string;
    catalogEntityId: string;
    factorySchema: string;
    factoryTable: string;
    factoryEntityId: string;
  }
) {
  const [existing] = await db
    .select()
    .from(catalogEntityLink)
    .where(
      and(
        eq(catalogEntityLink.catalogEntityKind, data.catalogEntityKind),
        eq(catalogEntityLink.catalogEntityId, data.catalogEntityId)
      )
    )
    .limit(1);

  if (existing) {
    // Link already exists — update the factory side if needed
    const [updated] = await db
      .update(catalogEntityLink)
      .set({
        factorySchema: data.factorySchema,
        factoryTable: data.factoryTable,
        factoryEntityId: data.factoryEntityId,
      })
      .where(eq(catalogEntityLink.linkId, existing.linkId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(catalogEntityLink)
    .values(data)
    .returning();
  return inserted!;
}
