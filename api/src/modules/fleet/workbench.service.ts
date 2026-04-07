/**
 * Fleet workbench service — registration, pings, and queries.
 * v2: uses ops.workbench with spec JSONB.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { workbench } from "../../db/schema/ops";
import { allocateSlug } from "../../lib/slug";
import type { WorkbenchSpec } from "@smp/factory-shared/schemas/ops";

export class WorkbenchService {
  constructor(private db: Database) {}

  /** Register or update a workbench (upsert on slug derived from workbenchId). */
  async register(data: {
    workbenchId: string;
    type: string;
    hostname: string;
    ips: string[];
    os: string;
    arch: string;
    dxVersion: string;
    principalId?: string;
  }) {
    const now = new Date();

    // Check if workbench already exists by matching workbenchId in spec
    const existing = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.slug, data.workbenchId))
      .limit(1);

    const specData: Partial<WorkbenchSpec> & Pick<WorkbenchSpec, "machineId" | "hostname" | "os"> = {
      machineId: data.workbenchId,
      hostname: data.hostname,
      os: data.os,
      arch: data.arch,
      lastSeenAt: now,
    };

    if (existing[0]) {
      const oldSpec = (existing[0].spec ?? {}) as WorkbenchSpec;
      const [row] = await this.db
        .update(workbench)
        .set({
          type: data.type,
          spec: { ...oldSpec, ...specData },
          updatedAt: now,
        })
        .where(eq(workbench.id, existing[0].id))
        .returning();
      return row;
    }

    const slug = await allocateSlug({
      baseLabel: data.workbenchId,
      explicitSlug: data.workbenchId,
      isTaken: async (s) => {
        const [r] = await this.db
          .select({ id: workbench.id })
          .from(workbench)
          .where(eq(workbench.slug, s))
          .limit(1);
        return !!r;
      },
    });

    const [row] = await this.db
      .insert(workbench)
      .values({
        slug,
        name: data.hostname || data.workbenchId,
        type: data.type,
        spec: specData as WorkbenchSpec,
      })
      .returning();
    return row;
  }

  /** Update ping timestamp and last command. */
  async ping(workbenchId: string, data: { command: string; dxVersion: string }) {
    const now = new Date();
    const [existing] = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.slug, workbenchId))
      .limit(1);
    if (!existing) return null;

    const spec = (existing.spec ?? {}) as WorkbenchSpec;
    const [row] = await this.db
      .update(workbench)
      .set({
        spec: {
          ...spec,
          lastSeenAt: now,
        },
        updatedAt: now,
      })
      .where(eq(workbench.id, existing.id))
      .returning();
    return row ?? null;
  }

  /** List workbenches with optional type filter and derived status. */
  async list(filters?: { type?: string }) {
    let query = this.db.select().from(workbench);

    if (filters?.type) {
      query = query.where(eq(workbench.type, filters.type)) as typeof query;
    }

    const rows = await query;

    return rows.map((row) => {
      const spec = (row.spec ?? {}) as WorkbenchSpec;
      return {
        ...row,
        status: deriveStatus(spec.lastSeenAt ? new Date(spec.lastSeenAt) : null),
      };
    });
  }

  /** Get a single workbench by ID or slug. */
  async get(workbenchId: string) {
    const [row] = await this.db
      .select()
      .from(workbench)
      .where(eq(workbench.slug, workbenchId));

    if (!row) return null;
    const spec = (row.spec ?? {}) as WorkbenchSpec;
    return { ...row, status: deriveStatus(spec.lastSeenAt ? new Date(spec.lastSeenAt) : null) };
  }
}

/** Derive workbench status from last ping timestamp. */
function deriveStatus(lastPingAt: Date | null): "online" | "stale" | "offline" | "never" {
  if (!lastPingAt) return "never";
  const ageMs = Date.now() - lastPingAt.getTime();
  if (ageMs < 10 * 60 * 1000) return "online";   // < 10 min
  if (ageMs < 60 * 60 * 1000) return "stale";     // < 1 hr
  return "offline";
}
