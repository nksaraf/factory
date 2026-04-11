/**
 * Inventory exporter — reads live DB entities and converts them back into
 * the declarative YAML-compatible format used by `dx scan --file`.
 *
 * FK IDs are resolved back to slug references so the exported files are
 * self-describing and portable (no raw UUIDs in YAML).
 */
import { asc } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { ONTOLOGY_REGISTRY } from "../../lib/ontology-registry"

/** Top-level columns that are internal and should not appear in exported YAML. */
const OMIT_COLUMNS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "generation",
  "observedGeneration",
  "metadata",
  // Temporal / bitemporal columns (org entities)
  "validFrom",
  "validTo",
  "systemFrom",
  "systemTo",
  "changedBy",
  // FK ID columns resolved to slug refs for network-link dynamic endpoints
  "viaId",
])

/** Spec-level fields that contain secrets — replaced with $secret() placeholder. */
const SECRET_SPEC_FIELDS = new Set([
  "tokenSecret",
  "credentialsRef",
  "apiKeyRef",
  "botToken",
  "signingSecret",
  "workspaceId",
  "connectionString",
  "kubeconfigRef",
])

/** Spec-level fields that represent operational/sync state — omitted from export. */
const OMIT_SPEC_FIELDS = new Set([
  "syncStatus",
  "syncError",
  "lastSyncAt",
])

/**
 * Redact secrets and strip operational state from a spec object.
 * Returns a new object safe for version-controlled YAML.
 */
function sanitizeSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec)) {
    if (v === null || v === undefined) continue
    if (OMIT_SPEC_FIELDS.has(k)) continue
    if (SECRET_SPEC_FIELDS.has(k)) {
      out[k] = `$secret(${k})`
      continue
    }
    // Recurse into nested objects (e.g. spec.metadata)
    if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = sanitizeSpec(v as Record<string, unknown>)
      if (Object.keys(nested).length > 0) out[k] = nested
      continue
    }
    out[k] = v
  }
  return out
}

/**
 * Exported entity grouping — one per kind, suitable for serializing to
 * `version: "1"\nentities: [...]` YAML files.
 */
export interface ExportedKind {
  kind: string
  /** Plural entity name for use in filenames (e.g. "ip-addresses") */
  entity: string
  entities: Record<string, unknown>[]
}

/**
 * Config for exporting a single entity kind.
 * Mirrors what ONTOLOGY_REGISTRY contains plus the inverse FK mapping.
 */
interface ExportKindConfig {
  /** Registry kind key (e.g. "estate", "host") */
  kind: string
  /** FK column names on this entity that should be slug-resolved */
  fkToSlugRef: Record<
    string,
    {
      slugRefField: string // what to name the output field (e.g. "parentEstateSlug")
      lookupKind: string   // which kind's id→slug map to use
    }
  >
  /** Dynamic source/target for network-link */
  dynamicEndpoints?: boolean
}

const EXPORT_CONFIGS: ExportKindConfig[] = [
  // ── Infra ─────────────────────────────────────────────────────
  {
    kind: "estate",
    fkToSlugRef: {
      parentEstateId: { slugRefField: "parentEstateSlug", lookupKind: "estate" },
    },
  },
  {
    kind: "host",
    fkToSlugRef: {
      estateId: { slugRefField: "estateSlug", lookupKind: "estate" },
      realmId: { slugRefField: "realmSlug", lookupKind: "realm" },
    },
  },
  {
    kind: "realm",
    fkToSlugRef: {
      estateId: { slugRefField: "estateSlug", lookupKind: "estate" },
      parentRealmId: { slugRefField: "parentRealmSlug", lookupKind: "realm" },
    },
  },
  {
    kind: "service",
    fkToSlugRef: {
      estateId: { slugRefField: "estateSlug", lookupKind: "estate" },
      realmId: { slugRefField: "realmSlug", lookupKind: "realm" },
    },
  },
  {
    kind: "dns-domain",
    fkToSlugRef: {},
  },
  {
    kind: "ip-address",
    fkToSlugRef: {
      subnetId: { slugRefField: "subnetSlug", lookupKind: "estate" },
    },
  },
  {
    kind: "network-link",
    fkToSlugRef: {},
    dynamicEndpoints: true,
  },
  {
    kind: "route",
    fkToSlugRef: {
      estateId: { slugRefField: "estateSlug", lookupKind: "estate" },
      realmId: { slugRefField: "realmSlug", lookupKind: "realm" },
    },
  },
  // ── Identity / Org ────────────────────────────────────────────
  {
    kind: "team",
    fkToSlugRef: {
      parentTeamId: { slugRefField: "parentTeamSlug", lookupKind: "team" },
    },
  },
  {
    kind: "principal",
    fkToSlugRef: {
      teamId: { slugRefField: "teamSlug", lookupKind: "team" },
    },
  },
]

