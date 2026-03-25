import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";

export const factoryAgent = pgSchema("factory_agent");

export const agent = factoryAgent.table(
  "agent",
  {
    agentId: text("agent_id")
      .primaryKey()
      .$defaultFn(() => newId("agt")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    agentType: text("agent_type").notNull(),
    status: text("status").notNull().default("active"),
    capabilities: jsonb("capabilities").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("agent_name_unique").on(t.name),
    uniqueIndex("agent_slug_unique").on(t.slug),
    check(
      "agent_type_valid",
      sql`${t.agentType} IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp')`
    ),
    check(
      "agent_status_valid",
      sql`${t.status} IN ('active', 'disabled')`
    ),
  ]
);

export const agentExecution = factoryAgent.table(
  "agent_execution",
  {
    executionId: text("execution_id")
      .primaryKey()
      .$defaultFn(() => newId("aex")),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.agentId, { onDelete: "cascade" }),
    task: text("task").notNull(),
    status: text("status").notNull().default("pending"),
    costCents: integer("cost_cents"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "agent_execution_status_valid",
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed')`
    ),
  ]
);
