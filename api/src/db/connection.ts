import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/node-postgres"

import * as schema from "./schema"

export { schema }
export * from "drizzle-orm/node-postgres"

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export const connection = (url: string) => drizzle(url, { schema })

export type Connection = ReturnType<typeof connection>
