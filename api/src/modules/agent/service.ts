import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { agent, rolePreset } from "../../db/schema/agent";
import { allocateSlug } from "../../lib/slug";
import { getRolePreset } from "./preset.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateAgentInput = {
  name: string;
  slug?: string;
  agentType?: string;
  rolePresetSlug?: string;
  autonomyLevel?: string;
  relationship?: string;
  relationshipEntityId?: string;
  collaborationMode?: string;
  reportsToAgentId?: string;
  principalId?: string;
  capabilities?: Record<string, unknown>;
  config?: Record<string, unknown>;
  guardrails?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listAgents(
  db: Database,
  filters?: { status?: string; relationship?: string; rolePresetSlug?: string },
) {
  let query = db.select().from(agent);
  if (filters?.status) {
    query = query.where(eq(agent.status, filters.status)) as typeof query;
  }
  if (filters?.relationship) {
    query = query.where(eq(agent.relationship, filters.relationship)) as typeof query;
  }
  if (filters?.rolePresetSlug) {
    query = query.where(eq(agent.rolePresetSlug, filters.rolePresetSlug)) as typeof query;
  }
  const rows = await query;
  return { data: rows, total: rows.length };
}

export async function getAgent(db: Database, idOrSlug: string) {
  let rows = await db
    .select()
    .from(agent)
    .where(eq(agent.agentId, idOrSlug));
  if (rows.length === 0) {
    rows = await db
      .select()
      .from(agent)
      .where(eq(agent.slug, idOrSlug));
  }
  return rows[0] ?? null;
}

export async function createAgent(db: Database, data: CreateAgentInput) {
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug: data.slug,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(agent)
        .where(eq(agent.slug, s));
      return existing.length > 0;
    },
  });

  // Resolve preset defaults if specified
  let presetDefaults: Record<string, unknown> = {};
  if (data.rolePresetSlug) {
    const preset = await getRolePreset(db, data.rolePresetSlug);
    if (preset) {
      presetDefaults = (preset.defaults as Record<string, unknown>) ?? {};
    }
  }

  const rows = await db
    .insert(agent)
    .values({
      name: data.name,
      slug,
      agentType: data.agentType ?? (presetDefaults.agentType as string) ?? "engineering",
      rolePresetSlug: data.rolePresetSlug ?? null,
      autonomyLevel:
        data.autonomyLevel ??
        (presetDefaults.autonomyLevel as string) ??
        "executor",
      relationship:
        data.relationship ??
        (presetDefaults.relationship as string) ??
        "team",
      relationshipEntityId: data.relationshipEntityId ?? null,
      collaborationMode:
        data.collaborationMode ??
        (presetDefaults.collaborationMode as string) ??
        "solo",
      reportsToAgentId: data.reportsToAgentId ?? null,
      principalId: data.principalId ?? null,
      capabilities: data.capabilities ?? (presetDefaults.capabilities as Record<string, unknown>) ?? {},
      config: data.config ?? {},
      guardrails: data.guardrails ?? (presetDefaults.guardrails as Record<string, unknown>) ?? {},
    })
    .returning();
  return rows[0];
}

export async function updateAgent(
  db: Database,
  agentId: string,
  data: {
    name?: string;
    status?: string;
    rolePresetSlug?: string;
    autonomyLevel?: string;
    relationship?: string;
    relationshipEntityId?: string;
    collaborationMode?: string;
    reportsToAgentId?: string;
    capabilities?: Record<string, unknown>;
    config?: Record<string, unknown>;
    trustScore?: number;
    guardrails?: Record<string, unknown>;
  },
) {
  const rows = await db
    .update(agent)
    .set(data)
    .where(eq(agent.agentId, agentId))
    .returning();
  return rows[0] ?? null;
}

export async function deleteAgent(db: Database, agentId: string) {
  const rows = await db
    .update(agent)
    .set({ status: "disabled" })
    .where(eq(agent.agentId, agentId))
    .returning();
  return rows[0] ?? null;
}
