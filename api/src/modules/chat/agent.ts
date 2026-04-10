import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { ToolLoopAgent, stepCountIs, tool } from "ai"
import { getTableConfig } from "drizzle-orm/pg-core"
import type { PgTable } from "drizzle-orm/pg-core"
import pg from "pg"
import { z } from "zod"

import * as buildSchema from "../../db/schema/build-v2"
import * as commerceSchema from "../../db/schema/commerce-v2"
import * as infraSchema from "../../db/schema/infra-v2"
// Schema imports — all v2 ontology tables
import * as orgSchema from "../../db/schema/org-v2"
import * as softwareSchema from "../../db/schema/software-v2"
import { logger } from "../../logger"

const log = logger.child({ module: "chat-agent" })

// ── Schema introspection ──────────────────────────────────────

/** Collect all exported PgTable objects from a schema module. */
function collectTables(mod: Record<string, unknown>): PgTable[] {
  return Object.values(mod).filter(
    (v): v is PgTable =>
      v != null &&
      typeof v === "object" &&
      Symbol.for("drizzle:IsDrizzleTable") in (v as any)
  )
}

/** Generate a compact schema summary for the system prompt. */
function generateSchemaContext(): string {
  const modules: Record<string, Record<string, unknown>> = {
    org: orgSchema,
    software: softwareSchema,
    infra: infraSchema,
    commerce: commerceSchema,
    build: buildSchema,
  }

  const sections: string[] = []

  for (const [label, mod] of Object.entries(modules)) {
    const tables = collectTables(mod)
    if (tables.length === 0) continue

    const tableDescriptions = tables.map((table) => {
      const config = getTableConfig(table)
      const schemaPrefix = config.schema ? `${config.schema}.` : ""
      const pkColNames = new Set(
        config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))
      )
      const cols = config.columns.map((col) => {
        const flags: string[] = []
        if (pkColNames.has(col.name) || col.primary) flags.push("PK")
        if (col.notNull) flags.push("NOT NULL")
        if (col.hasDefault) flags.push("DEFAULT")
        return `    ${col.name} (${col.columnType}${flags.length ? ", " + flags.join(", ") : ""})`
      })

      const fks = config.foreignKeys.map((fk) => {
        const ref = fk.reference()
        const fromCols = ref.columns.map((c) => c.name).join(", ")
        const toCols = ref.foreignColumns.map((c) => c.name).join(", ")
        const toTable = ref.foreignTable
        const toConfig = getTableConfig(toTable as PgTable)
        const toSchemaPrefix = toConfig.schema ? `${toConfig.schema}.` : ""
        return `    FK: (${fromCols}) → ${toSchemaPrefix}${toConfig.name}(${toCols})`
      })

      return [
        `  ${schemaPrefix}${config.name}`,
        ...cols,
        ...(fks.length ? fks : []),
      ].join("\n")
    })

    sections.push(`### ${label}\n${tableDescriptions.join("\n\n")}`)
  }

  return sections.join("\n\n")
}

// Cache the schema context (computed once)
let _schemaContext: string | null = null
function getSchemaContext(): string {
  if (!_schemaContext) {
    _schemaContext = generateSchemaContext()
  }
  return _schemaContext
}

// ── Database pool for agent queries ───────────────────────────

const queryPool = new pg.Pool({
  connectionString:
    process.env.FACTORY_DATABASE_URL ?? process.env.DATABASE_URL,
  max: 3,
  statement_timeout: 30_000,
})

const MAX_ROWS = 100

interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
  fields: string[]
  truncated: boolean
}

interface QueryError {
  error: string
  code?: string
  detail?: string
  hint?: string
}

async function executeSQL(sql: string): Promise<QueryResult | QueryError> {
  // Enforce read-only: only SELECT or WITH (CTE) queries
  const normalized = sql
    .trim()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim()
  const firstWord = normalized.split(/\s/)[0]?.toUpperCase()
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    return {
      error: "Only SELECT queries are allowed. Write operations are forbidden.",
    }
  }

  try {
    const client = await queryPool.connect()
    try {
      await client.query("BEGIN TRANSACTION READ ONLY")
      const result = await client.query(sql)
      await client.query("COMMIT")

      const truncated = (result.rowCount ?? 0) > MAX_ROWS
      return {
        rows: result.rows.slice(0, MAX_ROWS),
        rowCount: result.rowCount ?? 0,
        fields: result.fields.map((f) => f.name),
        truncated,
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {})
      throw err
    } finally {
      client.release()
    }
  } catch (err: unknown) {
    const pgErr = err as {
      message?: string
      code?: string
      detail?: string
      hint?: string
    }
    return {
      error: pgErr.message ?? "Unknown database error",
      code: pgErr.code,
      detail: pgErr.detail,
      hint: pgErr.hint,
    }
  }
}

