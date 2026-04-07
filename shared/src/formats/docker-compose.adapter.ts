/**
 * docker-compose format adapter.
 *
 * Reads a docker-compose.yaml and converts it to a CatalogSystem.
 * Uses image-name heuristics, labels, env vars, and depends_on to build
 * a rich catalog model with proper port names, API declarations,
 * documentation links, and inter-service connections.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";

import type {
  CatalogComponent,
  CatalogConnection,
  CatalogLifecycle,
  CatalogPort,
  CatalogResource,
  CatalogSystem,
} from "../catalog";
import type {
  CatalogFormatAdapter,
  CatalogGenerateResult,
  CatalogParseResult,
} from "../catalog-registry";
import type { ComposeService } from "../compose-gen";
import { composeToYaml, generateComposeFromCatalog } from "../compose-gen";

// ─── Env var interpolation ───────────────────────────────────

/**
 * Resolve `${VAR:-default}` and `${VAR-default}` patterns in a string,
 * matching docker compose behavior. Unresolvable vars become empty string.
 */
export function resolveComposeEnvVar(
  value: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  return value.replace(
    /\$\{([^}]+)\}/g,
    (_match, expr: string) => {
      // ${VAR:-default} — use default if unset or empty
      const colonDash = expr.indexOf(":-");
      if (colonDash !== -1) {
        const varName = expr.slice(0, colonDash);
        const defaultVal = expr.slice(colonDash + 2);
        return env[varName] || defaultVal;
      }
      // ${VAR-default} — use default only if unset
      const dash = expr.indexOf("-");
      if (dash !== -1) {
        const varName = expr.slice(0, dash);
        const defaultVal = expr.slice(dash + 1);
        return env[varName] ?? defaultVal;
      }
      // ${VAR:+alternate} — use alternate if set and non-empty
      const colonPlus = expr.indexOf(":+");
      if (colonPlus !== -1) {
        const varName = expr.slice(0, colonPlus);
        const altVal = expr.slice(colonPlus + 2);
        return env[varName] ? altVal : "";
      }
      // ${VAR} — simple substitution
      return env[expr] ?? "";
    },
  );
}

/**
 * Resolve all env var references in a record of environment variables.
 */
function resolveEnvRecord(
  envMap: Record<string, string> | undefined,
  processEnv: Record<string, string | undefined>,
): Record<string, string> {
  if (!envMap) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(envMap)) {
    resolved[key] = resolveComposeEnvVar(value, processEnv);
  }
  return resolved;
}

/**
 * Normalize environment from compose — handles both record and array forms.
 */
function normalizeEnvironment(
  env: unknown,
): Record<string, string> {
  if (!env) return {};
  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const s = String(item);
      const eqIdx = s.indexOf("=");
      if (eqIdx > 0) {
        result[s.slice(0, eqIdx)] = s.slice(eqIdx + 1);
      } else {
        result[s] = "";
      }
    }
    return result;
  }
  if (typeof env === "object") {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      result[k] = v == null ? "" : String(v);
    }
    return result;
  }
  return {};
}

// ─── Heuristics ──────────────────────────────────────────────

/** Well-known infrastructure images → resource type. */
const INFRA_IMAGE_PATTERNS: [RegExp, string][] = [
  [/^postgres/i, "database"],
  [/^postgis/i, "database"],
  [/^timescale/i, "database"],
  [/^mysql/i, "database"],
  [/^mariadb/i, "database"],
  [/^clickhouse/i, "database"],
  [/^mongo/i, "database"],
  [/^redis/i, "cache"],
  [/^valkey/i, "cache"],
  [/^memcached/i, "cache"],
  [/^rabbitmq/i, "queue"],
  [/^nats/i, "queue"],
  [/^kafka/i, "queue"],
  [/^zookeeper/i, "queue"],
  [/^minio/i, "storage"],
  [/^localstack/i, "storage"],
  [/^elasticsearch/i, "search"],
  [/^opensearch/i, "search"],
  [/^meilisearch/i, "search"],
  [/^solr/i, "search"],
  [/^traefik/i, "gateway"],
  [/^nginx/i, "gateway"],
  [/^envoy/i, "gateway"],
  [/^haproxy/i, "gateway"],
  [/^apisix/i, "gateway"],
  [/^kong/i, "gateway"],
  [/^mailhog/i, "other"],
  [/^adminer/i, "other"],
  [/^phpmyadmin/i, "other"],
];

function inferResourceTypeFromImage(image: string): string | null {
  // Strip registry/org prefix and tag: "asia-south2-docker.pkg.dev/org/docker/name:tag" → "name"
  const parts = image.split("/");
  const last = parts[parts.length - 1] ?? image;
  const imageName = last.split(":")[0] ?? last;
  for (const [pattern, type] of INFRA_IMAGE_PATTERNS) {
    if (pattern.test(imageName)) return type;
  }
  return null;
}

