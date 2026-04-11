import { spawnSync } from "node:child_process"

import type {
  DbResourceConfig,
  ActivityInfo,
  ColumnInfo,
  ConstraintInfo,
  DbClient,
  DbDriver,
  ExtensionInfo,
  IndexInfo,
  LockInfo,
  Row,
  SequenceInfo,
  TableInfo,
} from "./db-driver.js"
import { registerDriver } from "./db-driver.js"

// ── SQL Constants ────────────────────────────────────────────────────────────

const LIST_TABLES_SQL = `
  SELECT
    schemaname AS schema,
    relname AS name,
    n_live_tup AS row_estimate,
    pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS total_size
  FROM pg_stat_user_tables
  ORDER BY schemaname, relname
`

const LIST_TABLES_FILTERED_SQL = `
  SELECT
    schemaname AS schema,
    relname AS name,
    n_live_tup AS row_estimate,
    pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS total_size
  FROM pg_stat_user_tables
  WHERE relname LIKE $1
  ORDER BY schemaname, relname
`

const DESCRIBE_TABLE_SQL = `
  SELECT
    column_name AS column,
    data_type AS type,
    is_nullable = 'YES' AS nullable,
    column_default AS default_value
  FROM information_schema.columns
  WHERE table_schema || '.' || table_name = $1
     OR table_name = $1
  ORDER BY ordinal_position
`

const LIST_INDEXES_SQL = `
  SELECT
    schemaname AS schema,
    relname AS table,
    indexrelname AS name,
    (SELECT string_agg(a.attname, ', ')
     FROM pg_index i2
     JOIN pg_attribute a ON a.attrelid = i2.indrelid AND a.attnum = ANY(i2.indkey)
     WHERE i2.indexrelid = indexrelid) AS columns,
    indisunique AS unique,
    idx_scan AS scans
  FROM pg_stat_user_indexes
  JOIN pg_index USING (indexrelid)
  ORDER BY schemaname, relname, indexrelname
`

const LIST_INDEXES_UNUSED_SQL = `
  SELECT
    schemaname AS schema,
    relname AS table,
    indexrelname AS name,
    (SELECT string_agg(a.attname, ', ')
     FROM pg_index i2
     JOIN pg_attribute a ON a.attrelid = i2.indrelid AND a.attnum = ANY(i2.indkey)
     WHERE i2.indexrelid = indexrelid) AS columns,
    indisunique AS unique,
    idx_scan AS scans
  FROM pg_stat_user_indexes
  JOIN pg_index USING (indexrelid)
  WHERE idx_scan = 0
  ORDER BY schemaname, relname, indexrelname
`

const LIST_CONSTRAINTS_SQL = `
  SELECT
    tc.table_schema AS schema,
    tc.table_name AS table,
    tc.constraint_name AS name,
    tc.constraint_type AS type,
    COALESCE(
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position),
      ''
    ) AS definition
  FROM information_schema.table_constraints tc
  LEFT JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
  GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type
  ORDER BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name
`

const LIST_SEQUENCES_SQL = `
  SELECT
    schemaname AS schema,
    sequencename AS name,
    last_value
  FROM pg_sequences
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY schemaname, sequencename
`

const LIST_EXTENSIONS_SQL = `
  SELECT
    e.extname AS name,
    e.extversion AS version,
    n.nspname AS schema,
    COALESCE(c.description, '') AS comment
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  LEFT JOIN pg_description c ON c.objoid = e.oid AND c.classoid = 'pg_extension'::regclass
  ORDER BY e.extname
`

const LIST_ACTIVITY_SQL = `
  SELECT
    pid,
    state,
    COALESCE(query, '') AS query,
    COALESCE(
      EXTRACT(EPOCH FROM (now() - query_start))::text || 's',
      ''
    ) AS duration,
    COALESCE(usename, '') AS "user",
    COALESCE(datname, '') AS database,
    COALESCE(application_name, '') AS application_name
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND state IS NOT NULL
  ORDER BY query_start NULLS LAST
`

