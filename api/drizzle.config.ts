import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.FACTORY_DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/postgres",
  },
  migrations: {
    table: "factory_migrations",
    schema: "public",
  },
})
