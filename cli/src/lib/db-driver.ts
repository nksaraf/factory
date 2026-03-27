import type { ProjectContext } from "./project.js";

/** Result row from a query — column name → value. */
export type Row = Record<string, unknown>;

/** Minimal client interface returned by a driver's `connect()`. */
export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

export interface TableInfo {
  schema: string;
  name: string;
  rowEstimate: number;
  totalSize: string;
}

export interface ColumnInfo {
  column: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
}

export interface IndexInfo {
  schema: string;
  table: string;
  name: string;
  columns: string;
  unique: boolean;
  scans: number;
}

export interface ConstraintInfo {
  schema: string;
  table: string;
  name: string;
  type: string;
  definition: string;
}

export interface SequenceInfo {
  schema: string;
  name: string;
  lastValue: number | null;
}

export interface ExtensionInfo {
  name: string;
  version: string;
  schema: string;
  comment: string;
}

export interface ActivityInfo {
  pid: number;
  state: string;
  query: string;
  duration: string;
  user: string;
  database: string;
  applicationName: string;
}

export interface LockInfo {
  blockedPid: number;
  blockedQuery: string;
  blockingPid: number;
  blockingQuery: string;
  lockType: string;
}

/** Flattened database resource config extracted from a CatalogResource. */
export interface DbResourceConfig {
  image: string;
  port: number;
  env: Record<string, string>;
}

/** A database driver provides connection, introspection, and interactive shell support. */
export interface DbDriver {
  type: string;

  /** Build a connection URL from a database resource config. */
  buildUrl(res: DbResourceConfig, name: string): string;

  /** Open a programmatic connection. */
  connect(url: string): Promise<DbClient>;

  /** Spawn an interactive CLI session (psql, mysql, sqlite3, etc.). */
  spawnInteractive(url: string): number;

  /** Introspection queries. Methods may throw if unsupported for this DB type. */
  listTables(client: DbClient, filter?: string): Promise<TableInfo[]>;
  describeTable(client: DbClient, table: string): Promise<ColumnInfo[]>;
  listIndexes(client: DbClient, unused?: boolean): Promise<IndexInfo[]>;
  listConstraints(client: DbClient): Promise<ConstraintInfo[]>;
  listSequences(client: DbClient): Promise<SequenceInfo[]>;
  listExtensions(client: DbClient): Promise<ExtensionInfo[]>;
  listActivity(client: DbClient): Promise<ActivityInfo[]>;
  listLocks(client: DbClient): Promise<LockInfo[]>;
  listLongQueries(
    client: DbClient,
    thresholdSeconds?: number
  ): Promise<ActivityInfo[]>;
  killQuery(client: DbClient, pid: number): Promise<boolean>;
}

// Known database image prefixes → driver type
const DB_IMAGE_PATTERNS: [RegExp, string][] = [
  [/^postgres/i, "postgres"],
  [/^postgis/i, "postgres"],
  [/^timescale/i, "postgres"],
  [/^mysql/i, "mysql"],
  [/^mariadb/i, "mysql"],
  [/^clickhouse/i, "clickhouse"],
  [/^sqlite/i, "sqlite"],
];

// Known dependency key names → driver type
const DB_KEY_PATTERNS: Record<string, string> = {
  postgres: "postgres",
  postgresql: "postgres",
  pg: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  clickhouse: "clickhouse",
  sqlite: "sqlite",
};

/** Detect database type from resource name or image. */
export function detectDbType(
  name: string,
  res: DbResourceConfig
): string | null {
  // Check key name first
  const byKey = DB_KEY_PATTERNS[name.toLowerCase()];
  if (byKey) return byKey;

  // Check image name
  for (const [pattern, type] of DB_IMAGE_PATTERNS) {
    if (pattern.test(res.image)) return type;
  }

  return null;
}

/** Convert a CatalogResource to a DbResourceConfig. */
function resourceToDbConfig(res: {
  spec: {
    image: string;
    ports: Array<{ port: number }>;
    environment?: Record<string, string>;
  };
}): DbResourceConfig {
  return {
    image: res.spec.image,
    port: res.spec.ports?.[0]?.port ?? 0,
    env: res.spec.environment ?? {},
  };
}

/** Find all database dependencies from a project's catalog. */
export function findDbDependencies(
  ctx: ProjectContext
): { name: string; res: DbResourceConfig; dbType: string }[] {
  const results: { name: string; res: DbResourceConfig; dbType: string }[] = [];

  for (const [name, resource] of Object.entries(ctx.catalog.resources)) {
    const res = resourceToDbConfig(resource);
    const dbType = detectDbType(name, res);
    if (dbType) {
      results.push({ name, res, dbType });
    }
  }

  return results;
}

/** Registered driver factories keyed by db type. */
const driverRegistry = new Map<string, () => DbDriver>();

export function registerDriver(type: string, factory: () => DbDriver): void {
  driverRegistry.set(type, factory);
}

export function getDriver(type: string): DbDriver {
  const factory = driverRegistry.get(type);
  if (!factory) {
    throw new Error(
      `No driver registered for database type "${type}". Supported: ${[...driverRegistry.keys()].join(", ")}`
    );
  }
  return factory();
}

/**
 * Resolve which database dependency to use and return its driver.
 * Uses --db flag to select if multiple databases exist.
 */
export function resolveDbTarget(
  ctx: ProjectContext,
  dbFlag?: string
): { name: string; res: DbResourceConfig; driver: DbDriver; url: string } {
  const dbDeps = findDbDependencies(ctx);

  if (dbDeps.length === 0) {
    throw new Error(
      "No database dependencies found. Declare a postgres, mysql, sqlite, or clickhouse service in docker-compose."
    );
  }

  let selected: (typeof dbDeps)[0];

  if (dbFlag) {
    const match = dbDeps.find((d) => d.name === dbFlag);
    if (!match) {
      const available = dbDeps.map((d) => d.name).join(", ");
      throw new Error(
        `Database "${dbFlag}" not found. Available: ${available}`
      );
    }
    selected = match;
  } else if (dbDeps.length === 1) {
    selected = dbDeps[0];
  } else {
    selected = dbDeps[0];
    const others = dbDeps
      .slice(1)
      .map((d) => d.name)
      .join(", ");
    console.error(
      `Multiple databases found. Using "${selected.name}" (${selected.dbType}). Use --db to select: ${others}`
    );
  }

  const driver = getDriver(selected.dbType);

  // Check for URL override via env var
  const envKey =
    `${ctx.systemName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
  const url =
    process.env[envKey] ||
    process.env.DATABASE_URL ||
    driver.buildUrl(selected.res, selected.name);

  return { name: selected.name, res: selected.res, driver, url };
}