// ── Tools ─────────────────────────────────────────────────────

const executeQueryTool = tool({
  description:
    "Execute a read-only SQL query against the PostgreSQL database. Returns rows as JSON. Only SELECT queries are allowed.",
  inputSchema: z.object({
    sql: z.string().describe("The SQL query to execute (SELECT only)"),
    explanation: z
      .string()
      .describe("Brief explanation of what this query does and why"),
  }),
  execute: async ({ sql, explanation }) => {
    log.info(
      { sql: sql.slice(0, 200), explanation },
      "Executing agent SQL query"
    )
    return await executeSQL(sql)
  },
})

const listTablesTool = tool({
  description:
    "List tables and their columns from the database. Use this to discover tables beyond what is in the schema summary, or to get exact column details.",
  inputSchema: z.object({
    schemaName: z
      .string()
      .optional()
      .describe(
        "Filter to a specific schema (org, software, infra, commerce, build, ops). Omit to list all schemas."
      ),
  }),
  execute: async ({ schemaName }) => {
    const allowedSchemas = [
      "org",
      "software",
      "infra",
      "commerce",
      "build",
      "ops",
    ]
    if (schemaName && !allowedSchemas.includes(schemaName)) {
      return {
        error: `Invalid schema. Must be one of: ${allowedSchemas.join(", ")}`,
      } as QueryError
    }

    // Safe: values are from the allowlist, not user input
    const schemas = schemaName ? [schemaName] : allowedSchemas
    const inClause = schemas.map((s) => `'${s}'`).join(", ")

    const result = await executeSQL(`
      SELECT
        t.table_schema,
        t.table_name,
        string_agg(c.column_name || ' (' || c.data_type || ')', ', ' ORDER BY c.ordinal_position) AS columns
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema IN (${inClause})
      GROUP BY t.table_schema, t.table_name
      ORDER BY t.table_schema, t.table_name
    `)
    return result
  },
})

// ── Agent ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const schemaContext = getSchemaContext()

  return `You are Factory Bot, an assistant for a software company's internal platform called Factory.

You can query the company's PostgreSQL database to answer questions about teams, software systems, components, releases, agents, infrastructure, customers, and more.

## Available tools

1. **executeQuery** — Run a read-only SQL query. Only SELECT statements are allowed.
2. **listTables** — Discover tables and columns from information_schema.

## Database schema summary

The database uses named schemas: org, software, infra, commerce, build.
Many tables have JSONB columns named \`spec\` and \`metadata\` — use \`->\` and \`->>\` operators to access nested fields.
Many tables use bitemporal columns (valid_from, valid_to, system_from, system_to). Current/active rows typically have \`valid_to IS NULL\`.

${schemaContext}

## How to work

1. Review the schema summary above to understand available tables and columns.
2. If you need more detail, use \`listTables\` to get exact column types.
3. Write and execute SQL queries to answer the user's question.
4. If a query fails, read the error, check the schema, and retry with a corrected query.

## Response style

- Be concise and direct — this is Slack, not a report.
- Lead with the answer, then briefly mention what you queried.
- Format numbers nicely (e.g. 1,234 systems, 12 teams).
- Use plain text, not markdown tables (Slack doesn't render them well).
- For lists, use bullet points or numbered lists.`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _agentPromise: Promise<any> | null = null

export function getAgent() {
  if (!_agentPromise) {
    _agentPromise = (async () => {
      const apiKey =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.LLM_API_KEY
      if (!apiKey) {
        throw new Error(
          "GOOGLE_GENERATIVE_AI_API_KEY or LLM_API_KEY must be set for chat agent"
        )
      }

      const google = createGoogleGenerativeAI({ apiKey })
      const model = google(
        process.env.LLM_MODEL ?? "gemini-2.5-flash"
      )

      return new ToolLoopAgent({
        model,
        instructions: buildSystemPrompt(),
        tools: {
          executeQuery: executeQueryTool,
          listTables: listTablesTool,
        },
        stopWhen: stepCountIs(10),
      })
    })().catch((err) => {
      _agentPromise = null // Allow retry on next call
      throw err
    })
  }
  return _agentPromise
}
