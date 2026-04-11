#!/usr/bin/env bun
/**
 * Direct DB backfill — bypasses HTTP, inserts events straight into webhook_event table.
 * Usage: DATABASE_URL="postgresql://..." bun run scripts/ingest/backfill-direct.ts [--verbose]
 */
import { drizzle } from "drizzle-orm/node-postgres"
// Import the parsers (but we'll collect events, not send them via HTTP)
import { readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import { webhookEvent } from "../../api/src/db/schema/org"
import { newId } from "../../api/src/lib/id"
import { type IngestEvent, parseArgs } from "./lib/common"

const dbUrl =
  process.env.DATABASE_URL ??
  process.env.FACTORY_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/postgres"

const db = drizzle(dbUrl)

async function main() {
  const args = process.argv.slice(2)
  const opts = parseArgs(args)

  console.error("=== Direct DB Backfill ===")
  console.error(`Database: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`)

  // Dynamically import and run each source's parser to collect events
  // We'll use the existing ingest functions in dry-run mode to collect events,
  // then insert them directly into the DB

  const allEvents: IngestEvent[] = []

  // Claude Code
  console.error("\n--- claude-code ---")
  const { ingestClaudeCode } = await import("./claude-code")
  const ccEvents = await collectEvents(ingestClaudeCode, {
    ...opts,
    dryRun: true,
  })
  allEvents.push(...ccEvents)
  console.error(`Collected ${ccEvents.length} claude-code events`)

  // Conductor
  console.error("\n--- conductor ---")
  const { ingestConductor } = await import("./conductor")
  const condEvents = await collectEvents(ingestConductor, {
    ...opts,
    dryRun: true,
  })
  allEvents.push(...condEvents)
  console.error(`Collected ${condEvents.length} conductor events`)

  // Cursor
  console.error("\n--- cursor ---")
  const { ingestCursor } = await import("./cursor")
  const cursorEvents = await collectEvents(ingestCursor, {
    ...opts,
    dryRun: true,
  })
  allEvents.push(...cursorEvents)
  console.error(`Collected ${cursorEvents.length} cursor events`)

  console.error(`\nTotal events: ${allEvents.length}`)

  // Insert in batches
  const BATCH_SIZE = 100
  let inserted = 0
  let duplicates = 0
  let errors = 0

  for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
    const batch = allEvents.slice(i, i + BATCH_SIZE)
    for (const event of batch) {
      try {
        await db.insert(webhookEvent).values({
          source: event.source,
          providerId: event.providerId,
          deliveryId: event.deliveryId,
          eventType: event.eventType,
          actorId: "system-backfill",
          spec: {
            payload: event.payload,
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            cwd: event.cwd,
            project: event.project,
          } as any,
        })
        inserted++
      } catch (err: any) {
        if (err.message?.includes("duplicate") || err.code === "23505") {
          duplicates++
        } else {
          errors++
          if (opts.verbose)
            console.error(`  [err] ${event.deliveryId}: ${err.message}`)
        }
      }
    }
    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= allEvents.length) {
      console.error(
        `  Progress: ${Math.min(i + BATCH_SIZE, allEvents.length)}/${allEvents.length} (${inserted} inserted, ${duplicates} dups, ${errors} errors)`
      )
    }
  }

  console.error(`\n=== Done ===`)
  console.error(`Inserted: ${inserted}`)
  console.error(`Duplicates: ${duplicates}`)
  console.error(`Errors: ${errors}`)
}

/**
 * Capture events from an ingest function by temporarily hijacking console.log
 * (dry-run mode prints JSON to stdout).
 */
async function collectEvents(
  ingestFn: (opts: any) => Promise<any>,
  opts: any
): Promise<IngestEvent[]> {
  const events: IngestEvent[] = []
  const origLog = console.log
  console.log = (...args: any[]) => {
    for (const arg of args) {
      if (typeof arg === "string") {
        try {
          const parsed = JSON.parse(arg)
          if (parsed.source && parsed.eventType && parsed.deliveryId) {
            events.push(parsed)
          }
        } catch {}
      }
    }
  }
  try {
    await ingestFn(opts)
  } finally {
    console.log = origLog
  }
  return events
}

main().catch((err) => {
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
