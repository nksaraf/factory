/**
 * Backstage catalog-info.yaml format adapter.
 *
 * Converts between Backstage's multi-document catalog-info.yaml format
 * and the internal CatalogSystem model.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  CatalogAPI,
  CatalogComponent,
  CatalogResource,
  CatalogSystem,
} from "../catalog";
import type {
  CatalogFormatAdapter,
  CatalogGenerateResult,
  CatalogParseResult,
} from "../catalog-registry";

// ─── Entity reference helpers ────────────────────────────────

interface EntityRef {
  kind: string;
  namespace: string;
  name: string;
}

/**
 * Parse a Backstage entity reference like "component:default/api"
 * or just "my-api" (defaults to kind="" namespace="default").
 */
function parseEntityRef(ref: string): EntityRef {
  const colonIdx = ref.indexOf(":");
  let kind = "";
  let rest = ref;
  if (colonIdx >= 0) {
    kind = ref.slice(0, colonIdx);
    rest = ref.slice(colonIdx + 1);
  }
  const slashIdx = rest.indexOf("/");
  let namespace = "default";
  let name = rest;
  if (slashIdx >= 0) {
    namespace = rest.slice(0, slashIdx);
    name = rest.slice(slashIdx + 1);
  }
  return { kind, namespace, name };
}

function formatEntityRef(kind: string, namespace: string, name: string): string {
  return `${kind.toLowerCase()}:${namespace}/${name}`;
}

// ─── Backstage YAML entity types ─────────────────────────────

interface BackstageEntity {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    description?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    tags?: string[];
    links?: Array<{ url: string; title?: string; icon?: string; type?: string }>;
  };
  spec: Record<string, unknown>;
}

// ─── Parse helpers ───────────────────────────────────────────

function parseMultiDocYaml(content: string): BackstageEntity[] {
  const docs = content.split(/^---$/m).filter((d) => d.trim().length > 0);
  return docs
    .map((doc) => parseYaml(doc) as BackstageEntity | null)
    .filter((entity): entity is BackstageEntity => entity != null && typeof entity === "object" && "kind" in entity);
}

function backstageComponentToCatalog(
  entity: BackstageEntity,
): CatalogComponent {
  const spec = entity.spec;
  return {
    kind: "Component",
    metadata: {
      name: entity.metadata.name,
      namespace: entity.metadata.namespace ?? "default",
      description: entity.metadata.description,
      labels: entity.metadata.labels,
      annotations: entity.metadata.annotations,
      tags: entity.metadata.tags,
      links: entity.metadata.links,
    },
    spec: {
      type: (spec.type as string) ?? "service",
      lifecycle: spec.lifecycle as CatalogComponent["spec"]["lifecycle"],
      owner: spec.owner ? parseEntityRef(spec.owner as string).name : undefined,
      system: spec.system ? parseEntityRef(spec.system as string).name : undefined,
      providesApis: spec.providesApis as string[] | undefined,
      consumesApis: spec.consumesApis as string[] | undefined,
      dependsOn: spec.dependsOn
        ? (spec.dependsOn as string[]).map((ref) => parseEntityRef(ref).name)
        : undefined,
      ports: [],
    },
  };
}

function backstageResourceToCatalog(
  entity: BackstageEntity,
): CatalogResource {
  const spec = entity.spec;
  return {
    kind: "Resource",
    metadata: {
      name: entity.metadata.name,
      namespace: entity.metadata.namespace ?? "default",
      description: entity.metadata.description,
      labels: entity.metadata.labels,
      annotations: entity.metadata.annotations,
      tags: entity.metadata.tags,
      links: entity.metadata.links,
    },
    spec: {
      type: (spec.type as string) ?? "database",
      lifecycle: spec.lifecycle as CatalogResource["spec"]["lifecycle"],
      owner: spec.owner ? parseEntityRef(spec.owner as string).name : undefined,
      system: spec.system ? parseEntityRef(spec.system as string).name : undefined,
      dependsOn: spec.dependsOn
        ? (spec.dependsOn as string[]).map((ref) => parseEntityRef(ref).name)
        : undefined,
      dependencyOf: spec.dependencyOf
        ? (spec.dependencyOf as string[]).map((ref) => parseEntityRef(ref).name)
        : undefined,
      image: (spec.image as string) ?? "",
      ports: [],
    },
  };
}

function backstageApiToCatalog(entity: BackstageEntity): CatalogAPI {
  const spec = entity.spec;
  return {
    kind: "API",
    metadata: {
      name: entity.metadata.name,
      namespace: entity.metadata.namespace ?? "default",
      description: entity.metadata.description,
      labels: entity.metadata.labels,
      annotations: entity.metadata.annotations,
      tags: entity.metadata.tags,
      links: entity.metadata.links,
    },
    spec: {
      type: (spec.type as CatalogAPI["spec"]["type"]) ?? "openapi",
      lifecycle: (spec.lifecycle as CatalogAPI["spec"]["lifecycle"]) ?? "production",
      owner: spec.owner ? parseEntityRef(spec.owner as string).name : undefined,
      system: spec.system ? parseEntityRef(spec.system as string).name : undefined,
      definition: (spec.definition as string) ?? "",
    },
  };
}

