/**
 * Thin wrapper — delegates to the CLI's ingest sender so auth logic
 * (JWT refresh via set-auth-jwt header, @crustjs/store config) lives in one place.
 *
 * IMPORTANT: This file depends on cli/src/lib/ingest/send.ts via relative import.
 * This works because hook scripts are run with `bun` from the repo root, which
 * resolves cross-directory TS imports. If the CLI path ever changes, update the
 * import below.
 *
 * Never throws. Never blocks longer than 5 seconds. Never crashes the IDE.
 */
import {
  type IngestEvent,
  sendEvent,
} from "../../../cli/src/lib/ingest/send.js"

export async function sendHookEvent(event: IngestEvent): Promise<void> {
  try {
    await sendEvent(event)
  } catch {
    // Silent failure — never crash the IDE
  }
}