/** All kinds we build slug maps for (needed as FK targets). */
const SLUG_MAP_KINDS = ["estate", "realm", "host", "team", "principal", "ip-address"]

export async function exportInventory(
  db: Database,
  kindsFilter?: string[],
): Promise<ExportedKind[]> {
  const targetKinds = kindsFilter?.length
    ? EXPORT_CONFIGS.filter((c) => kindsFilter.includes(c.kind))
    : EXPORT_CONFIGS

  // ── 1. Build id→slug maps for all referenced kinds ──────────
  const slugMaps = new Map<string, Map<string, string>>() // kind → (id → slug)

  for (const k of SLUG_MAP_KINDS) {
    const cfg = ONTOLOGY_REGISTRY.get(k)
    if (!cfg) continue
    const rows = await db.select().from(cfg.table)
    const map = new Map<string, string>()
    for (const row of rows as any[]) {
      // ip-address uses address as its "slug"
      const slug = row.slug ?? row.address ?? row.id
      if (row.id && slug) map.set(String(row.id), String(slug))
    }
    slugMaps.set(k, map)
  }

  // Also build id→kind map for network-link dynamic resolution
  const idToKindAndSlug = new Map<string, { kind: string; slug: string }>()
  for (const [kind, map] of slugMaps) {
    for (const [id, slug] of map) {
      idToKindAndSlug.set(id, { kind, slug })
    }
  }

  // ── 2. Fetch and convert each kind ───────────────────────────
  const results: ExportedKind[] = []

  for (const exportCfg of targetKinds) {
    const registryCfg = ONTOLOGY_REGISTRY.get(exportCfg.kind)
    if (!registryCfg) continue

    const rows = await db
      .select()
      .from(registryCfg.table)
      .orderBy(asc(registryCfg.slugColumn))

    const entities: Record<string, unknown>[] = []

    for (const row of rows as any[]) {
      const out: Record<string, unknown> = { kind: exportCfg.kind }

      // Copy non-omitted fields, resolving FKs → slug refs
      for (const [col, val] of Object.entries(row)) {
        if (val === null || val === undefined) continue
        if (OMIT_COLUMNS.has(col)) continue

        const fkCfg = exportCfg.fkToSlugRef[col]
        if (fkCfg) {
          // Resolve ID → slug
          const slug = slugMaps.get(fkCfg.lookupKind)?.get(String(val))
          if (slug) out[fkCfg.slugRefField] = slug
          // If we can't resolve, skip the FK (entity may be orphaned)
          continue
        }

        // Sanitize spec objects (redact secrets, strip sync state)
        if (col === "spec" && typeof val === "object" && val !== null) {
          const cleaned = sanitizeSpec(val as Record<string, unknown>)
          if (Object.keys(cleaned).length > 0) out[col] = cleaned
          continue
        }

        out[col] = val
      }

      // network-link: resolve sourceId/viaId/targetId → slugs
      if (exportCfg.dynamicEndpoints) {
        const sourceId = row.sourceId as string | undefined
        const viaId   = row.viaId   as string | undefined
        const targetId = row.targetId as string | undefined
        if (sourceId) {
          const ref = idToKindAndSlug.get(sourceId)
          if (ref) {
            out.sourceKind = ref.kind
            out.sourceSlug = ref.slug
          }
          delete out.sourceId
        }
        if (viaId) {
          // viaKind is already copied from the row by the generic loop;
          // we just need to add the resolved slug.
          const ref = idToKindAndSlug.get(viaId)
          if (ref) out.viaSlug = ref.slug
        }
        if (targetId) {
          const ref = idToKindAndSlug.get(targetId)
          if (ref) {
            out.targetKind = ref.kind
            out.targetSlug = ref.slug
          } else {
            // ip-address referenced by address string directly
            out.targetSlug = targetId
          }
          delete out.targetId
        }
      }

      entities.push(out)
    }

    if (entities.length > 0) {
      results.push({ kind: exportCfg.kind, entity: registryCfg.entity, entities })
    }
  }

  return results
}
