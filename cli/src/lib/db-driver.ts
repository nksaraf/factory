import type { DependencyConfig } from "@smp/factory-shared/config-schemas";

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

/** A database driver provides connection, introspection, and interactive shell support. */
export interface DbDriver {
  type: string;

  /** Build a connection URL from a dx.yaml dependency config. */
  buildUrl(dep: DependencyConfig, name: string): string;

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

/** Detect database type from dependency key name or image. */
export function detectDbType(
  name: string,
  dep: DependencyConfig
): string | null {
  // Check key name first
  const byKey = DB_KEY_PATTERNS[name.toLowerCase()];
  if (byKey) return byKey;

  // Check image name
  for (const [pattern, type] of DB_IMAGE_PATTERNS) {
    if (pattern.test(dep.image)) return type;
  }

  return null;
}

/** Find all database dependencies from a project's dx.yaml. */
export function findDbDependencies(
  ctx: ProjectContext
): { name: string; dep: DependencyConfig; dbType: string }[] {
  const deps = ctx.moduleConfig.dependencies;
  const results: { name: string; dep: DependencyConfig; dbType: string }[] = [];

  for (const [name, dep] of Object.entries(deps)) {
    const dbType = detectDbType(name, dep);
    if (dbType) {
      results.push({ name, dep, dbType });
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
): { name: string; dep: DependencyConfig; driver: DbDriver; url: string } {
  const dbDeps = findDbDependencies(ctx);

  if (dbDeps.length === 0) {
    throw new Error(
      "No database dependencies found in dx.yaml. Declare a postgres, mysql, sqlite, or clickhouse dependency."
    );
  }

  let selected: (typeof dbDeps)[0];

  if (dbFlag) {
    const match = dbDeps.find((d) => d.name === dbFlag);
    if (!match) {
      const available = dbDeps.map((d) => d.name).join(", ");
      throw new Error(
        `Database "${dbFlag}" not found in dx.yaml dependencies. Available: ${available}`
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
    `${ctx.moduleConfig.module.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
  const url =
    process.env[envKey] ||
    process.env.DATABASE_URL ||
    driver.buildUrl(selected.dep, selected.name);

  return { name: selected.name, dep: selected.dep, driver, url };
}