const LIST_LOCKS_SQL = `
  SELECT
    blocked.pid AS blocked_pid,
    blocked_activity.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking_activity.query AS blocking_query,
    blocked.locktype AS lock_type
  FROM pg_locks blocked
  JOIN pg_stat_activity blocked_activity ON blocked.pid = blocked_activity.pid
  JOIN pg_locks blocking
    ON blocking.locktype = blocked.locktype
    AND blocking.database IS NOT DISTINCT FROM blocked.database
    AND blocking.relation IS NOT DISTINCT FROM blocked.relation
    AND blocking.page IS NOT DISTINCT FROM blocked.page
    AND blocking.tuple IS NOT DISTINCT FROM blocked.tuple
    AND blocking.virtualxid IS NOT DISTINCT FROM blocked.virtualxid
    AND blocking.transactionid IS NOT DISTINCT FROM blocked.transactionid
    AND blocking.classid IS NOT DISTINCT FROM blocked.classid
    AND blocking.objid IS NOT DISTINCT FROM blocked.objid
    AND blocking.objsubid IS NOT DISTINCT FROM blocked.objsubid
    AND blocking.pid <> blocked.pid
  JOIN pg_stat_activity blocking_activity ON blocking.pid = blocking_activity.pid
  WHERE NOT blocked.granted
`

const LIST_LONG_QUERIES_SQL = `
  SELECT
    pid,
    state,
    COALESCE(query, '') AS query,
    EXTRACT(EPOCH FROM (now() - query_start))::text || 's' AS duration,
    COALESCE(usename, '') AS "user",
    COALESCE(datname, '') AS database,
    COALESCE(application_name, '') AS application_name
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND state = 'active'
    AND query_start IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - query_start)) > $1
  ORDER BY query_start
`

// ── PostgreSQL Client ────────────────────────────────────────────────────────

class PgClient implements DbClient {
  private pg: import("pg").Client

  constructor(pg: import("pg").Client) {
    this.pg = pg
  }

  async query(sql: string, params?: unknown[]): Promise<Row[]> {
    const result = await this.pg.query(sql, params)
    return result.rows as Row[]
  }

  async close(): Promise<void> {
    await this.pg.end()
  }
}

// ── PostgreSQL Driver ────────────────────────────────────────────────────────

