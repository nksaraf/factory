import { type ChildProcess, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

import { exitWithError } from "../lib/cli-exit.js"
import type { BackupMetadata, DbClient, DbDriver } from "../lib/db-driver.js"
import {
  DB_BACKUP_DIR,
  backupFilePath,
  resolveDbTarget,
} from "../lib/db-driver.js"

// Register postgres driver (side-effect import)
import "../lib/db-driver-postgres.js"

import type { DxBase } from "../dx-root.js"
import { type ProjectContextData, resolveDxContext } from "../lib/dx-context.js"
import { EntityFinder } from "../lib/entity-finder.js"
import { findFreePort, spawnSshForward } from "../lib/forward-state.js"
import { isPortFree } from "../lib/port-manager.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import { actionResult, styleMuted, styleSuccess } from "./list-helpers.js"

setExamples("db", [
  "$ dx db connect                    Connect to database",
  '$ dx db query --sql "SELECT 1"     Run a query',
  "$ dx db migrate status             Check migration status",
  "$ dx db migrate up                 Run pending migrations",
  "$ dx db backup create                     Create a database backup",
  "$ dx db backup create --name my-snap       Create a named backup",
  "$ dx db backup list                        List available backups",
  "$ dx db restore --name my-snap --force     Restore from a backup",
])

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shared db flags inherited by all subcommands. */
const dbFlags = {
  db: {
    type: "string" as const,
    description:
      "Database dependency name from docker-compose (when multiple databases exist)",
  },
  target: {
    type: "string" as const,
    description: "Target environment (local, staging, production)",
  },
} as const

type DbContext = {
  name: string
  driver: DbDriver
  url: string
  client: DbClient
}

/**
 * When --target is a remote host, tunnel the DB port via SSH and rewrite
 * the connection URL to localhost:<tunneled-port>.
 */
async function tunnelForRemoteTarget(
  url: string,
  remotePort: number,
  target: string,
  verbose?: boolean
): Promise<{ url: string; tunnel: ChildProcess }> {
  const finder = new EntityFinder()
  const entity = await finder.resolve(target)
  if (!entity?.sshHost) {
    throw new Error(`Could not resolve SSH host for target "${target}"`)
  }

  const localPort = await findFreePort(remotePort, false)

  if (verbose) {
    console.log(
      styleMuted(
        `  Tunneling ${target}:${remotePort} → localhost:${localPort}…`
      )
    )
  }

  const tunnel = spawnSshForward({
    sshHost: entity.sshHost,
    sshPort: entity.sshPort ?? 22,
    sshUser: entity.sshUser ?? undefined,
    identityFile: entity.identityFile ?? undefined,
    jumpHost: entity.jumpHost,
    jumpUser: entity.jumpUser,
    jumpPort: entity.jumpPort,
    localPort,
    remotePort,
  })

  // Wait for the tunnel to establish by polling the local port
  const deadline = Date.now() + 10_000
  let tunnelReady = false
  while (Date.now() < deadline) {
    if (!(await isPortFree(localPort))) {
      tunnelReady = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!tunnelReady) {
    tunnel.kill("SIGTERM")
    throw new Error(
      `SSH tunnel to ${target}:${remotePort} did not establish within 10 seconds`
    )
  }

  // Rewrite the URL: replace host:port with localhost:localPort using URL parser
  // (regex is fragile with passwords containing @ or :)
  const rewritten = rewriteDbUrl(url, "localhost", localPort)

  return { url: rewritten, tunnel }
}

/**
 * Parse a database connection URL and extract the port.
 * Uses URL parser to correctly handle passwords with special characters.
 */
function extractPortFromUrl(url: string): number {
  try {
    const parsed = new URL(url)
    return parsed.port ? parseInt(parsed.port, 10) : 5432
  } catch {
    return 5432
  }
}

/**
 * Rewrite a database connection URL with a new host and port.
 * Uses URL parser to extract the current host:port, then does a targeted
 * string replacement to avoid re-encoding passwords on roundtrip.
 */
function rewriteDbUrl(url: string, newHost: string, newPort: number): string {
  try {
    const parsed = new URL(url)
    const oldHostPort = `${parsed.hostname}:${parsed.port || 5432}`
    const newHostPort = `${newHost}:${newPort}`
    return url.replace(oldHostPort, newHostPort)
  } catch {
    return url.replace(/(@[^:/]+)(:\d+)/, `@${newHost}:${newPort}`)
  }
}

/**
 * If --target is a remote host, set up an SSH tunnel and rewrite the DB URL.
 * Returns the (possibly rewritten) URL and an optional tunnel process to clean up.
 */
async function maybeTunnel(
  url: string,
  flags: Record<string, unknown>
): Promise<{ url: string; tunnel?: ChildProcess }> {
  const f = toDxFlags(flags)
  if (!flags.target || flags.target === "local") {
    return { url }
  }

  try {
    const remotePort = extractPortFromUrl(url)
    const result = await tunnelForRemoteTarget(
      url,
      remotePort,
      flags.target as string,
      f.verbose
    )
    return { url: result.url, tunnel: result.tunnel }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    exitWithError(f, `Failed to tunnel to ${flags.target}: ${msg}`)
  }
}

async function withDb(
  flags: Record<string, unknown>,
  fn: (ctx: DbContext) => Promise<void>
): Promise<void> {
  const f = toDxFlags(flags)
  let project: ProjectContextData
  try {
    const ctx = await resolveDxContext({ need: "project" })
    project = ctx.project
  } catch {
    exitWithError(
      f,
      "No docker-compose found. Run this command from a project directory."
    )
  }

  const { name, driver, url } = resolveDbTarget(
    project.catalog,
    project.name,
    flags.db as string | undefined
  )

  const { url: connectUrl, tunnel } = await maybeTunnel(url, flags)

  let client: DbClient
  try {
    client = await driver.connect(connectUrl)
  } catch (err) {
    tunnel?.kill("SIGTERM")
    const msg = err instanceof Error ? err.message : String(err)
    exitWithError(f, `Failed to connect to ${name}: ${msg}`)
  }

  try {
    await fn({ name, driver, url: connectUrl, client })
  } finally {
    await client.close()
    tunnel?.kill("SIGTERM")
  }
}

function tableOut(
  flags: Record<string, unknown>,
  rows: object[],
  columns?: string[]
): void {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ success: true, data: rows }, null, 2))
    return
  }
  if (rows.length === 0) {
    console.log("No results.")
    return
  }
  const cols = columns ?? Object.keys(rows[0]!)
  // Header
  console.log(cols.join("\t"))
  console.log(cols.map((c) => "-".repeat(c.length)).join("\t"))
  // Rows
  for (const row of rows) {
    const r = row as Record<string, unknown>
    console.log(cols.map((c) => String(r[c] ?? "")).join("\t"))
  }
}