/** Well-known port numbers → protocol and name. */
const KNOWN_PORTS: Record<number, { name: string; protocol: string }> = {
  80: { name: "http", protocol: "http" },
  443: { name: "https", protocol: "https" },
  3000: { name: "http", protocol: "http" },
  5432: { name: "postgres", protocol: "tcp" },
  3306: { name: "mysql", protocol: "tcp" },
  6379: { name: "redis", protocol: "tcp" },
  5672: { name: "amqp", protocol: "tcp" },
  15672: { name: "management", protocol: "http" },
  27017: { name: "mongodb", protocol: "tcp" },
  9200: { name: "http", protocol: "http" },
  9300: { name: "transport", protocol: "tcp" },
  8080: { name: "http", protocol: "http" },
  8443: { name: "https", protocol: "https" },
  4317: { name: "otlp-grpc", protocol: "grpc" },
  4318: { name: "otlp-http", protocol: "http" },
  9090: { name: "http", protocol: "http" },
  9092: { name: "kafka", protocol: "tcp" },
  2181: { name: "zookeeper", protocol: "tcp" },
  8005: { name: "http", protocol: "http" },
  8181: { name: "http", protocol: "http" },
};

/** Infra service names that imply a resource. */
const INFRA_NAME_PATTERNS = [
  "db", "database", "postgres", "postgresql", "pg",
  "mysql", "mariadb", "mongo", "mongodb",
  "redis", "cache", "memcached", "valkey",
  "rabbitmq", "nats", "kafka", "zookeeper",
  "minio", "s3", "storage",
  "elasticsearch", "opensearch", "meilisearch", "solr",
  "traefik", "nginx", "envoy", "haproxy", "gateway", "proxy",
  "mailhog", "adminer", "apisix", "kong",
];

function classifyService(
  name: string,
  svc: ComposeService,
): "component" | "resource" {
  // Labels can override classification
  const labels = svc.labels ?? {};
  if (labels["catalog.kind"]) {
    return labels["catalog.kind"].toLowerCase() === "resource" ? "resource" : "component";
  }

  if (svc.build) return "component";

  if (svc.image) {
    const resourceType = inferResourceTypeFromImage(svc.image);
    if (resourceType) return "resource";
  }

  const lowerName = name.toLowerCase();
  if (INFRA_NAME_PATTERNS.some((n) => lowerName === n || lowerName.startsWith(`${n}-`))) {
    return "resource";
  }

  return "component";
}

// ─── Label conventions ───────────────────────────────────────
//
// Labels prefixed with `catalog.` are parsed into catalog metadata:
//
//   catalog.kind: Component|Resource          — override classification
//   catalog.type: service|worker|database|... — override inferred type
//   catalog.owner: team-slug                  — set owner
//   catalog.description: "..."                — description
//   catalog.tags: "tag1,tag2"                 — comma-separated tags
//   catalog.lifecycle: production|development  — lifecycle stage
//
//   catalog.port.<container-port>.name: http   — name for a port
//   catalog.port.<container-port>.protocol: grpc — protocol for a port
//
//   catalog.api.provides: "my-api"            — APIs this component provides
//   catalog.api.consumes: "other-api,auth-api" — APIs consumed
//   catalog.api.type: openapi|grpc|graphql    — API type
//
//   catalog.docs.url: "https://..."           — documentation link
//   catalog.docs.api: "/api/docs"             — API docs path
//   catalog.docs.runbook: "https://..."       — runbook link

interface ParsedLabels {
  catalogKind?: string;
  catalogType?: string;
  owner?: string;
  description?: string;
  tags?: string[];
  lifecycle?: string;
  portOverrides: Record<number, { name?: string; protocol?: string }>;
  providesApis?: string[];
  consumesApis?: string[];
  apiType?: string;
  links: Array<{ url: string; title: string; type?: string }>;
  extraLabels: Record<string, string>;
  // dx.* labels for dev workflow
  devCommand?: string;
  devSync?: string[];
  testCommand?: string;
  lintCommand?: string;
  runtime?: string;
  // catalog.connection.* labels
  connections: Record<string, { module?: string; component?: string; envVar?: string; localDefault?: string }>;
}

