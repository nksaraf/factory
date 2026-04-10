/**
 * Module-level DB accessor for chat handlers.
 *
 * Same pattern as workflow-helpers.ts — call setChatDb(db) at boot,
 * then getChatDb() from within handlers.
 */
import type { Database } from "../../db/connection"

let _db: Database | null = null

export function setChatDb(db: Database) {
  _db = db
}

export function getChatDb(): Database {
  if (!_db)
    throw new Error("Chat DB not initialized — call setChatDb(db) at boot")
  return _db
}