const postgresDriver: DbDriver = {
  type: "postgres",

  buildUrl(res: DbResourceConfig): string {
    const user = res.env.POSTGRES_USER ?? "postgres"
    const pass = res.env.POSTGRES_PASSWORD ?? "postgres"
    const db = res.env.POSTGRES_DB ?? "postgres"
    const port = res.port
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@localhost:${port}/${encodeURIComponent(db)}`
  },

  async connect(url: string): Promise<DbClient> {
    const { Client } = await import("pg")
    const client = new Client({ connectionString: url })
    await client.connect()
    return new PgClient(client)
  },

  spawnInteractive(url: string): number {
    const result = spawnSync("psql", [url], { stdio: "inherit" })
    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "psql not found. Install PostgreSQL client tools:\n" +
            "  macOS: brew install libpq\n" +
            "  Ubuntu/Debian: sudo apt install postgresql-client\n" +
            "  Fedora/RHEL: sudo dnf install postgresql"
        )
      }
      throw result.error
    }
    return result.status ?? 1
  },

  async listTables(client: DbClient, filter?: string): Promise<TableInfo[]> {
    if (filter) {
      const glob = filter.replace(/\*/g, "%")
      const rows = await client.query(LIST_TABLES_FILTERED_SQL, [glob])
      return rows.map(rowToTableInfo)
    }
    const rows = await client.query(LIST_TABLES_SQL)
    return rows.map(rowToTableInfo)
  },

  async describeTable(client: DbClient, table: string): Promise<ColumnInfo[]> {
    const rows = await client.query(DESCRIBE_TABLE_SQL, [table])
    return rows.map((r) => ({
      column: String(r.column),
      type: String(r.type),
      nullable: Boolean(r.nullable),
      defaultValue: r.default_value != null ? String(r.default_value) : null,
    }))
  },

  async listIndexes(client: DbClient, unused?: boolean): Promise<IndexInfo[]> {
    const sql = unused ? LIST_INDEXES_UNUSED_SQL : LIST_INDEXES_SQL
    const rows = await client.query(sql)
    return rows.map((r) => ({
      schema: String(r.schema),
      table: String(r.table),
      name: String(r.name),
      columns: String(r.columns ?? ""),
      unique: Boolean(r.unique),
      scans: Number(r.scans),
    }))
  },

  async listConstraints(client: DbClient): Promise<ConstraintInfo[]> {
    const rows = await client.query(LIST_CONSTRAINTS_SQL)
    return rows.map((r) => ({
      schema: String(r.schema),
      table: String(r.table),
      name: String(r.name),
      type: String(r.type),
      definition: String(r.definition),
    }))
  },

  async listSequences(client: DbClient): Promise<SequenceInfo[]> {
    const rows = await client.query(LIST_SEQUENCES_SQL)
    return rows.map((r) => ({
      schema: String(r.schema),
      name: String(r.name),
      lastValue: r.last_value != null ? Number(r.last_value) : null,
    }))
  },

  async listExtensions(client: DbClient): Promise<ExtensionInfo[]> {
    const rows = await client.query(LIST_EXTENSIONS_SQL)
    return rows.map((r) => ({
      name: String(r.name),
      version: String(r.version),
      schema: String(r.schema),
      comment: String(r.comment),
    }))
  },

  async listActivity(client: DbClient): Promise<ActivityInfo[]> {
    const rows = await client.query(LIST_ACTIVITY_SQL)
    return rows.map(rowToActivityInfo)
  },

  async listLocks(client: DbClient): Promise<LockInfo[]> {
    const rows = await client.query(LIST_LOCKS_SQL)
    return rows.map((r) => ({
      blockedPid: Number(r.blocked_pid),
      blockedQuery: String(r.blocked_query),
      blockingPid: Number(r.blocking_pid),
      blockingQuery: String(r.blocking_query),
      lockType: String(r.lock_type),
    }))
  },

  async listLongQueries(
    client: DbClient,
    thresholdSeconds = 5
  ): Promise<ActivityInfo[]> {
    const rows = await client.query(LIST_LONG_QUERIES_SQL, [thresholdSeconds])
    return rows.map(rowToActivityInfo)
  },

  async killQuery(client: DbClient, pid: number): Promise<boolean> {
    const rows = await client.query(
      "SELECT pg_terminate_backend($1) AS terminated",
      [pid]
    )
    return Boolean(rows[0]?.terminated)
  },

  async backup(url: string, outputPath: string): Promise<void> {
    const result = spawnSync(
      "pg_dump",
      ["--format=custom", "--file", outputPath, url],
      { stdio: ["ignore", "pipe", "pipe"] }
    )
    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "pg_dump not found. Install PostgreSQL client tools:\n" +
            "  macOS: brew install libpq\n" +
            "  Ubuntu/Debian: sudo apt install postgresql-client\n" +
            "  Fedora/RHEL: sudo dnf install postgresql"
        )
      }
      throw result.error
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() ?? ""
      throw new Error(`pg_dump failed (exit ${result.status}): ${stderr}`)
    }
  },

  async restore(url: string, inputPath: string): Promise<void> {
    const result = spawnSync(
      "pg_restore",
      ["--clean", "--if-exists", "--dbname", url, inputPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    )
    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "pg_restore not found. Install PostgreSQL client tools:\n" +
            "  macOS: brew install libpq\n" +
            "  Ubuntu/Debian: sudo apt install postgresql-client\n" +
            "  Fedora/RHEL: sudo dnf install postgresql"
        )
      }
      throw result.error
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() ?? ""
      // pg_restore exits 1 for warnings (e.g. "role does not exist") — only fail on real errors
      if ((result.status ?? 0) > 1 || /\bERROR\b/.test(stderr)) {
        throw new Error(`pg_restore failed (exit ${result.status}): ${stderr}`)
      }
    }
  },
}

function rowToTableInfo(r: Row): TableInfo {
  return {
    schema: String(r.schema),
    name: String(r.name),
    rowEstimate: Number(r.row_estimate),
    totalSize: String(r.total_size),
  }
}

function rowToActivityInfo(r: Row): ActivityInfo {
  return {
    pid: Number(r.pid),
    state: String(r.state),
    query: String(r.query),
    duration: String(r.duration),
    user: String(r.user),
    database: String(r.database),
    applicationName: String(r.application_name),
  }
}

// Register the driver
registerDriver("postgres", () => postgresDriver)