// ── Command Registration ─────────────────────────────────────────────────────

export function dbCommand(app: DxBase) {
  return (
    app
      .sub("db")
      .meta({
        description: "Database tools for your project's database dependencies",
      })

      // ── connect ──────────────────────────────────────────────────────────
      .command("connect", (c) =>
        c
          .meta({
            description:
              "Open an interactive database shell (psql, mysql, etc.)",
          })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            let project: ProjectContextData
            try {
              const ctx = await resolveDxContext({ need: "project" })
              project = ctx.project
            } catch {
              exitWithError(
                f,
                "No docker-compose found. Run this command from a project directory."
              )
            }

            const { name, driver, url } = resolveDbTarget(
              project.catalog,
              project.name,
              flags.db as string | undefined
            )
            const { url: connectUrl, tunnel } = await maybeTunnel(url, flags)

            if (f.verbose) {
              console.log(`Connecting to ${name} (${driver.type})…`)
            }

            try {
              const code = driver.spawnInteractive(connectUrl)
              tunnel?.kill("SIGTERM")
              process.exit(code)
            } catch (err) {
              tunnel?.kill("SIGTERM")
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg)
            }
          })
      )

      // ── query ────────────────────────────────────────────────────────────
      .command("query", (c) =>
        c
          .meta({ description: "Execute a SQL query" })
          .flags({
            ...dbFlags,
            sql: { type: "string", short: "s", description: "SQL to execute" },
            file: {
              type: "string",
              short: "f",
              description: "Read SQL from file",
            },
            readonly: {
              type: "boolean",
              description: "Execute in read-only mode",
            },
            tenant: {
              type: "string",
              description: "Set tenant context (for RLS-enabled databases)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            let sql = flags.sql as string | undefined

            if (flags.file) {
              try {
                sql = readFileSync(flags.file as string, "utf8")
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                exitWithError(f, `Failed to read SQL file: ${msg}`)
              }
            }

            if (!sql) {
              exitWithError(f, "Provide SQL as an argument or use -f <file>.")
            }

            await withDb(flags, async ({ client }) => {
              if (flags.tenant) {
                const tenant = String(flags.tenant)
                if (!/^[\w-]+$/.test(tenant)) {
                  exitWithError(
                    f,
                    "Tenant name must be alphanumeric (with hyphens/underscores)."
                  )
                }
                await client.query(`SET app.current_tenant = '${tenant}'`)
              }

              try {
                if (flags.readonly) {
                  await client.query("BEGIN READ ONLY")
                }
                const rows = await client.query(sql)
                if (flags.readonly) {
                  await client.query("COMMIT")
                }
                tableOut(flags, rows)
              } catch (err) {
                if (flags.readonly) {
                  await client.query("ROLLBACK").catch(() => {})
                }
                const msg = err instanceof Error ? err.message : String(err)
                exitWithError(f, `Query failed: ${msg}`)
              }
            })
          })
      )

      // ── table ────────────────────────────────────────────────────────────
      .command("table", (c) =>
        c
          .meta({ description: "List tables with row counts and sizes" })
          .flags({
            ...dbFlags,
            filter: {
              type: "string",
              description: "Glob filter for table names (e.g. 'order*')",
            },
          })
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const tables = await driver.listTables(
                client,
                flags.filter as string | undefined
              )
              tableOut(flags, tables, [
                "schema",
                "name",
                "rowEstimate",
                "totalSize",
              ])
            })
          })
      )

      // ── schema ───────────────────────────────────────────────────────────
      .command("schema", (c) =>
        c
          .meta({ description: "Describe table columns, types, and defaults" })
          .flags({
            ...dbFlags,
            table: {
              type: "string",
              short: "t",
              description: "Table name (schema.table or just table)",
            },
          })
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              if (flags.table) {
                const cols = await driver.describeTable(
                  client,
                  flags.table as string
                )
                tableOut(flags, cols, [
                  "column",
                  "type",
                  "nullable",
                  "defaultValue",
                ])
              } else {
                // No table specified — show all tables
                const tables = await driver.listTables(client)
                tableOut(flags, tables, [
                  "schema",
                  "name",
                  "rowEstimate",
                  "totalSize",
                ])
              }
            })
          })
      )

      // ── index ────────────────────────────────────────────────────────────
      .command("index", (c) =>
        c
          .meta({ description: "List indexes with usage statistics" })
          .flags({
            ...dbFlags,
            unused: {
              type: "boolean",
              description: "Show only unused indexes (candidates for removal)",
            },
          })
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const indexes = await driver.listIndexes(
                client,
                flags.unused as boolean | undefined
              )
              tableOut(flags, indexes, [
                "schema",
                "table",
                "name",
                "columns",
                "unique",
                "scans",
              ])
            })
          })
      )

      // ── constraint ───────────────────────────────────────────────────────
      .command("constraint", (c) =>
        c
          .meta({
            description: "List foreign keys, checks, and unique constraints",
          })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const constraints = await driver.listConstraints(client)
              tableOut(flags, constraints, [
                "schema",
                "table",
                "name",
                "type",
                "definition",
              ])
            })
          })
      )

      // ── sequence ─────────────────────────────────────────────────────────
      .command("sequence", (c) =>
        c
          .meta({ description: "List sequences and their current values" })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const seqs = await driver.listSequences(client)
              tableOut(flags, seqs, ["schema", "name", "lastValue"])
            })
          })
      )

      // ── extension ────────────────────────────────────────────────────────
      .command("extension", (c) =>
        c
          .meta({ description: "List installed database extensions" })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const exts = await driver.listExtensions(client)
              tableOut(flags, exts, ["name", "version", "schema", "comment"])
            })
          })
      )

      // ── activity ─────────────────────────────────────────────────────────
      .command("activity", (c) =>
        c
          .meta({ description: "Show active database connections and queries" })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const activity = await driver.listActivity(client)
              tableOut(flags, activity, [
                "pid",
                "state",
                "duration",
                "user",
                "database",
                "query",
              ])
            })
          })
      )

      // ── lock ─────────────────────────────────────────────────────────────
      .command("lock", (c) =>
        c
          .meta({ description: "Show lock contention between queries" })
          .flags(dbFlags)
          .run(async ({ flags }) => {
            await withDb(flags, async ({ driver, client }) => {
              const locks = await driver.listLocks(client)
              if (locks.length === 0) {
                const f = toDxFlags(flags)
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: [] }, null, 2)
                  )
                } else {
                  console.log("No lock contention detected.")
                }
                return
              }
              tableOut(flags, locks, [
                "blockedPid",
                "blockedQuery",
                "blockingPid",
                "blockingQuery",
                "lockType",
              ])
            })
          })
      )

      // ── long-queries ─────────────────────────────────────────────────────
      .command("long-queries", (c) =>
        c
          .meta({ description: "Show queries running longer than threshold" })
          .flags({
            ...dbFlags,
            threshold: {
              type: "number",
              description: "Threshold in seconds (default: 5)",
            },
            kill: { type: "number", description: "Kill query by PID" },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)

            await withDb(flags, async ({ driver, client }) => {
              if (flags.kill != null) {
                const killed = await driver.killQuery(
                  client,
                  flags.kill as number
                )
                actionResult(
                  flags,
                  { pid: flags.kill, terminated: killed },
                  killed
                    ? styleSuccess(`Terminated query on PID ${flags.kill}`)
                    : `Failed to terminate PID ${flags.kill} (may have already completed)`
                )
                return
              }

              const threshold = (flags.threshold as number | undefined) ?? 5
              const queries = await driver.listLongQueries(client, threshold)
              if (queries.length === 0) {
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: [] }, null, 2)
                  )
                } else {
                  console.log(`No queries running longer than ${threshold}s.`)
                }
                return
              }
              tableOut(flags, queries, [
                "pid",
                "duration",
                "user",
                "database",
                "query",
              ])
            })
          })
      )

      // ── migrate ──────────────────────────────────────────────────────────
      .command("migrate", (c) =>
        c
          .meta({ description: "Database migration management" })

          .command("status", (s) =>
            s
              .meta({ description: "Show applied and pending migrations" })
              .flags(dbFlags)
              .run(async ({ flags }) => {
                await withDb(flags, async ({ client }) => {
                  // Try to read the migrations table
                  let applied: Record<string, unknown>[] = []
                  try {
                    applied = await client.query(
                      "SELECT * FROM factory_migrations ORDER BY created_at"
                    )
                  } catch {
                    // Table may not exist yet — that's fine, means no migrations applied
                  }

                  const f = toDxFlags(flags)
                  if (f.json) {
                    console.log(
                      JSON.stringify(
                        { success: true, data: { applied } },
                        null,
                        2
                      )
                    )
                  } else {
                    if (applied.length === 0) {
                      console.log("No migrations have been applied yet.")
                    } else {
                      console.log(`${applied.length} migration(s) applied:`)
                      tableOut(flags, applied)
                    }
                  }
                })
              })
          )

          .command("up", (s) =>
            s
              .meta({ description: "Run pending migrations" })
              .flags(dbFlags)
              .run(async ({ flags }) => {
                const f = toDxFlags(flags)

                let project: ProjectContextData
                try {
                  const ctx = await resolveDxContext({ need: "project" })
                  project = ctx.project
                } catch {
                  exitWithError(f, "No docker-compose found.")
                }

                const { url } = resolveDbTarget(
                  project.catalog,
                  project.name,
                  flags.db as string | undefined
                )

                const result = spawnSync("bunx", ["drizzle-kit", "migrate"], {
                  stdio: "inherit",
                  env: { ...process.env, DATABASE_URL: url },
                  cwd: project.rootDir,
                })

                if (result.status !== 0) {
                  exitWithError(f, "Migration failed.")
                }

                actionResult(
                  flags,
                  { success: true },
                  styleSuccess("Migrations applied successfully.")
                )
              })
          )

          .command("create", (s) =>
            s
              .meta({ description: "Create a new migration" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Migration name",
                },
              ])
              .flags(dbFlags)
              .run(async ({ args, flags }) => {
                const f = toDxFlags(flags)

                let project: ProjectContextData
                try {
                  const ctx = await resolveDxContext({ need: "project" })
                  project = ctx.project
                } catch {
                  exitWithError(f, "No docker-compose found.")
                }

                const result = spawnSync(
                  "bunx",
                  ["drizzle-kit", "generate", "--name", args.name as string],
                  {
                    stdio: "inherit",
                    cwd: project.rootDir,
                  }
                )

                if (result.status !== 0) {
                  exitWithError(f, "Failed to create migration.")
                }
              })
          )

          .command("plan", (s) =>
            s
              .meta({ description: "Show SQL that would run without applying" })
              .flags(dbFlags)
              .run(async ({ flags }) => {
                const f = toDxFlags(flags)

                let project: ProjectContextData
                try {
                  const ctx = await resolveDxContext({ need: "project" })
                  project = ctx.project
                } catch {
                  exitWithError(f, "No docker-compose found.")
                }

                const { url } = resolveDbTarget(
                  project.catalog,
                  project.name,
                  flags.db as string | undefined
                )

                const result = spawnSync("bunx", ["drizzle-kit", "check"], {
                  stdio: "inherit",
                  env: { ...process.env, DATABASE_URL: url },
                  cwd: project.rootDir,
                })

                if (result.status !== 0) {
                  exitWithError(f, "Plan check failed.")
                }
              })
          )
      )

      // ── reset ────────────────────────────────────────────────────────────
      .command("reset", (c) =>
        c
          .meta({ description: "Drop and recreate database, run migrations" })
          .flags({
            ...dbFlags,
            seed: {
              type: "boolean",
              description: "Run seed after reset (use --no-seed to skip)",
            },
            force: { type: "boolean", description: "Skip confirmation prompt" },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)

            if (!flags.force) {
              exitWithError(
                f,
                "This will destroy all data. Use --force to confirm."
              )
            }

            await withDb(flags, async ({ client, name }) => {
              if (f.verbose) {
                console.log(`Resetting database ${name}…`)
              }

              // Find and drop all user schemas
              const schemas = await client.query(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')"
              )
              for (const row of schemas) {
                await client.query(
                  `DROP SCHEMA ${String(row.schema_name)} CASCADE`
                )
              }
              await client.query("CREATE SCHEMA public")
              await client.query("GRANT ALL ON SCHEMA public TO PUBLIC")

              actionResult(
                flags,
                { reset: true },
                styleSuccess(
                  "Database reset. Run 'dx db migrate up' to apply migrations."
                )
              )
            })
          })
      )

      // ── seed ─────────────────────────────────────────────────────────────
      .command("seed", (c) =>
        c
          .meta({ description: "Load seed data into the database" })
          .args([])
          .flags({
            ...dbFlags,
            fixture: {
              type: "string",
              description: "Named fixture to load (from seeds/ directory)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            let project: ProjectContextData
            try {
              const ctx = await resolveDxContext({ need: "project" })
              project = ctx.project
            } catch {
              exitWithError(f, "No docker-compose found.")
            }

            const { join } = await import("node:path")

            const fixture = (flags.fixture as string) ?? "default"
            const seedDir = join(project.rootDir, "seeds")
            const sqlFile = join(seedDir, `${fixture}.sql`)

            if (!existsSync(sqlFile)) {
              exitWithError(f, `Seed file not found: ${sqlFile}`)
            }

            const sql = readFileSync(sqlFile, "utf8")

            await withDb(flags, async ({ client }) => {
              await client.query("BEGIN")
              try {
                await client.query(sql)
                await client.query("COMMIT")
              } catch (err) {
                await client.query("ROLLBACK").catch(() => {})
                const msg = err instanceof Error ? err.message : String(err)
                exitWithError(f, `Seed failed (rolled back): ${msg}`)
              }
              actionResult(
                flags,
                { seeded: true, fixture },
                styleSuccess(`Seed "${fixture}" applied successfully.`)
              )
            })
          })
      )

      // ── backup ────────────────────────────────────────────────────────────
      .command("backup", (c) =>
        c
          .meta({ description: "Create, list, or delete database backups" })

          .command("create", (s) =>
            s
              .meta({ description: "Create a database backup" })
              .flags({
                ...dbFlags,
                name: {
                  type: "string",
                  short: "n",
                  description: "Backup name (defaults to <db>-<timestamp>)",
                },
              })
              .run(async ({ flags }) => {
                const f = toDxFlags(flags)
                let project: ProjectContextData
                try {
                  const ctx = await resolveDxContext({ need: "project" })
                  project = ctx.project
                } catch {
                  exitWithError(f, "No docker-compose found.")
                }

                const {
                  name: dbName,
                  driver,
                  url,
                } = resolveDbTarget(
                  project.catalog,
                  project.name,
                  flags.db as string | undefined
                )
                const stamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-")
                  .slice(0, 19)
                const backupName =
                  (flags.name as string) || `${dbName}-${stamp}`
                const dumpPath = backupFilePath(backupName, "dump")

                mkdirSync(DB_BACKUP_DIR, { recursive: true })

                if (existsSync(dumpPath)) {
                  exitWithError(
                    f,
                    `Backup "${backupName}" already exists. Choose a different name or delete it first.`
                  )
                }

                if (f.verbose) {
                  console.log(
                    `Backing up ${dbName} (${driver.type}) → ${dumpPath}`
                  )
                }

                try {
                  await driver.backup(url, dumpPath)
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err)
                  exitWithError(f, msg)
                }

                const sizeBytes = statSync(dumpPath).size
                const meta: BackupMetadata = {
                  name: backupName,
                  dbType: driver.type,
                  createdAt: new Date().toISOString(),
                  sizeBytes,
                }
                writeFileSync(
                  backupFilePath(backupName, "json"),
                  JSON.stringify(meta, null, 2) + "\n"
                )

                const sizeStr =
                  sizeBytes < 1024 * 1024
                    ? `${(sizeBytes / 1024).toFixed(1)} KB`
                    : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`

                actionResult(
                  flags,
                  meta,
                  styleSuccess(`Backup created: ${backupName} (${sizeStr})`)
                )
              })
          )

          .command("list", (s) =>
            s
              .meta({ description: "List available backups" })
              .flags({})
              .run(({ flags }) => {
                const f = toDxFlags(flags)
                if (!existsSync(DB_BACKUP_DIR)) {
                  if (f.json) {
                    console.log(
                      JSON.stringify({ success: true, data: [] }, null, 2)
                    )
                  } else {
                    console.log("No backups found.")
                  }
                  return
                }

                const metaFiles = readdirSync(DB_BACKUP_DIR).filter((fname) =>
                  fname.endsWith(".json")
                )
                const backups: BackupMetadata[] = metaFiles
                  .map((file) => {
                    try {
                      return JSON.parse(
                        readFileSync(`${DB_BACKUP_DIR}/${file}`, "utf8")
                      ) as BackupMetadata
                    } catch {
                      return null
                    }
                  })
                  .filter((b): b is BackupMetadata => b !== null)

                backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

                if (backups.length === 0) {
                  if (f.json) {
                    console.log(
                      JSON.stringify({ success: true, data: [] }, null, 2)
                    )
                  } else {
                    console.log("No backups found.")
                  }
                  return
                }

                tableOut(
                  flags,
                  backups.map((b) => ({
                    name: b.name,
                    dbType: b.dbType,
                    created: b.createdAt,
                    size:
                      b.sizeBytes < 1024 * 1024
                        ? `${(b.sizeBytes / 1024).toFixed(1)} KB`
                        : `${(b.sizeBytes / (1024 * 1024)).toFixed(1)} MB`,
                  })),
                  ["name", "dbType", "created", "size"]
                )
              })
          )

          .command("delete", (s) =>
            s
              .meta({ description: "Delete a backup" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Backup name to delete",
                },
              ])
              .flags({
                force: { type: "boolean", description: "Skip confirmation" },
              })
              .run(({ args, flags }) => {
                const f = toDxFlags(flags)
                const name = args.name as string
                const dumpPath = backupFilePath(name, "dump")
                const metaPath = backupFilePath(name, "json")

                if (!existsSync(dumpPath) && !existsSync(metaPath)) {
                  exitWithError(f, `Backup "${name}" not found.`)
                }

                if (!flags.force) {
                  exitWithError(
                    f,
                    `This will permanently delete backup "${name}". Use --force to confirm.`
                  )
                }

                if (existsSync(dumpPath)) unlinkSync(dumpPath)
                if (existsSync(metaPath)) unlinkSync(metaPath)

                actionResult(
                  flags,
                  { deleted: true, name },
                  styleSuccess(`Backup "${name}" deleted.`)
                )
              })
          )
      )

      // ── restore ───────────────────────────────────────────────────────────
      .command("restore", (c) =>
        c
          .meta({ description: "Restore database from a backup" })
          .flags({
            ...dbFlags,
            name: {
              type: "string",
              short: "n",
              description: "Backup name to restore",
            },
            file: {
              type: "string",
              short: "f",
              description: "Restore from an arbitrary dump file path",
            },
            clean: {
              type: "boolean",
              description:
                "Drop all schemas before restoring (avoids FK conflicts)",
            },
            force: {
              type: "boolean",
              description: "Confirm destructive restore",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)

            if (!flags.force) {
              exitWithError(
                f,
                "Restore will overwrite the target database. Use --force to confirm."
              )
            }

            const name = flags.name as string | undefined
            const filePath = flags.file as string | undefined

            if (!name && !filePath) {
              exitWithError(f, "Provide a backup name or use --file <path>.")
            }

            const dumpPath = filePath ?? backupFilePath(name!, "dump")

            if (!existsSync(dumpPath)) {
              exitWithError(
                f,
                filePath
                  ? `File not found: ${filePath}`
                  : `Backup "${name}" not found. Run 'dx db backup list' to see available backups.`
              )
            }

            let project: ProjectContextData
            try {
              const ctx = await resolveDxContext({ need: "project" })
              project = ctx.project
            } catch {
              exitWithError(f, "No docker-compose found.")
            }

            const {
              name: dbName,
              driver,
              url,
            } = resolveDbTarget(
              project.catalog,
              project.name,
              flags.db as string | undefined
            )

            if (f.verbose) {
              console.log(`Restoring ${dumpPath} → ${dbName} (${driver.type})`)
            }

            // Drop all user schemas first to avoid FK dependency conflicts
            if (flags.clean) {
              if (f.verbose) {
                console.log("Dropping all user schemas…")
              }
              const client = await driver.connect(url)
              try {
                const schemas = await client.query(
                  "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public')"
                )
                for (const row of schemas) {
                  await client.query(
                    `DROP SCHEMA "${String(row.schema_name)}" CASCADE`
                  )
                }
                // Recreate public schema clean
                await client.query("DROP SCHEMA IF EXISTS public CASCADE")
                await client.query("CREATE SCHEMA public")
                await client.query("GRANT ALL ON SCHEMA public TO PUBLIC")
              } finally {
                await client.close()
              }
            }

            try {
              await driver.restore(url, dumpPath)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              exitWithError(f, msg)
            }

            const label = name ?? filePath!
            actionResult(
              flags,
              { restored: true, from: label, to: dbName },
              styleSuccess(`Restored from: ${label}`)
            )
          })
      )
  )
}
