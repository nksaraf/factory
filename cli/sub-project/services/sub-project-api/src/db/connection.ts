import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index";

export const db = drizzle(
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
  { schema },
);

export type Database = typeof db;