function parseLabels(labels: Record<string, string>): ParsedLabels {
  const result: ParsedLabels = {
    portOverrides: {},
    links: [],
    extraLabels: {},
    connections: {},
  };

  for (const [key, value] of Object.entries(labels)) {
    if (key === "catalog.kind") {
      result.catalogKind = value;
    } else if (key === "catalog.type") {
      result.catalogType = value;
    } else if (key === "catalog.owner") {
      result.owner = value;
    } else if (key === "catalog.description") {
      result.description = value;
    } else if (key === "catalog.tags") {
      result.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
    } else if (key === "catalog.lifecycle") {
      result.lifecycle = value;
    } else if (key.startsWith("catalog.port.")) {
      // catalog.port.8080.name = "http"
      const rest = key.slice("catalog.port.".length);
      const dotIdx = rest.indexOf(".");
      if (dotIdx > 0) {
        const port = parseInt(rest.slice(0, dotIdx), 10);
        const field = rest.slice(dotIdx + 1);
        if (!isNaN(port)) {
          result.portOverrides[port] ??= {};
          if (field === "name") result.portOverrides[port].name = value;
          if (field === "protocol") result.portOverrides[port].protocol = value;
        }
      }
    } else if (key === "catalog.api.provides") {
      result.providesApis = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "catalog.api.consumes") {
      result.consumesApis = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "catalog.api.type") {
      result.apiType = value;
    } else if (key === "catalog.docs.url") {
      result.links.push({ url: value, title: "Documentation", type: "doc" });
    } else if (key === "catalog.docs.api") {
      result.links.push({ url: value, title: "API Documentation", type: "api-doc" });
    } else if (key === "catalog.docs.runbook") {
      result.links.push({ url: value, title: "Runbook", type: "runbook" });
    } else if (key.startsWith("catalog.connection.")) {
      // catalog.connection.<name>.module = "auth"
      const rest = key.slice("catalog.connection.".length);
      const dotIdx = rest.indexOf(".");
      if (dotIdx > 0) {
        const connName = rest.slice(0, dotIdx);
        const field = rest.slice(dotIdx + 1);
        result.connections[connName] ??= {};
        if (field === "module") result.connections[connName].module = value;
        else if (field === "component") result.connections[connName].component = value;
        else if (field === "env_var") result.connections[connName].envVar = value;
        else if (field === "local_default") result.connections[connName].localDefault = value;
      }
    } else if (key === "dx.dev.command") {
      result.devCommand = value;
    } else if (key === "dx.dev.sync") {
      result.devSync = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "dx.test") {
      result.testCommand = value;
    } else if (key === "dx.lint") {
      result.lintCommand = value;
    } else if (key === "dx.runtime") {
      result.runtime = value;
    } else {
      // Preserve non-catalog/non-dx labels
      result.extraLabels[key] = value;
    }
  }

  return result;
}

// ─── Connection inference ────────────────────────────────────

/** Well-known env var patterns that reference other services. */
const CONNECTION_ENV_PATTERNS: Array<{
  pattern: RegExp;
  protocol: string;
  resourceType: string;
}> = [
  { pattern: /(?:^|_)(?:DATABASE_URL|DB_URL|POSTGRES_URL|PG_URL)$/i, protocol: "postgresql", resourceType: "database" },
  { pattern: /(?:^|_)(?:REDIS_URL|REDIS_URI|CACHE_URL)$/i, protocol: "redis", resourceType: "cache" },
  { pattern: /(?:^|_)(?:RABBITMQ_URL|AMQP_URL|RABBIT_URL)$/i, protocol: "amqp", resourceType: "queue" },
  { pattern: /(?:^|_)(?:MONGO_URL|MONGO_URI|MONGODB_URI)$/i, protocol: "mongodb", resourceType: "database" },
  { pattern: /(?:^|_)(?:KAFKA_BROKERS?|KAFKA_URL)$/i, protocol: "kafka", resourceType: "queue" },
  { pattern: /(?:^|_)(?:ELASTICSEARCH_URL|ES_URL|OPENSEARCH_URL)$/i, protocol: "http", resourceType: "search" },
];

interface InferredConnection {
  name: string;
  fromService: string;
  toService: string;
  envVar: string;
  envValue: string;
}

/**
 * Extract the service name referenced in a connection string.
 * E.g. "postgres://user:pass@my-db:5432/dbname" → "my-db"
 */