// ─── Generate helpers ────────────────────────────────────────

function buildSystemEntity(system: CatalogSystem): BackstageEntity {
  const ns = system.metadata.namespace ?? "default";
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "System",
    metadata: {
      name: system.metadata.name,
      namespace: ns,
      ...(system.metadata.description ? { description: system.metadata.description } : {}),
      ...(system.metadata.labels ? { labels: system.metadata.labels } : {}),
      ...(system.metadata.annotations ? { annotations: system.metadata.annotations } : {}),
      ...(system.metadata.tags?.length ? { tags: system.metadata.tags } : {}),
      ...(system.metadata.links?.length ? { links: system.metadata.links } : {}),
    },
    spec: {
      owner: formatEntityRef("group", ns, system.spec.owner),
      ...(system.spec.domain ? { domain: `${ns}/${system.spec.domain}` } : {}),
      ...(system.spec.lifecycle ? { lifecycle: system.spec.lifecycle } : {}),
    },
  };
}

function buildComponentEntity(
  comp: CatalogComponent,
  systemName: string,
  systemNs: string,
): BackstageEntity {
  const ns = comp.metadata.namespace ?? "default";
  const spec: Record<string, unknown> = {
    type: comp.spec.type,
    ...(comp.spec.lifecycle ? { lifecycle: comp.spec.lifecycle } : {}),
    owner: comp.spec.owner
      ? formatEntityRef("group", ns, comp.spec.owner)
      : formatEntityRef("group", ns, "unknown"),
    system: formatEntityRef("system", systemNs, systemName),
  };
  if (comp.spec.providesApis?.length) spec.providesApis = comp.spec.providesApis;
  if (comp.spec.consumesApis?.length) spec.consumesApis = comp.spec.consumesApis;
  if (comp.spec.dependsOn?.length) {
    spec.dependsOn = comp.spec.dependsOn.map((d) =>
      formatEntityRef("resource", ns, d),
    );
  }
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Component",
    metadata: {
      name: comp.metadata.name,
      namespace: ns,
      ...(comp.metadata.description ? { description: comp.metadata.description } : {}),
      ...(comp.metadata.labels ? { labels: comp.metadata.labels } : {}),
      ...(comp.metadata.annotations ? { annotations: comp.metadata.annotations } : {}),
      ...(comp.metadata.tags?.length ? { tags: comp.metadata.tags } : {}),
      ...(comp.metadata.links?.length ? { links: comp.metadata.links } : {}),
    },
    spec,
  };
}

function buildResourceEntity(
  res: CatalogResource,
  systemName: string,
  systemNs: string,
): BackstageEntity {
  const ns = res.metadata.namespace ?? "default";
  const spec: Record<string, unknown> = {
    type: res.spec.type,
    ...(res.spec.lifecycle ? { lifecycle: res.spec.lifecycle } : {}),
    owner: res.spec.owner
      ? formatEntityRef("group", ns, res.spec.owner)
      : formatEntityRef("group", ns, "unknown"),
    system: formatEntityRef("system", systemNs, systemName),
  };
  if (res.spec.dependencyOf?.length) {
    spec.dependencyOf = res.spec.dependencyOf.map((d) =>
      formatEntityRef("component", ns, d),
    );
  }
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Resource",
    metadata: {
      name: res.metadata.name,
      namespace: ns,
      ...(res.metadata.description ? { description: res.metadata.description } : {}),
      ...(res.metadata.labels ? { labels: res.metadata.labels } : {}),
      ...(res.metadata.annotations ? { annotations: res.metadata.annotations } : {}),
      ...(res.metadata.tags?.length ? { tags: res.metadata.tags } : {}),
      ...(res.metadata.links?.length ? { links: res.metadata.links } : {}),
    },
    spec,
  };
}

function buildApiEntity(
  api: CatalogAPI,
  systemName: string,
  systemNs: string,
): BackstageEntity {
  const ns = api.metadata.namespace ?? "default";
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "API",
    metadata: {
      name: api.metadata.name,
      namespace: ns,
      ...(api.metadata.description ? { description: api.metadata.description } : {}),
      ...(api.metadata.labels ? { labels: api.metadata.labels } : {}),
      ...(api.metadata.annotations ? { annotations: api.metadata.annotations } : {}),
      ...(api.metadata.tags?.length ? { tags: api.metadata.tags } : {}),
      ...(api.metadata.links?.length ? { links: api.metadata.links } : {}),
    },
    spec: {
      type: api.spec.type,
      lifecycle: api.spec.lifecycle,
      owner: api.spec.owner
        ? formatEntityRef("group", ns, api.spec.owner)
        : formatEntityRef("group", ns, "unknown"),
      system: formatEntityRef("system", systemNs, systemName),
      definition: api.spec.definition,
    },
  };
}

