/**
 * Fleet workbench service — registration, pings, and queries.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { fleetWorkbench } from "../../db/schema/fleet";

export class WorkbenchService {
  constructor(private db: Database) {}

  /** Register or update a workbench (upsert on workbenchId). */
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
    const [row] = await this.db
      .insert(fleetWorkbench)
      .values({
        workbenchId: data.workbenchId,
        type: data.type,
        hostname: data.hostname,
        ips: data.ips,
        os: data.os,
        arch: data.arch,
        dxVersion: data.dxVersion,
        principalId: data.principalId ?? null,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: fleetWorkbench.workbenchId,
        set: {
          type: data.type,
          hostname: data.hostname,
          ips: data.ips,
          os: data.os,
          arch: data.arch,
          dxVersion: data.dxVersion,
          principalId: data.principalId ?? undefined,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /** Update ping timestamp and last command. */
  async ping(workbenchId: string, data: { command: string; dxVersion: string }) {
    const now = new Date();
    const [row] = await this.db
      .update(fleetWorkbench)
      .set({
        lastPingAt: now,
        lastCommand: data.command,
        dxVersion: data.dxVersion,
        updatedAt: now,
      })
      .where(eq(fleetWorkbench.workbenchId, workbenchId))
      .returning();
    return row ?? null;
  }

  /** List workbenches with optional type filter and derived status. */
  async list(filters?: { type?: string }) {
    let query = this.db.select().from(fleetWorkbench);

    if (filters?.type) {
      query = query.where(eq(fleetWorkbench.type, filters.type)) as typeof query;
    }

    const rows = await query;

    return rows.map((row) => ({
      ...row,
      status: deriveStatus(row.lastPingAt),
    }));
  }

  /** Get a single workbench by ID. */
  async get(workbenchId: string) {
    const [row] = await this.db
      .select()
      .from(fleetWorkbench)
      .where(eq(fleetWorkbench.workbenchId, workbenchId));

    if (!row) return null;
    return { ...row, status: deriveStatus(row.lastPingAt) };
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
