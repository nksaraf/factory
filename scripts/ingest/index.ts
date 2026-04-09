#!/usr/bin/env bun
/**
 * Backfill AI chat histories into Factory webhook_events.
 *
 * Usage:
 *   bun run scripts/ingest/index.ts claude-code [--since 2026-01-01] [--dry-run] [--limit 100] [--verbose]
 *   bun run scripts/ingest/index.ts conductor [--since 2026-01-01] [--dry-run]
 *   bun run scripts/ingest/index.ts cursor [--since 2026-01-01] [--dry-run]
 *   bun run scripts/ingest/index.ts all [--since 2026-01-01] [--dry-run]
 */

import { parseArgs } from "./lib/common"
import { ingestClaudeCode } from "./claude-code"
import { ingestConductor } from "./conductor"
import { ingestCursor } from "./cursor"

const SOURCES = {
  "claude-code": ingestClaudeCode,
  conductor: ingestConductor,
  cursor: ingestCursor,
} as const

async function main() {
  const args = process.argv.slice(2)
  const source = args[0]

  if (!source || source === "--help") {
    console.error(`
Usage: bun run scripts/ingest/index.ts <source> [options]

Sources:
  claude-code    Parse ~/.claude/projects/ JSONL session files
  conductor      Parse Conductor SQLite database
  cursor         Parse Cursor AI tracking database
  all            Run all sources

Options:
  --since <date>   Only process sessions after this date (ISO format)
  --dry-run        Print events to stdout instead of sending
  --limit <n>      Maximum number of events to ingest
  --verbose        Print each event as it's processed
`)
    process.exit(source ? 0 : 1)
  }

  const opts = parseArgs(args.slice(1))

  console.error(`=== AI Chat History Backfill ===`)
  if (opts.since) console.error(`Since: ${opts.since.toISOString()}`)
  if (opts.dryRun) console.error(`Mode: DRY RUN`)
  if (opts.limit < Infinity) console.error(`Limit: ${opts.limit}`)
  console.error()

  if (source === "all") {
    for (const [name, fn] of Object.entries(SOURCES)) {
      console.error(`\n--- ${name} ---`)
      try {
        await fn(opts)
      } catch (err) {
        console.error(`[error] ${name}: ${err}`)
      }
    }
  } else if (source in SOURCES) {
    await SOURCES[source as keyof typeof SOURCES](opts)
  } else {
    console.error(`Unknown source: ${source}. Use claude-code, conductor, cursor, or all.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
