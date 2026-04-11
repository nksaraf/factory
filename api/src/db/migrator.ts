import path from "node:path"

export * from "drizzle-orm/node-postgres/migrator"

export const migrationsDir = path.join(process.cwd(), "drizzle")
