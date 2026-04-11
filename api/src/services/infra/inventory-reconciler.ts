/**
 * Inventory reconciler — upserts entities declared in YAML/static inventory files.
 *
 * Uses ONTOLOGY_REGISTRY to resolve tables, prefixes, and slug-refs.
 * Processes entities in dependency order, resolves slug-refs against DB and
 * current-batch context, then upserts each entity.
 */
import { eq, getTableColumns } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { newId } from "../../lib/id"
import { ONTOLOGY_REGISTRY } from "../../lib/ontology-registry"
import type { InventoryReconciliationSummary } from "@smp/factory-shared/schemas/inventory"

// Topological kind order — earlier kinds can be referenced by later ones
const KIND_ORDER = [
  // Foundations
  "estate", "team", "principal", "scope", "system", "product", "customer", "plan",
  // Depend on foundations
  "host", "realm", "service", "site", "tenant", "component", "repo",
  "git-host-provider", "work-tracker-provider", "work-tracker-project",
  "agent", "role-preset", "channel", "document", "billable-metric",
  // Depend on previous tier
  "route", "dns-domain", "secret", "workbench", "system-deployment",
  "deployment-set", "release", "api", "artifact", "template", "capability",
  "subscription", "messaging-provider", "config-var",
  // Final tier — ip-address before network-link (NAT links target ip-addresses)
  "ip-address", "network-link", "tunnel",
  "component-deployment", "rollout", "preview", "intervention",
  "database", "forwarded-port", "thread", "thread-turn",
  "entity-relationship", "job", "memory",
]

type EntityDecl = { kind: string; id?: string; slug?: string; address?: string; [key: string]: unknown }

/** Derive the drizzle table name (used as a stable cache key namespace). */
function tableName(table: any): string {
  return String(table[Symbol.for("drizzle:Name")] ?? table)
}