function extractHostFromUrl(url: string): string | null {
  try {
    // Handle protocol-less URLs
    const normalized = url.includes("://") ? url : `proto://${url}`;
    const parsed = new URL(normalized);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function inferConnections(
  services: Record<string, ComposeService>,
  resolvedEnvs: Record<string, Record<string, string>>,
): InferredConnection[] {
  const serviceNames = new Set(Object.keys(services));
  const connections: InferredConnection[] = [];

  for (const [svcName, env] of Object.entries(resolvedEnvs)) {
    for (const [envKey, envValue] of Object.entries(env)) {
      // Check if env var matches known patterns
      for (const { pattern } of CONNECTION_ENV_PATTERNS) {
        if (!pattern.test(envKey)) continue;
        const host = extractHostFromUrl(envValue);
        if (host && serviceNames.has(host)) {
          connections.push({
            name: envKey.toLowerCase().replace(/_url$/i, "").replace(/_uri$/i, ""),
            fromService: svcName,
            toService: host,
            envVar: envKey,
            envValue,
          });
        }
        break;
      }

      // Also check for simple http(s) URLs pointing at other services
      if (envValue.startsWith("http://") || envValue.startsWith("https://")) {
        const host = extractHostFromUrl(envValue);
        if (host && serviceNames.has(host) && host !== svcName) {
          // Avoid duplicates from known patterns
          if (!connections.some((c) => c.fromService === svcName && c.envVar === envKey)) {
            connections.push({
              name: envKey.toLowerCase().replace(/_url$/i, ""),
              fromService: svcName,
              toService: host,
              envVar: envKey,
              envValue,
            });
          }
        }
      }
    }
  }

  return connections;
}

// ─── Port parsing ────────────────────────────────────────────

function parsePort(portStr: string): { host: number; container: number } | null {
  // First resolve any env var interpolation to get the default
  const resolved = resolveComposeEnvVar(portStr);
  // Strip protocol suffix (e.g. "/tcp", "/udp")
  const clean = resolved.replace(/\/.*$/, "");
  const parts = clean.split(":");

  if (parts.length === 1) {
    const p = parseInt(parts[0]!, 10);
    return isNaN(p) ? null : { host: p, container: p };
  }
  if (parts.length === 2) {
    const host = parseInt(parts[0]!, 10);
    const container = parseInt(parts[1]!, 10);
    return isNaN(host) || isNaN(container) ? null : { host, container };
  }
  if (parts.length === 3) {
    // ip:host:container
    const host = parseInt(parts[1]!, 10);
    const container = parseInt(parts[2]!, 10);
    return isNaN(host) || isNaN(container) ? null : { host, container };
  }
  return null;
}

function parsePorts(
  portStrings: string[],
  labelOverrides: Record<number, { name?: string; protocol?: string }>,
): CatalogPort[] {
  const ports: CatalogPort[] = [];
  const usedNames = new Set<string>();

  for (const ps of portStrings) {
    const parsed = parsePort(typeof ps === "string" ? ps : String(ps));
    if (!parsed) continue;

    // Determine name and protocol from: labels > known ports > generic
    const override = labelOverrides[parsed.container];
    const known = KNOWN_PORTS[parsed.container];

    let name = override?.name ?? known?.name ?? `port-${parsed.container}`;
    const protocol = (override?.protocol ?? known?.protocol ?? "tcp") as CatalogPort["protocol"];

    // Ensure unique names
    if (usedNames.has(name)) {
      name = `${name}-${parsed.container}`;
    }
    usedNames.add(name);

    ports.push({ name, port: parsed.host, protocol });
  }

  return ports;
}

// ─── Service converters ──────────────────────────────────────

function serviceToComponent(
  name: string,
  svc: ComposeService,
  labels: ParsedLabels,
): CatalogComponent {
  const ports = parsePorts(svc.ports ?? [], labels.portOverrides);

  // Dev workflow: prefer dx.* labels, fall back to compose command
  const devCommand = labels.devCommand ?? (
    svc.command
      ? (Array.isArray(svc.command) ? svc.command.join(" ") : svc.command)
      : undefined
  );
  const dev = (devCommand || labels.devSync)
    ? { command: devCommand, sync: labels.devSync }
    : undefined;

  return {
    kind: "Component",
    metadata: {
      name,
      namespace: "default",
      description: labels.description,
      labels: Object.keys(labels.extraLabels).length ? labels.extraLabels : undefined,
      tags: labels.tags,
      links: labels.links.length ? labels.links : undefined,
    },
    spec: {
      type: labels.catalogType ?? "service",
      lifecycle: (labels.lifecycle ?? "production") as CatalogLifecycle,
      owner: labels.owner,
      image: svc.image,
      build: svc.build
        ? { context: svc.build.context, dockerfile: svc.build.dockerfile, args: svc.build.args }
        : undefined,
      ports,
      environment: svc.environment ?? {},
      providesApis: labels.providesApis,
      consumesApis: labels.consumesApis,
      dependsOn: extractDependsOn(svc),
      dev,
      test: labels.testCommand,
      lint: labels.lintCommand,
      runtime: labels.runtime as "node" | "python" | "java" | undefined,
      profiles: svc.profiles,
    },
  };
}

function serviceToResource(
  name: string,
  svc: ComposeService,
  labels: ParsedLabels,
): CatalogResource {
  const ports = parsePorts(svc.ports ?? [], labels.portOverrides);
  const firstPort = ports[0];
  const firstRawPort = svc.ports?.[0];
  const firstParsed = firstRawPort ? parsePort(typeof firstRawPort === "string" ? firstRawPort : String(firstRawPort)) : null;

  const resourceType = labels.catalogType
    ?? (svc.image ? inferResourceTypeFromImage(svc.image) ?? "database" : "database");

  return {
    kind: "Resource",
    metadata: {
      name,
      namespace: "default",
      description: labels.description,
      labels: Object.keys(labels.extraLabels).length ? labels.extraLabels : undefined,
      tags: labels.tags,
      links: labels.links.length ? labels.links : undefined,
    },
    spec: {
      type: resourceType,
      lifecycle: (labels.lifecycle ?? "production") as CatalogLifecycle,
      owner: labels.owner,
      image: svc.image ?? "",
      ports,
      containerPort:
        firstParsed && firstParsed.container !== firstParsed.host
          ? firstParsed.container
          : undefined,
      environment: svc.environment ?? {},
      volumes: svc.volumes,
      healthcheck: typeof svc.healthcheck?.test === "string"
        ? svc.healthcheck.test
        : Array.isArray(svc.healthcheck?.test)
          ? svc.healthcheck!.test.slice(1).join(" ")
          : undefined,
      profiles: svc.profiles,
    },
  };
}

/**
 * Extract depends_on service names as entity references.
 */
function extractDependsOn(svc: ComposeService): string[] | undefined {
  if (!svc.depends_on) return undefined;
  if (Array.isArray(svc.depends_on)) {
    return svc.depends_on.length ? svc.depends_on : undefined;
  }
  // Object form: { service: { condition: ... } }
  const keys = Object.keys(svc.depends_on);
  return keys.length ? keys : undefined;
}

// ─── Normalize compose YAML ──────────────────────────────────

/**
 * Normalize raw YAML-parsed compose data into typed ComposeService records.
 * Handles both array and object forms for environment, depends_on, and labels.
 */
function normalizeServices(
  raw: Record<string, Record<string, unknown>>,
  processEnv: Record<string, string | undefined>,
): Record<string, ComposeService> {
  const result: Record<string, ComposeService> = {};

  for (const [name, rawSvc] of Object.entries(raw)) {
    const env = normalizeEnvironment(rawSvc.environment);
    const resolvedEnv = resolveEnvRecord(env, processEnv);

    // Normalize labels (can be array or object)
    let labels: Record<string, string> | undefined;
    if (Array.isArray(rawSvc.labels)) {
      labels = {};
      for (const item of rawSvc.labels) {
        const s = String(item);
        const eqIdx = s.indexOf("=");
        if (eqIdx > 0) labels[s.slice(0, eqIdx)] = s.slice(eqIdx + 1);
      }
    } else if (rawSvc.labels && typeof rawSvc.labels === "object") {
      labels = {};
      for (const [k, v] of Object.entries(rawSvc.labels as Record<string, unknown>)) {
        labels[k] = v == null ? "" : String(v);
      }
    }

    // Normalize ports — resolve env vars in port strings
    const rawPorts = (rawSvc.ports ?? []) as Array<string | number | Record<string, unknown>>;
    const ports = rawPorts.map((p) => {
      if (typeof p === "number") return String(p);
      if (typeof p === "string") return resolveComposeEnvVar(p, processEnv);
      // Long-form port syntax
      if (typeof p === "object" && p !== null) {
        const target = (p as Record<string, unknown>).target;
        const published = (p as Record<string, unknown>).published;
        if (target != null) {
          return published != null ? `${published}:${target}` : String(target);
        }
      }
      return String(p);
    });

    // Normalize image — resolve env vars
    const image = rawSvc.image ? resolveComposeEnvVar(String(rawSvc.image), processEnv) : undefined;

    // Normalize build
    let build: ComposeService["build"];
    if (typeof rawSvc.build === "string") {
      build = { context: rawSvc.build };
    } else if (rawSvc.build && typeof rawSvc.build === "object") {
      const b = rawSvc.build as Record<string, unknown>;
      build = {
        context: String(b.context ?? "."),
        dockerfile: b.dockerfile ? String(b.dockerfile) : undefined,
        args: b.args ? normalizeEnvironment(b.args) : undefined,
      };
    }

    // Normalize depends_on
    let dependsOn: ComposeService["depends_on"];
    if (Array.isArray(rawSvc.depends_on)) {
      dependsOn = rawSvc.depends_on.map(String);
    } else if (rawSvc.depends_on && typeof rawSvc.depends_on === "object") {
      dependsOn = rawSvc.depends_on as Record<string, { condition?: string }>;
    }

    // Normalize command
    let command: ComposeService["command"];
    if (rawSvc.command != null) {
      command = Array.isArray(rawSvc.command)
        ? rawSvc.command.map(String)
        : String(rawSvc.command);
    }

    // Normalize healthcheck
    let healthcheck: ComposeService["healthcheck"];
    if (rawSvc.healthcheck && typeof rawSvc.healthcheck === "object") {
      const hc = rawSvc.healthcheck as Record<string, unknown>;
      healthcheck = {
        test: hc.test as string[] | string,
        interval: hc.interval ? String(hc.interval) : undefined,
        timeout: hc.timeout ? String(hc.timeout) : undefined,
        retries: typeof hc.retries === "number" ? hc.retries : undefined,
      };
    }

    // Normalize volumes
    const volumes = rawSvc.volumes
      ? (rawSvc.volumes as unknown[]).map((v) => {
          if (typeof v === "string") return v;
          // Long-form volume
          if (typeof v === "object" && v !== null) {
            const vol = v as Record<string, unknown>;
            const src = vol.source ? String(vol.source) : "";
            const tgt = vol.target ? String(vol.target) : "";
            const ro = vol.read_only ? ":ro" : "";
            return src ? `${src}:${tgt}${ro}` : tgt;
          }
          return String(v);
        })
      : undefined;

    // Normalize profiles
    const profiles = Array.isArray(rawSvc.profiles)
      ? rawSvc.profiles.map(String)
      : undefined;

    result[name] = {
      image,
      build,
      ports,
      environment: resolvedEnv,
      depends_on: dependsOn,
      volumes,
      command,
      healthcheck,
      labels,
      platform: rawSvc.platform ? String(rawSvc.platform) : undefined,
      restart: rawSvc.restart ? String(rawSvc.restart) : undefined,
      profiles,
    };
  }

  return result;
}

// ─── Deep merge for compose services ─────────────────────────

/**
 * Keys in a compose service whose values are arrays and should be
 * concatenated (with deduplication) rather than replaced.
 */
const COMPOSE_ARRAY_KEYS = new Set([
  "ports", "volumes", "expose", "dns", "dns_search", "extra_hosts",
  "external_links", "security_opt", "cap_add", "cap_drop", "devices",
  "tmpfs", "sysctls", "configs", "secrets", "networks",
]);

/**
 * Keys in a compose service whose values are objects and should be
 * recursively merged (key-by-key, last wins per key).
 */
const COMPOSE_OBJECT_KEYS = new Set([
  "environment", "labels", "build", "healthcheck", "logging",
  "deploy", "ulimits",
]);

/**
 * Deep-merge two compose service definitions following Docker Compose semantics:
 * - Scalars: override wins
 * - Objects (environment, labels, build, etc.): merge keys recursively
 * - Arrays (ports, volumes, etc.): concatenate and deduplicate
 * - depends_on: merge (supports both array and object forms)
 */
function deepMergeComposeService(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overrideVal] of Object.entries(override)) {
    const baseVal = result[key];

    // No base value — just take override
    if (baseVal === undefined || baseVal === null) {
      result[key] = overrideVal;
      continue;
    }

    // Both are arrays — concatenate and deduplicate
    if (Array.isArray(baseVal) && Array.isArray(overrideVal)) {
      const seen = new Set(baseVal.map((v) => JSON.stringify(v)));
      const merged = [...baseVal];
      for (const item of overrideVal) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      result[key] = merged;
      continue;
    }

    // Both are plain objects — recursive merge
    if (
      isPlainObject(baseVal) && isPlainObject(overrideVal)
    ) {
      result[key] = deepMergeComposeService(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
      continue;
    }

    // Known array key but base isn't array yet (e.g., base had scalar) — override wins
    // Known object key but types mismatch — override wins
    // All other cases — override wins (scalar replacement)
    result[key] = overrideVal;
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Merge multiple compose service maps with deep-merge semantics.
 * For each service that appears in multiple files, fields are deep-merged
 * following Docker Compose override rules.
 */
function mergeComposeServiceMaps(
  ...maps: Record<string, Record<string, unknown>>[]
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const map of maps) {
    for (const [name, service] of Object.entries(map)) {
      if (result[name]) {
        result[name] = deepMergeComposeService(result[name], service) as Record<string, unknown>;
      } else {
        result[name] = { ...service };
      }
    }
  }
  return result;
}

// ─── Compose file discovery ──────────────────────────────────

const COMPOSE_FILE_NAMES = [
  "docker-compose.yaml",
  "docker-compose.yml",
  "compose.yaml",
  "compose.yml",
];

/** Matches docker-compose*.yaml, docker-compose*.yml, compose*.yaml, compose*.yml */
const COMPOSE_GLOB_RE = /^(docker-)?compose([.-].*)?\.ya?ml$/;

export interface ComposeDiscoveryOptions {
  /** Explicit file list from package.json#dx.compose — overrides all auto-discovery */
  explicitFiles?: string[];
  /** Current environment name (defaults to "local"). Filters x-dx.environment annotations. */
  environment?: string;
}

/**
 * Check whether a compose file should be included based on its x-dx annotation.
 * Files with `x-dx.overlay: true` or a non-matching `x-dx.environment` are excluded.
 */
function shouldIncludeComposeFile(filePath: string, environment: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = parseYaml(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return true;

    const xDx = data["x-dx"] as Record<string, unknown> | undefined;
    if (!xDx || typeof xDx !== "object") return true;

    if (xDx.overlay === true) return false;
    if (typeof xDx.environment === "string" && xDx.environment !== environment) return false;

    return true;
  } catch {
    // If we can't parse, include it — let the main parse() report the error
    return true;
  }
}

/**
 * Discover compose files in a directory.
 *
 * Precedence:
 * 1. options.explicitFiles (from package.json#dx.compose) — use exactly those
 * 2. compose/ folder (globbed, sorted alphabetically)
 * 3. Auto-glob at root: all docker-compose*.yaml / compose*.yaml files,
 *    filtered by x-dx annotations (overlay, environment)
 */
export function discoverComposeFiles(
  rootDir: string,
  options?: ComposeDiscoveryOptions,
): string[] {
  const environment = options?.environment ?? "local";

  // 1. Explicit file list from dx config — overrides all auto-discovery
  if (options?.explicitFiles && options.explicitFiles.length > 0) {
    const resolved: string[] = [];
    for (const f of options.explicitFiles) {
      const candidate = join(rootDir, f);
      if (existsSync(candidate)) {
        resolved.push(candidate);
      } else {
        console.warn(`[dx] compose file not found: ${f} (listed in package.json#dx.compose)`);
      }
    }
    return resolved;
  }

  // 2. Check for compose/ directory
  const composeDir = join(rootDir, "compose");
  if (existsSync(composeDir)) {
    try {
      const entries = readdirSync(composeDir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort();
      if (entries.length > 0) {
        return entries.map((f) => join(composeDir, f));
      }
    } catch {
      // Fall through to auto-glob
    }
  }

  // 3. Auto-glob: discover all compose files at root
  try {
    const entries = readdirSync(rootDir)
      .filter((f) => COMPOSE_GLOB_RE.test(f))
      .sort();
    return entries
      .map((f) => join(rootDir, f))
      .filter((f) => shouldIncludeComposeFile(f, environment));
  } catch {
    return [];
  }
}

/**
 * Lightweight check: does a directory contain any compose files?
 * Unlike discoverComposeFiles, this does NOT parse YAML to check x-dx annotations.
 * Used by findComposeRoot to avoid reading files at every directory level.
 */
function hasComposeFiles(rootDir: string): boolean {
  // Check compose/ directory
  const composeDir = join(rootDir, "compose");
  if (existsSync(composeDir)) {
    try {
      if (readdirSync(composeDir).some((f) => /\.ya?ml$/.test(f))) return true;
    } catch { /* fall through */ }
  }
  // Check root for any matching compose filenames
  try {
    return readdirSync(rootDir).some((f) => COMPOSE_GLOB_RE.test(f));
  } catch {
    return false;
  }
}

/**
 * Walk up from startDir to find a directory containing compose files.
 * Returns the root directory or null.
 *
 * Uses a fast existence check while walking, then validates with full
 * discovery (including x-dx annotation filtering) only at the candidate.
 */
export function findComposeRoot(
  startDir: string,
  options?: ComposeDiscoveryOptions,
): string | null {
  // When explicit files are provided, walk up and check those specific files
  if (options?.explicitFiles && options.explicitFiles.length > 0) {
    let dir = startDir;
    for (;;) {
      if (options.explicitFiles.some((f) => existsSync(join(dir, f)))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  // Walk up using lightweight check, then validate with full discovery
  let dir = startDir;
  for (;;) {
    if (hasComposeFiles(dir)) {
      // Validate: after annotation filtering, are there actually files?
      if (discoverComposeFiles(dir, options).length > 0) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ─── Adapter ─────────────────────────────────────────────────

export class DockerComposeFormatAdapter implements CatalogFormatAdapter {
  readonly format = "docker-compose" as const;

  detect(rootDir: string, options?: ComposeDiscoveryOptions): boolean {
    return discoverComposeFiles(rootDir, options).length > 0;
  }

  parse(rootDir: string, options?: { env?: Record<string, string | undefined>; compose?: ComposeDiscoveryOptions }): CatalogParseResult {
    const composeFiles = discoverComposeFiles(rootDir, options?.compose);
    if (composeFiles.length === 0) {
      throw new Error(`No docker-compose file found in ${rootDir}`);
    }

    const processEnv = options?.env ?? (process.env as Record<string, string | undefined>);
    const warnings: string[] = [];

    // Merge services and extensions from all compose files (deep merge)
    let mergedRawServices: Record<string, Record<string, unknown>> = {};
    let xCatalog: Record<string, unknown> | undefined;
    let xConnections: Record<string, Record<string, unknown>> | undefined;

    for (const filePath of composeFiles) {
      const raw = readFileSync(filePath, "utf-8");
      const data = parseYaml(raw) as Record<string, unknown>;
      if (!data) continue;

      const rawServices = (data.services ?? {}) as Record<string, Record<string, unknown>>;
      mergedRawServices = mergeComposeServiceMaps(mergedRawServices, rawServices);

      // x-catalog: first file that has it wins
      if (!xCatalog && data["x-catalog"] && typeof data["x-catalog"] === "object") {
        xCatalog = data["x-catalog"] as Record<string, unknown>;
      }
      // x-connections: merge across files
      if (data["x-connections"] && typeof data["x-connections"] === "object") {
        xConnections = { ...xConnections, ...(data["x-connections"] as Record<string, Record<string, unknown>>) };
      }
    }

    const services = normalizeServices(mergedRawServices, processEnv);

    const components: Record<string, CatalogComponent> = {};
    const resources: Record<string, CatalogResource> = {};

    // Classify and convert services
    for (const [name, svc] of Object.entries(services)) {
      const labels = parseLabels(svc.labels ?? {});
      const kind = classifyService(name, svc);
      if (kind === "resource") {
        resources[name] = serviceToResource(name, svc, labels);
      } else {
        components[name] = serviceToComponent(name, svc, labels);
      }
    }

    // Build connections from multiple sources

    // 1. Infer connections from env vars referencing other services
    const resolvedEnvs: Record<string, Record<string, string>> = {};
    for (const [name, svc] of Object.entries(services)) {
      resolvedEnvs[name] = svc.environment ?? {};
    }
    const inferredConnections = inferConnections(services, resolvedEnvs);

    // 2. Connections from x-connections top-level extension
    const explicitConnections: CatalogConnection[] = [];
    if (xConnections) {
      for (const [connName, conn] of Object.entries(xConnections)) {
        if (!conn || typeof conn !== "object") continue;
        explicitConnections.push({
          name: connName,
          targetModule: conn.module ? String(conn.module) : basename(rootDir),
          targetComponent: conn.component ? String(conn.component) : connName,
          envVar: conn.env_var ? String(conn.env_var) : `${connName.toUpperCase()}_URL`,
          localDefault: conn.local_default ? String(conn.local_default) : undefined,
          optional: conn.optional === true ? true : undefined,
        });
      }
    }

    // 3. Connections from catalog.connection.* labels on services
    for (const [, svc] of Object.entries(services)) {
      const labels = parseLabels(svc.labels ?? {});
      for (const [connName, conn] of Object.entries(labels.connections)) {
        if (!conn.envVar) continue; // need at least env_var
        explicitConnections.push({
          name: connName,
          targetModule: conn.module ?? basename(rootDir),
          targetComponent: conn.component ?? connName,
          envVar: conn.envVar,
          localDefault: conn.localDefault,
        });
      }
    }

    // Merge: explicit connections override inferred ones by envVar
    const systemName = xCatalog?.name ? String(xCatalog.name) : basename(rootDir);
    const explicitEnvVars = new Set(explicitConnections.map((c) => c.envVar));
    const connections: CatalogConnection[] = [
      ...explicitConnections,
      ...inferredConnections
        .filter((c) => !explicitEnvVars.has(c.envVar))
        .map((c) => ({
          name: c.name,
          targetModule: systemName,
          targetComponent: c.toService,
          envVar: c.envVar,
          localDefault: c.envValue,
        })),
    ];

    // System-level metadata from x-catalog, falling back to labels
    let systemOwner = xCatalog?.owner ? String(xCatalog.owner) : undefined;
    if (!systemOwner) {
      for (const svc of Object.values(services)) {
        const ownerLabel = svc.labels?.["catalog.owner"];
        if (ownerLabel) {
          systemOwner = ownerLabel;
          break;
        }
      }
    }

    const system: CatalogSystem = {
      kind: "System",
      metadata: {
        name: systemName,
        namespace: "default",
        description: xCatalog?.description ? String(xCatalog.description) : undefined,
      },
      spec: {
        owner: systemOwner ?? "unknown",
        domain: xCatalog?.domain ? String(xCatalog.domain) : undefined,
        lifecycle: xCatalog?.lifecycle ? (String(xCatalog.lifecycle) as CatalogLifecycle) : undefined,
      },
      components,
      resources,
      connections,
      formatExtensions: {
        "docker-compose": {
          sourceFiles: composeFiles,
          // Keep legacy field for backward compat
          sourceFile: composeFiles[0],
        },
      },
    };

    return { system, warnings };
  }

  generate(system: CatalogSystem): CatalogGenerateResult {
    const warnings: string[] = [];
    const compose = generateComposeFromCatalog(system);
    const content = composeToYaml(compose);

    return {
      files: { "docker-compose.yaml": content },
      warnings,
    };
  }
}
