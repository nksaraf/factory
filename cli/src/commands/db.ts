import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { exitWithError } from "../lib/cli-exit.js";
import type { DbClient, DbDriver } from "../lib/db-driver.js";
import { resolveDbTarget } from "../lib/db-driver.js";
// Register postgres driver (side-effect import)
import "../lib/db-driver-postgres.js";
import { ProjectContext } from "../lib/project.js";
import type { DxBase } from "../dx-root.js";
import { toDxFlags } from "./dx-flags.js";
import {
  actionResult,
  styleSuccess,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("db", [
  "$ dx db connect                    Connect to database",
  '$ dx db query --sql "SELECT 1"     Run a query',
  "$ dx db migrate status             Check migration status",
  "$ dx db migrate up                 Run pending migrations",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shared db flags inherited by all subcommands. */
const dbFlags = {
  db: { type: "string" as const, description: "Database dependency name from dx.yaml (when multiple databases exist)" },
  target: { type: "string" as const, description: "Target environment (local, staging, production)" },
} as const;

type DbContext = {
  name: string;
  driver: DbDriver;
  url: string;
  client: DbClient;
};

async function withDb(
  flags: Record<string, unknown>,
  fn: (ctx: DbContext) => Promise<void>
): Promise<void> {
  const f = toDxFlags(flags);
  let project: ProjectContext;
  try {
    project = ProjectContext.fromCwd();
  } catch {
    exitWithError(f, "No dx.yaml found. Run this command from a module directory.");
  }

  const { name, driver, url } = resolveDbTarget(project, flags.db as string | undefined);

  if (flags.target && flags.target !== "local") {
    exitWithError(f, "Remote targets (--target) are not yet supported. Use local dev database.");
  }

  let client: DbClient;
  try {
    client = await driver.connect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithError(f, `Failed to connect to ${name}: ${msg}`);
  }

  try {
    await fn({ name, driver, url, client });
  } finally {
    await client.close();
  }
}

function tableOut(
  flags: Record<string, unknown>,
  rows: Record<string, unknown>[],
  columns?: string[]
): void {
  const f = toDxFlags(flags);
  if (f.json) {
    console.log(JSON.stringify({ success: true, data: rows }, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  // Header
  console.log(cols.join("\t"));
  console.log(cols.map((c) => "-".repeat(c.length)).join("\t"));
  // Rows
  for (const row of rows) {
    console.log(cols.map((c) => String(row[c] ?? "")).join("\t"));
  }
}

// ── Command Registration ─────────────────────────────────────────────────────

export function dbCommand(app: DxBase) {
  return app
    .sub("db")
    .meta({ description: "Database tools for your project's database dependencies" })

    // ── connect ──────────────────────────────────────────────────────────
    .command("connect", (c) =>
      c
        .meta({ description: "Open an interactive database shell (psql, mysql, etc.)" })
        .flags(dbFlags)
        .run(({ flags }) => {
          const f = toDxFlags(flags);
          let project: ProjectContext;
          try {
            project = ProjectContext.fromCwd();
          } catch {
            exitWithError(f, "No dx.yaml found. Run this command from a module directory.");
          }

          const { name, driver, url } = resolveDbTarget(project, flags.db as string | undefined);

          if (f.verbose) {
            console.log(`Connecting to ${name} (${driver.type})…`);
          }

          try {
            const code = driver.spawnInteractive(url);
            process.exit(code);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
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
          file: { type: "string", short: "f", description: "Read SQL from file" },
          readonly: { type: "boolean", description: "Execute in read-only mode" },
          tenant: { type: "string", description: "Set tenant context (for RLS-enabled databases)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          let sql = flags.sql as string | undefined;

          if (flags.file) {
            try {
              sql = readFileSync(flags.file as string, "utf8");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              exitWithError(f, `Failed to read SQL file: ${msg}`);
            }
          }

          if (!sql) {
            exitWithError(f, "Provide SQL as an argument or use -f <file>.");
          }

          await withDb(flags, async ({ client }) => {
            if (flags.tenant) {
              const tenant = String(flags.tenant);
              if (!/^[\w-]+$/.test(tenant)) {
                exitWithError(f, "Tenant name must be alphanumeric (with hyphens/underscores).");
              }
              await client.query(`SET app.current_tenant = '${tenant}'`);
            }

            try {
              if (flags.readonly) {
                await client.query("BEGIN READ ONLY");
              }
              const rows = await client.query(sql);
              if (flags.readonly) {
                await client.query("COMMIT");
              }
              tableOut(flags, rows);
            } catch (err) {
              if (flags.readonly) {
                await client.query("ROLLBACK").catch(() => {});
              }
              const msg = err instanceof Error ? err.message : String(err);
              exitWithError(f, `Query failed: ${msg}`);
            }
          });
        })
    )

    // ── table ────────────────────────────────────────────────────────────
    .command("table", (c) =>
      c
        .meta({ description: "List tables with row counts and sizes" })
        .flags({
          ...dbFlags,
          filter: { type: "string", description: "Glob filter for table names (e.g. 'order*')" },
        })
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const tables = await driver.listTables(client, flags.filter as string | undefined);
            tableOut(flags, tables as unknown as Record<string, unknown>[], [
              "schema", "name", "rowEstimate", "totalSize",
            ]);
          });
        })
    )

    // ── schema ───────────────────────────────────────────────────────────
    .command("schema", (c) =>
      c
        .meta({ description: "Describe table columns, types, and defaults" })
        .flags({
          ...dbFlags,
          table: { type: "string", short: "t", description: "Table name (schema.table or just table)" },
        })
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            if (flags.table) {
              const cols = await driver.describeTable(client, flags.table as string);
              tableOut(flags, cols as unknown as Record<string, unknown>[], [
                "column", "type", "nullable", "defaultValue",
              ]);
            } else {
              // No table specified — show all tables
              const tables = await driver.listTables(client);
              tableOut(flags, tables as unknown as Record<string, unknown>[], [
                "schema", "name", "rowEstimate", "totalSize",
              ]);
            }
          });
        })
    )

    // ── index ────────────────────────────────────────────────────────────
    .command("index", (c) =>
      c
        .meta({ description: "List indexes with usage statistics" })
        .flags({
          ...dbFlags,
          unused: { type: "boolean", description: "Show only unused indexes (candidates for removal)" },
        })
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const indexes = await driver.listIndexes(client, flags.unused as boolean | undefined);
            tableOut(flags, indexes as unknown as Record<string, unknown>[], [
              "schema", "table", "name", "columns", "unique", "scans",
            ]);
          });
        })
    )

    // ── constraint ───────────────────────────────────────────────────────
    .command("constraint", (c) =>
      c
        .meta({ description: "List foreign keys, checks, and unique constraints" })
        .flags(dbFlags)
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const constraints = await driver.listConstraints(client);
            tableOut(flags, constraints as unknown as Record<string, unknown>[], [
              "schema", "table", "name", "type", "definition",
            ]);
          });
        })
    )

    // ── sequence ─────────────────────────────────────────────────────────
    .command("sequence", (c) =>
      c
        .meta({ description: "List sequences and their current values" })
        .flags(dbFlags)
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const seqs = await driver.listSequences(client);
            tableOut(flags, seqs as unknown as Record<string, unknown>[], [
              "schema", "name", "lastValue",
            ]);
          });
        })
    )

    // ── extension ────────────────────────────────────────────────────────
    .command("extension", (c) =>
      c
        .meta({ description: "List installed database extensions" })
        .flags(dbFlags)
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const exts = await driver.listExtensions(client);
            tableOut(flags, exts as unknown as Record<string, unknown>[], [
              "name", "version", "schema", "comment",
            ]);
          });
        })
    )

    // ── activity ─────────────────────────────────────────────────────────
    .command("activity", (c) =>
      c
        .meta({ description: "Show active database connections and queries" })
        .flags(dbFlags)
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const activity = await driver.listActivity(client);
            tableOut(flags, activity as unknown as Record<string, unknown>[], [
              "pid", "state", "duration", "user", "database", "query",
            ]);
          });
        })
    )

    // ── lock ─────────────────────────────────────────────────────────────
    .command("lock", (c) =>
      c
        .meta({ description: "Show lock contention between queries" })
        .flags(dbFlags)
        .run(async ({ flags }) => {
          await withDb(flags, async ({ driver, client }) => {
            const locks = await driver.listLocks(client);
            if (locks.length === 0) {
              const f = toDxFlags(flags);
              if (f.json) {
                console.log(JSON.stringify({ success: true, data: [] }, null, 2));
              } else {
                console.log("No lock contention detected.");
              }
              return;
            }
            tableOut(flags, locks as unknown as Record<string, unknown>[], [
              "blockedPid", "blockedQuery", "blockingPid", "blockingQuery", "lockType",
            ]);
          });
        })
    )

    // ── long-queries ─────────────────────────────────────────────────────
    .command("long-queries", (c) =>
      c
        .meta({ description: "Show queries running longer than threshold" })
        .flags({
          ...dbFlags,
          threshold: { type: "number", description: "Threshold in seconds (default: 5)" },
          kill: { type: "number", description: "Kill query by PID" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);

          await withDb(flags, async ({ driver, client }) => {
            if (flags.kill != null) {
              const killed = await driver.killQuery(client, flags.kill as number);
              actionResult(
                flags,
                { pid: flags.kill, terminated: killed },
                killed
                  ? styleSuccess(`Terminated query on PID ${flags.kill}`)
                  : `Failed to terminate PID ${flags.kill} (may have already completed)`,
              );
              return;
            }

            const threshold = (flags.threshold as number | undefined) ?? 5;
            const queries = await driver.listLongQueries(client, threshold);
            if (queries.length === 0) {
              if (f.json) {
                console.log(JSON.stringify({ success: true, data: [] }, null, 2));
              } else {
                console.log(`No queries running longer than ${threshold}s.`);
              }
              return;
            }
            tableOut(flags, queries as unknown as Record<string, unknown>[], [
              "pid", "duration", "user", "database", "query",
            ]);
          });
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
                let applied: Record<string, unknown>[] = [];
                try {
                  applied = await client.query(
                    "SELECT * FROM factory_migrations ORDER BY created_at"
                  );
                } catch {
                  // Table may not exist yet — that's fine, means no migrations applied
                }

                const f = toDxFlags(flags);
                if (f.json) {
                  console.log(JSON.stringify({ success: true, data: { applied } }, null, 2));
                } else {
                  if (applied.length === 0) {
                    console.log("No migrations have been applied yet.");
                  } else {
                    console.log(`${applied.length} migration(s) applied:`);
                    tableOut(flags, applied);
                  }
                }
              });
            })
        )

        .command("up", (s) =>
          s
            .meta({ description: "Run pending migrations" })
            .flags(dbFlags)
            .run(async ({ flags }) => {
              const f = toDxFlags(flags);

              let project: ProjectContext;
              try {
                project = ProjectContext.fromCwd();
              } catch {
                exitWithError(f, "No dx.yaml found.");
              }

              const { url } = resolveDbTarget(project, flags.db as string | undefined);

              const result = spawnSync("bunx", ["drizzle-kit", "migrate"], {
                stdio: "inherit",
                env: { ...process.env, DATABASE_URL: url },
                cwd: project.rootDir,
              });

              if (result.status !== 0) {
                exitWithError(f, "Migration failed.");
              }

              actionResult(flags, { success: true }, styleSuccess("Migrations applied successfully."));
            })
        )

        .command("create", (s) =>
          s
            .meta({ description: "Create a new migration" })
            .args([{ name: "name", type: "string", required: true, description: "Migration name" }])
            .flags(dbFlags)
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags);

              let project: ProjectContext;
              try {
                project = ProjectContext.fromCwd();
              } catch {
                exitWithError(f, "No dx.yaml found.");
              }

              const result = spawnSync("bunx", ["drizzle-kit", "generate", "--name", args.name as string], {
                stdio: "inherit",
                cwd: project.rootDir,
              });

              if (result.status !== 0) {
                exitWithError(f, "Failed to create migration.");
              }
            })
        )

        .command("plan", (s) =>
          s
            .meta({ description: "Show SQL that would run without applying" })
            .flags(dbFlags)
            .run(async ({ flags }) => {
              const f = toDxFlags(flags);

              let project: ProjectContext;
              try {
                project = ProjectContext.fromCwd();
              } catch {
                exitWithError(f, "No dx.yaml found.");
              }

              const { url } = resolveDbTarget(project, flags.db as string | undefined);

              const result = spawnSync("bunx", ["drizzle-kit", "check"], {
                stdio: "inherit",
                env: { ...process.env, DATABASE_URL: url },
                cwd: project.rootDir,
              });

              if (result.status !== 0) {
                exitWithError(f, "Plan check failed.");
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
          seed: { type: "boolean", description: "Run seed after reset (use --no-seed to skip)" },
          force: { type: "boolean", description: "Skip confirmation prompt" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);

          if (!flags.force) {
            exitWithError(f, "This will destroy all data. Use --force to confirm.");
          }

          await withDb(flags, async ({ client, name }) => {
            if (f.verbose) {
              console.log(`Resetting database ${name}…`);
            }

            // Find and drop all user schemas
            const schemas = await client.query(
              "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')"
            );
            for (const row of schemas) {
              await client.query(`DROP SCHEMA ${String(row.schema_name)} CASCADE`);
            }
            await client.query("CREATE SCHEMA public");
            await client.query("GRANT ALL ON SCHEMA public TO PUBLIC");

            actionResult(flags, { reset: true }, styleSuccess("Database reset. Run 'dx db migrate up' to apply migrations."));
          });
        })
    )

    // ── seed ─────────────────────────────────────────────────────────────
    .command("seed", (c) =>
      c
        .meta({ description: "Load seed data into the database" })
        .args([])
        .flags({
          ...dbFlags,
          fixture: { type: "string", description: "Named fixture to load (from seeds/ directory)" },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          let project: ProjectContext;
          try {
            project = ProjectContext.fromCwd();
          } catch {
            exitWithError(f, "No dx.yaml found.");
          }

          const { existsSync } = await import("node:fs");
          const { join } = await import("node:path");

          const fixture = (flags.fixture as string) ?? "default";
          const seedDir = join(project.rootDir, "seeds");
          const sqlFile = join(seedDir, `${fixture}.sql`);

          if (!existsSync(sqlFile)) {
            exitWithError(f, `Seed file not found: ${sqlFile}`);
          }

          const sql = readFileSync(sqlFile, "utf8");

          await withDb(flags, async ({ client }) => {
            await client.query("BEGIN");
            try {
              await client.query(sql);
              await client.query("COMMIT");
            } catch (err) {
              await client.query("ROLLBACK").catch(() => {});
              const msg = err instanceof Error ? err.message : String(err);
              exitWithError(f, `Seed failed (rolled back): ${msg}`);
            }
            actionResult(flags, { seeded: true, fixture }, styleSuccess(`Seed "${fixture}" applied successfully.`));
          });
        })
    );
}