// ─── Adapter ─────────────────────────────────────────────────

const CATALOG_FILENAMES = [
  "catalog-info.yaml",
  "catalog-info.yml",
];

export class BackstageFormatAdapter implements CatalogFormatAdapter {
  readonly format = "backstage" as const;

  detect(rootDir: string): boolean {
    return CATALOG_FILENAMES.some((f) => existsSync(join(rootDir, f)));
  }

  parse(rootDir: string): CatalogParseResult {
    const warnings: string[] = [];

    // Find the catalog file
    let filePath: string | undefined;
    for (const f of CATALOG_FILENAMES) {
      const candidate = join(rootDir, f);
      if (existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
    if (!filePath) {
      throw new Error(`No catalog-info.yaml found in ${rootDir}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const entities = parseMultiDocYaml(content);

    // Group entities by kind
    let systemEntity: BackstageEntity | undefined;
    const componentEntities: BackstageEntity[] = [];
    const resourceEntities: BackstageEntity[] = [];
    const apiEntities: BackstageEntity[] = [];

    for (const entity of entities) {
      switch (entity.kind) {
        case "System":
          systemEntity = entity;
          break;
        case "Component":
          componentEntities.push(entity);
          break;
        case "Resource":
          resourceEntities.push(entity);
          break;
        case "API":
          apiEntities.push(entity);
          break;
        default:
          warnings.push(`Skipping unsupported entity kind: ${entity.kind}`);
      }
    }

    // Build system metadata
    const systemName = systemEntity?.metadata.name ?? basename(rootDir);
    const systemNs = systemEntity?.metadata.namespace ?? "default";

    const ownerRef = systemEntity?.spec?.owner as string | undefined;
    const owner = ownerRef ? parseEntityRef(ownerRef).name : "unknown";

    const domainRef = systemEntity?.spec?.domain as string | undefined;
    const domain = domainRef
      ? parseEntityRef(domainRef).name
      : undefined;

    const lifecycle = systemEntity?.spec?.lifecycle as CatalogSystem["spec"]["lifecycle"];

    // Convert components
    const components: Record<string, CatalogComponent> = {};
    for (const entity of componentEntities) {
      components[entity.metadata.name] = backstageComponentToCatalog(entity);
    }

    // Convert resources
    const resources: Record<string, CatalogResource> = {};
    for (const entity of resourceEntities) {
      resources[entity.metadata.name] = backstageResourceToCatalog(entity);
    }

    // Convert APIs
    const apis: Record<string, CatalogAPI> = {};
    for (const entity of apiEntities) {
      apis[entity.metadata.name] = backstageApiToCatalog(entity);
    }

    // Connections cannot be represented in Backstage
    warnings.push(
      "Backstage catalog-info.yaml does not support dx connections natively; connections will be empty.",
    );

    const system: CatalogSystem = {
      kind: "System",
      metadata: {
        name: systemName,
        namespace: systemNs,
        description: systemEntity?.metadata.description,
        labels: systemEntity?.metadata.labels,
        annotations: systemEntity?.metadata.annotations,
        tags: systemEntity?.metadata.tags,
        links: systemEntity?.metadata.links,
      },
      spec: {
        owner,
        domain,
        lifecycle,
      },
      components,
      resources,
      apis: Object.keys(apis).length > 0 ? apis : undefined,
      connections: [],
    };

    return {
      system,
      warnings,
      sourceVersion: "backstage.io/v1alpha1",
    };
  }

  generate(
    system: CatalogSystem,
    _options?: { rootDir?: string },
  ): CatalogGenerateResult {
    const warnings: string[] = [];

    if (system.connections.length > 0) {
      warnings.push(
        "Backstage catalog-info.yaml does not support dx connections; connections were skipped.",
      );
    }

    const systemNs = system.metadata.namespace ?? "default";
    const systemName = system.metadata.name;

    const documents: BackstageEntity[] = [];

    // System entity first
    documents.push(buildSystemEntity(system));

    // Components
    for (const comp of Object.values(system.components)) {
      documents.push(buildComponentEntity(comp, systemName, systemNs));
    }

    // Resources
    for (const res of Object.values(system.resources)) {
      documents.push(buildResourceEntity(res, systemName, systemNs));
    }

    // APIs
    if (system.apis) {
      for (const api of Object.values(system.apis)) {
        documents.push(buildApiEntity(api, systemName, systemNs));
      }
    }

    const yamlDocs = documents.map((doc) =>
      stringifyYaml(doc, { lineWidth: 120 }),
    );
    const content = yamlDocs.join("---\n");

    return {
      files: { "catalog-info.yaml": content },
      warnings,
    };
  }
}