async function _reconcile(
  db: Database,
  entities: EntityDecl[],
): Promise<InventoryReconciliationSummary> {
  const summary: InventoryReconciliationSummary = {
    dryRun: false,
    byKind: {},
    errors: [],
  }

  // Track `${tableName}:${slug}` → id for entities inserted in this batch
  // (enables cross-entity slug-ref resolution within the same file)
  const batchIdCache = new Map<string, string>()

  // Group by kind
  const byKind = new Map<string, EntityDecl[]>()
  for (const e of entities) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, [])
    byKind.get(e.kind)!.push(e)
  }

  // Process in topological order
  const orderedKinds = [
    ...KIND_ORDER.filter((k) => byKind.has(k)),
    ...Array.from(byKind.keys()).filter((k) => !KIND_ORDER.includes(k)),
  ]

  for (const kind of orderedKinds) {
    const kindEntities = byKind.get(kind) ?? []
    const cfg = ONTOLOGY_REGISTRY.get(kind)
    if (!cfg) {
      for (const e of kindEntities) {
        summary.errors.push({ kind, slug: String(e.slug ?? e.id ?? "?"), error: `Unknown kind "${kind}"` })
      }
      continue
    }

    if (!summary.byKind[kind]) summary.byKind[kind] = { created: 0, updated: 0, unchanged: 0 }
    const kindSummary = summary.byKind[kind]
    const ownTableName = tableName(cfg.table)
    const tableHasUpdatedAt = "updatedAt" in getTableColumns(cfg.table)

    for (const entity of kindEntities) {
      const entitySlug = String(entity.slug ?? entity.address ?? entity.id ?? "?")
      try {
        // Resolve slug-refs: {field}Slug → {field}Id
        const resolved: Record<string, unknown> = {}
        let slugRefFailed = false
        for (const [k, v] of Object.entries(entity)) {
          if (k === "kind" || k === "id") continue
          if (k.endsWith("Slug") && cfg.slugRefs?.[k]) {
            const refCfg = cfg.slugRefs[k]
            const refSlug = String(v)
            // Use table name as consistent cache key namespace (matches batch write below)
            const cacheKey = `${tableName(refCfg.lookupTable)}:${refSlug}`
            let refId: string | null = batchIdCache.get(cacheKey) ?? null
            if (!refId) {
              const rows = await db
                .select({ id: refCfg.lookupIdCol })
                .from(refCfg.lookupTable)
                .where(eq(refCfg.lookupSlugCol, refSlug))
                .limit(1)
              refId = (rows[0] as any)?.id ?? null
            }
            if (!refId) {
              summary.errors.push({ kind, slug: entitySlug, error: `${k}: slug "${refSlug}" not found` })
              slugRefFailed = true
            } else {
              resolved[refCfg.fk] = refId
            }
          } else if (!k.endsWith("Slug")) {
            resolved[k] = v
          }
        }
        // Skip insert/update if any required slug-ref couldn't be resolved —
        // attempting an insert with a missing FK column causes PostgreSQL to abort
        // the entire transaction, breaking all subsequent operations.
        if (slugRefFailed) continue

        // network-link dynamic slug resolution (source/via/target resolved by kind)
        let dynamicSlugFailed = false
        if (kind === "network-link") {
          const endpoints = [
            { slugField: "sourceSlug", kindField: "sourceKind", idField: "sourceId", required: true },
            { slugField: "viaSlug",    kindField: "viaKind",    idField: "viaId",    required: false },
            { slugField: "targetSlug", kindField: "targetKind", idField: "targetId", required: true },
          ] as const
          for (const { slugField, kindField, idField, required } of endpoints) {
            if (entity[slugField] && entity[kindField]) {
              const refKind = String(entity[kindField])
              const refSlug = String(entity[slugField])
              const refCfg = ONTOLOGY_REGISTRY.get(refKind)
              if (refCfg) {
                const cacheKey = `${tableName(refCfg.table)}:${refSlug}`
                let refId: string | null = batchIdCache.get(cacheKey) ?? null
                if (!refId) {
                  const rows = await db.select({ id: refCfg.idColumn })
                    .from(refCfg.table)
                    .where(eq(refCfg.slugColumn, refSlug))
                    .limit(1)
                  refId = (rows[0] as any)?.id ?? null
                }
                if (!refId && required) {
                  summary.errors.push({ kind, slug: entitySlug, error: `${slugField}: "${refSlug}" not found in "${refKind}"` })
                  dynamicSlugFailed = true
                } else if (refId) {
                  resolved[idField] = refId
                }
              }
              delete resolved[slugField]
            }
          }
          if (dynamicSlugFailed) continue
        }

        // Upsert by slug (or address for ip-address)
        const lookupValue = entity.slug ?? entity.address
        if (!lookupValue) {
          summary.errors.push({ kind, slug: entitySlug, error: "No slug or address for lookup" })
          continue
        }

        const existing = await db
          .select({ id: cfg.idColumn })
          .from(cfg.table)
          .where(eq(cfg.slugColumn, String(lookupValue)))
          .limit(1)

        if (existing.length > 0) {
          const existingId = (existing[0] as any).id as string
          const updateValues = tableHasUpdatedAt
            ? { ...resolved, updatedAt: new Date() }
            : resolved
          await db
            .update(cfg.table)
            .set(updateValues as any)
            .where(eq(cfg.idColumn, existingId))
          batchIdCache.set(`${ownTableName}:${entitySlug}`, existingId)
          kindSummary.updated++
        } else {
          const newEntityId = entity.id ?? (cfg.prefix ? newId(cfg.prefix) : crypto.randomUUID())
          await db.insert(cfg.table).values({ id: newEntityId, ...resolved } as any)
          batchIdCache.set(`${ownTableName}:${entitySlug}`, String(newEntityId))
          kindSummary.created++
        }
      } catch (err: any) {
        summary.errors.push({ kind, slug: entitySlug, error: err?.message ?? String(err) })
      }
    }
  }

  return summary
}

export async function reconcileInventory(
  db: Database,
  entities: EntityDecl[],
  dryRun = false,
): Promise<InventoryReconciliationSummary> {
  if (dryRun) {
    let summary: InventoryReconciliationSummary | undefined
    try {
      await db.transaction(async (tx) => {
        summary = await _reconcile(tx as unknown as Database, entities)
        // Intentionally throw to rollback
        throw Object.assign(new Error("__dryRun__"), { __dryRun: true })
      })
    } catch (err: any) {
      if (!err.__dryRun) throw err
    }
    return { ...summary!, dryRun: true }
  }
  return _reconcile(db, entities)
}
