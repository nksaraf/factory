/**
 * PowerSync database singleton — creates and manages the PowerSync client instance.
 */
import { PowerSyncDatabase } from "@powersync/web"

import { AppSchema } from "./schema"

let db: PowerSyncDatabase | null = null

export function getPowerSyncDatabase(): PowerSyncDatabase {
  if (!db) {
    db = new PowerSyncDatabase({
      database: { dbFilename: "factory.db" },
      schema: AppSchema,
    })
  }
  return db
}
