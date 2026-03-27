# Scope Predicate Implementation Guide

**Platform Fabric · Authorization-Aware Data Access**

Version 3.0 · March 2026 · Status: RFC

---

## 1. Purpose

Platform Fabric uses two systems for authorization:

- **SpiceDB** answers "what are this principal's boundaries?" — it walks a relationship graph of scope_nodes, classifications, and roles. Fast, small cardinality.
- **PostgreSQL** answers "what's inside those boundaries?" — it filters millions or billions of rows using indexes. Efficient set operations.

The **Scope Predicate Compiler** bridges them. It takes SpiceDB's output (a small set of boundary values) and translates it into parameterized SQL WHERE clauses that PostgreSQL can execute against indexed columns.

This document defines the contract between the **platform team** (who builds the compiler, SDK, and Control Plane) and **product teams** (who build tables, queries, and modules that consume scope predicates). It is designed for **maximum query performance at billion-row scale** with no compromises.

---

## 2. Core Principle: Everything Is Generic

The authorization mental model defines two categories of access dimensions:

- **Scopes** — hierarchical dimensions. Region, topology, department, channel, cost center, operational zone, project portfolio, skill family, or any future dimension. Every scope is a tree. Every tree uses the same `scope_node` SpiceDB definition. Every data column stores an **ltree value** (PostgreSQL's native hierarchical type).
- **Classifications** — flat label dimensions. Data sensitivity, jurisdiction, regulatory tags, criticality, export control, or any future dimension. Every classification is an org-defined set of label values. Every data column stores an **integer code** mapped to a label via lookup table.

The platform does not hardcode dimension names. The SDK treats all scope dimensions identically (`ltree` descendant queries with GiST indexes) and all classification dimensions identically (`smallint` equality with btree indexes). The product team declares which dimensions their table participates in. The org admin defines what dimensions exist and what values they contain.

---

## 3. Architecture: The Four-Step Runtime Flow

Every data query follows four steps:

**Step 1 — Scope Resolution (Cached, <1ms hot / <10ms cold).** The Scope Resolution Service resolves the principal's scope_node assignments and classification clearances. Results are cached per-principal with event-driven invalidation. Cold path queries SpiceDB (~10ms). Hot path reads from in-memory cache (<1ms). Scope assignments change rarely (admin action), so cache hit rate is >99%.

**Step 2 — Constraint Evaluation (Custom Runtime, <5ms).** Runtime evaluates dynamic constraints (time windows, workflow state, skill requirements, financial ceilings) by querying application state. Result: pass/fail per constraint.

**Step 3 — Predicate Compilation + Session Variable Injection (SDK, <1ms).** The compiler translates the resolved context into PostgreSQL session variables. These variables are consumed by RLS policies (hard enforcement for tenant_id and scopes) and by SDK-generated WHERE clauses (for classifications and boolean gates). Session variables are SET once per connection checkout from the pool.

**Step 4 — Database Execution (PostgreSQL, <500ms at billion-row scale).** RLS policies automatically filter by tenant and scope boundaries. Product queries run within these boundaries using optimized indexes (GiST on ltree, composite btree, BRIN for time-series, covering indexes for hot paths). The query planner never sees rows outside the principal's authorization boundary.

---

## 4. Performance Architecture

### 4.1 Why These Choices

| Decision | Alternative considered | Why this is faster |
|---|---|---|
| `ltree` with GiST index | TEXT with `LIKE` + `text_pattern_ops` | GiST on ltree is purpose-built for ancestor/descendant queries. `<@` operator uses index-native containment checks. LIKE requires sequential prefix comparison. At depth 5+, ltree is 3-10x faster. |
| `smallint` for classifications | TEXT with `= ANY()` | Integer comparison is 3-5x faster than string comparison. Smaller column width = more rows per page = fewer I/O ops. Index is ~40% smaller. |
| RLS for scopes (not just tenant) | SDK WHERE clause injection | RLS is applied at the query planner level before execution. The planner can use RLS predicates for index selection and partition pruning. SDK-injected WHERE clauses are applied after planning in some ORMs. |
| Cached scope resolution | SpiceDB call per request | Scope assignments change on admin action (rare). Caching with event-driven invalidation eliminates >99% of SpiceDB round-trips. |
| Table partitioning | Single table with indexes | At 1B+ rows, even good indexes produce large btree structures. Partition pruning eliminates entire partitions from consideration before index lookup. |
| BRIN for time-series | Btree for time columns | BRIN indexes are ~1000x smaller than btree for naturally ordered data. Smaller index = fits in memory = faster scans. |
| Covering indexes | Standard indexes + heap fetch | Index-only scans avoid heap page fetches entirely. For narrow SELECT lists (dashboards, lists), this eliminates 50-80% of I/O. |

### 4.2 Enforcement Layers

| Layer | Mechanism | Strictness | Bypassable? |
|---|---|---|---|
| Tenant isolation | RLS on `tenant_id` (session variable) | **Hard** — database-enforced | Never. |
| Scope boundaries | RLS on `ltree` scope columns (session variables) | **Hard** — database-enforced | Never in normal operation. Requires `SET ROLE` to platform superuser for admin ops. |
| Classification gates | SDK WHERE clause injection | **Soft** — SDK-enforced | Yes, with explicit opt-out + audit. |
| Boolean gates | SDK WHERE clause injection | **Soft** — SDK-enforced | Yes, with explicit opt-out + audit. |
| Runtime constraints | Custom Runtime pre-check | **Soft** — request rejected pre-query | No. Failure prevents query execution. |

**Design upgrade from v2:** Scopes are now RLS-enforced (hard), not SDK-injected (soft). This means product code physically cannot bypass scope boundaries — the database itself refuses to return out-of-scope rows, just like it refuses cross-tenant rows. Classifications remain SDK-injected because they have legitimate bypass scenarios (admin dashboards, reports).

---

## 5. Column Types and Encoding

### 5.1 Scope Columns: ltree

PostgreSQL's `ltree` extension provides a native data type for hierarchical label paths. It supports ancestor (`@>`), descendant (`<@`), and matching operators with GiST and btree indexing.

```sql
-- Enable extension (once per database, migration helper does this)
CREATE EXTENSION IF NOT EXISTS ltree;
```

**Path format:**

```
-- ltree uses dot-separated labels (not slash-separated)
-- Labels: lowercase alphanumeric + underscores, max 256 chars per label

in.mh.mumbai.west          -- Mumbai West zone
in.mh                      -- Maharashtra state
in                          -- India
core.aggr.dist.access       -- Access tier (infra hierarchy)
engineering.platform.data   -- Data sub-team (department hierarchy)
```

**Ancestor/descendant queries:**

```sql
-- "Give me everything in Maharashtra" (descendant query)
WHERE geo <@ 'in.mh'
-- Matches: in.mh, in.mh.mumbai, in.mh.mumbai.west, in.mh.pune, ...
-- Does NOT match: in.gj, in.ka, ...

-- "Give me everything that contains Mumbai" (ancestor query)
WHERE geo @> 'in.mh.mumbai'
-- Matches: in, in.mh, in.mh.mumbai
-- Used less often; useful for "which org scopes cover this node?"

-- Multiple non-contiguous scopes (principal scoped to Mumbai AND Ahmedabad)
WHERE geo <@ ANY(ARRAY['in.mh.mumbai', 'in.gj.ahmedabad']::ltree[])
-- GiST index handles array containment natively
```

**Why ltree over TEXT + LIKE:**

- GiST index on ltree uses specialized containment logic — not character-by-character prefix scanning
- `<@ ANY(ARRAY[...])` handles multi-path scopes in a single index scan — TEXT LIKE requires OR which often forces bitmap merges
- `nlevel(geo)` gives depth without parsing — useful for aggregation by hierarchy level
- `subpath(geo, 0, 2)` extracts subtree prefix without string manipulation
- `lca(geo1, geo2)` computes lowest common ancestor — useful for scope overlap detection
- The query planner can estimate selectivity accurately for ltree operators — LIKE selectivity estimates are notoriously poor

### 5.2 Classification Columns: Integer-Coded

Classifications use `smallint` columns mapped to label values via a lookup table. This is faster than TEXT comparison and produces smaller indexes.

```sql
-- Lookup table (managed by platform, per-tenant, per-classification-type)
CREATE TABLE classification_values (
  id smallint NOT NULL,
  tenant_id uuid NOT NULL,
  classification_type text NOT NULL,      -- 'sensitivity', 'jurisdiction', ...
  label text NOT NULL,                    -- 'unclassified', 'internal', ...
  sort_order smallint DEFAULT 0,
  PRIMARY KEY (tenant_id, classification_type, id)
);

-- Example data
-- tenant: jio, type: sensitivity
-- 1 = unclassified, 2 = internal, 3 = confidential, 4 = restricted

-- tenant: jio, type: criticality
-- 1 = p1, 2 = p2, 3 = p3, 4 = p4
```

**On product tables:**

```sql
-- Column is smallint, not text
sensitivity smallint NOT NULL DEFAULT 1   -- 1 = unclassified
criticality smallint                      -- nullable if not all rows have criticality
```

**Predicate:**

```sql
-- Principal cleared for unclassified + internal (ids 1, 2)
WHERE sensitivity = ANY(ARRAY[1, 2]::smallint[])

-- Equivalent to TEXT version but ~3-5x faster comparison
-- Index is ~40% smaller (2 bytes vs ~12 bytes avg per text value)
```

**The SDK resolves labels to IDs at context resolution time** (cached). Product teams work with labels in application code; the SDK handles the translation:

```typescript
// Product code uses labels
await trafficSensors.insert(ctx, {
  sensitivity: 'internal',     // SDK resolves to smallint 2
  criticality: 'p3',           // SDK resolves to smallint 3
  // ...
});

// Query results are enriched back to labels by SDK
const nodes = await trafficSensors.query(ctx).select('*');
// nodes[0].sensitivity === 'internal'  (not 2)
```

### 5.3 Boolean Gates

Boolean gates use `boolean NOT NULL DEFAULT false`. No encoding needed — PostgreSQL boolean comparisons are already optimal.

```sql
has_pii boolean NOT NULL DEFAULT false
```

---

## 6. RLS-Based Scope Enforcement

### 6.1 Session Variables

On every connection checkout from the pool, the SDK sets PostgreSQL session variables:

```sql
-- Set by SDK connection middleware (automatic, every connection checkout)
SET app.tenant_id = 'jio-tenant-uuid';
SET app.scope_geo = 'in.mh';                              -- single path: ltree value
SET app.scope_geo_multi = '{in.mh.mumbai,in.gj.ahmedabad}'; -- multi-path: ltree array
SET app.scope_geo_unrestricted = 'false';
SET app.scope_infra_tier = 'core.aggr.dist.access';
SET app.scope_infra_tier_strict = 'true';                  -- strict = exact match, not descendant
SET app.scope_infra_tier_unrestricted = 'false';
-- ... one set of variables per declared scope type
```

### 6.2 RLS Policies

The migration helper generates RLS policies that read these session variables:

```sql
-- Tenant isolation (always present)
CREATE POLICY tenant_isolation ON network_nodes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Geo scope (generated when table declares geo scope)
CREATE POLICY scope_geo ON network_nodes
  USING (
    current_setting('app.scope_geo_unrestricted', true)::boolean = true
    OR (
      CASE
        WHEN current_setting('app.scope_geo_multi', true) IS NOT NULL
        THEN geo <@ ANY(
          string_to_array(current_setting('app.scope_geo_multi'), ',')::ltree[]
        )
        ELSE geo <@ current_setting('app.scope_geo')::ltree
      END
    )
  );

-- Infra tier scope with strict mode support
CREATE POLICY scope_infra_tier ON network_nodes
  USING (
    current_setting('app.scope_infra_tier_unrestricted', true)::boolean = true
    OR (
      CASE current_setting('app.scope_infra_tier_strict', true)::boolean
        WHEN true THEN infra_tier = current_setting('app.scope_infra_tier')::ltree
        ELSE infra_tier <@ current_setting('app.scope_infra_tier')::ltree
      END
    )
  );
```

**What this achieves:** Scope enforcement is now database-level, not application-level. Even if product code writes raw SQL, even if the ORM is misconfigured, even if someone bypasses the SDK entirely — the database will not return out-of-scope rows. This is the same guarantee we have for tenant_id.

### 6.3 Performance Impact of RLS

PostgreSQL's query planner inlines RLS policies as quals (query qualifications) during planning. This means:

- RLS predicates participate in index selection — the planner chooses the best index considering both RLS and user-written WHERE clauses
- RLS predicates participate in partition pruning — if the table is partitioned by tenant_id, the planner eliminates non-matching partitions before touching any index
- RLS predicates are evaluated alongside user predicates, not as a separate filter step — there is no "post-filter" overhead

The only overhead is `current_setting()` calls, which are sub-microsecond (reading a session-local hash table).

### 6.4 Admin Bypass for RLS Scopes

For admin operations that need to see all scopes:

```sql
-- Option 1: Set scope to unrestricted (still within tenant)
SET app.scope_geo_unrestricted = 'true';

-- Option 2: Use the platform admin role (bypasses all RLS)
SET ROLE platform_admin;  -- only available to platform team's admin tools
-- ... run query ...
RESET ROLE;
```

The SDK provides this as:

```typescript
// Bypasses scope RLS (not tenant RLS — that's never bypassable)
const results = await networkNodes.query(ctx.withScopeElevation('admin_dashboard'));

// Under the hood: SET app.scope_{type}_unrestricted = 'true' for this connection
// Audit log entry created automatically
```

---

## 7. Cached Scope Resolution

### 7.1 The Problem

SpiceDB resolution takes ~5-10ms per request (network hop + graph traversal). At 10,000 req/sec, that's 50-100 seconds of cumulative SpiceDB load per second. Scope assignments change on admin action — maybe a few times per day per org.

### 7.2 The Solution: Principal Scope Cache

```typescript
interface CachedScopeProfile {
  principal_id: string;
  tenant_id: string;
  scopes: Record<string, ScopeResolution>;
  clearances: Record<string, ClassificationClearance>;
  resolved_at: number;        // timestamp
  version: number;            // incremented on invalidation
}
```

**Cache layers:**

| Layer | Storage | TTL | Hit rate | Latency |
|---|---|---|---|---|
| L1: In-process | Node.js Map per worker | 30 seconds | ~85% | <0.01ms |
| L2: Shared | Redis / KeyDB | 5 minutes | ~14% | <1ms |
| L3: SpiceDB | Network call | — (source of truth) | ~1% | 5-10ms |

**Invalidation:** When an admin changes a principal's scope assignments (grants, revokes, group membership changes), the Control Plane publishes an invalidation event:

```typescript
// On scope assignment change (Control Plane admin API)
await outbox.publish('scope.principal.invalidated', {
  tenant_id: tenantId,
  principal_id: principalId,
  scope_types_affected: ['geo', 'infra_tier'],
  timestamp: Date.now(),
});

// All instances clear L1 + L2 for this principal
// Next request triggers L3 (SpiceDB) resolution
```

**On hierarchy structure change** (node renamed, moved, split), invalidate ALL principals in the affected tenant for the affected scope_type:

```typescript
await outbox.publish('scope.hierarchy.invalidated', {
  tenant_id: tenantId,
  scope_type: 'geo',
  timestamp: Date.now(),
});
// Bulk invalidation — all principals in this tenant re-resolve geo scope on next request
```

### 7.3 Session Variable Caching

Because RLS reads session variables, and session variables are set per connection checkout, the scope resolution result is amortized across all queries within a single request. For a request that makes 5 database queries, the scope is resolved once and the session variables are set once.

For connection pooling (PgBouncer / built-in pool), the SDK hooks into the checkout/checkin lifecycle:

```typescript
// Connection checkout hook
pool.on('checkout', async (connection) => {
  const ctx = getCurrentRequestContext();
  const profile = await scopeCache.get(ctx.principalId); // L1 -> L2 -> L3

  await connection.query(`
    SET app.tenant_id = $1;
    SET app.scope_geo = $2;
    SET app.scope_geo_unrestricted = $3;
    -- ... all scope variables
  `, [profile.tenant_id, profile.scopes.geo.ltree_value, profile.scopes.geo.is_unrestricted]);
});

// Connection checkin hook — reset to prevent leakage
pool.on('checkin', async (connection) => {
  await connection.query('RESET ALL');
});
```

---

## 8. Table Partitioning Strategy

### 8.1 When to Partition

| Table size | Strategy |
|---|---|
| < 10M rows | No partitioning. Indexes are sufficient. |
| 10M – 100M rows | Partition by `tenant_id` (hash, 16-64 partitions) if multi-tenant. |
| 100M – 1B rows | Partition by `tenant_id` (hash) + sub-partition by primary scope or time. |
| > 1B rows | Partition by `tenant_id` (list for large tenants, hash for small) + sub-partition by primary scope (range on ltree) or time (range on timestamp). |

### 8.2 Partition-Aware RLS

When the table is partitioned by `tenant_id`, the RLS policy `tenant_id = current_setting('app.tenant_id')::uuid` enables **partition pruning at plan time**. The planner knows only one partition (or hash bucket) can match, and eliminates all others before touching any index.

For a billion-row table with 64 hash partitions, this immediately reduces the search space to ~15M rows — before any scope index is consulted.

### 8.3 Migration Helper with Partitioning

```typescript
import { createPartitionedTable } from '@platform-fabric/sdk/migrations';

export async function up(knex) {
  await createPartitionedTable(knex, 'network_nodes', {
    // Partition strategy
    partitionBy: 'hash',
    partitionColumn: 'tenant_id',
    partitionCount: 64,

    // Columns (includes scope + classification columns)
    columns: (t) => {
      t.uuid('tenant_id').notNullable();
      t.specificType('geo', 'ltree').notNullable();
      t.specificType('infra_tier', 'ltree');
      t.smallint('sensitivity').notNullable().defaultTo(1);
      t.smallint('criticality');
      t.boolean('has_pii').notNullable().defaultTo(false);
      // product columns
      t.text('node_name');
      t.float('lat');
      t.float('lng');
      t.specificType('geom', 'geometry(Point, 4326)');
      t.text('status');
      t.timestamp('last_maintenance');
    },

    // Scope dimensions (generates RLS policies + GiST indexes)
    scopes: [
      { scopeType: 'geo',        column: 'geo',        inheritance: 'downward' },
      { scopeType: 'infra_tier', column: 'infra_tier',  inheritance: 'strict' },
    ],

    // Classification dimensions (generates btree indexes)
    classifications: [
      { classificationType: 'sensitivity', column: 'sensitivity' },
      { classificationType: 'criticality', column: 'criticality' },
    ],

    // Boolean gates
    booleanGates: [
      { name: 'pii', column: 'has_pii' },
    ],
  });
}
```

**What the helper creates:**

```sql
-- Partitioned table
CREATE TABLE network_nodes (
  id uuid DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  geo ltree NOT NULL,
  infra_tier ltree,
  sensitivity smallint NOT NULL DEFAULT 1,
  criticality smallint,
  has_pii boolean NOT NULL DEFAULT false,
  node_name text,
  lat float,
  lng float,
  geom geometry(Point, 4326),
  status text,
  last_maintenance timestamptz,
  PRIMARY KEY (id, tenant_id)  -- tenant_id in PK for partition routing
) PARTITION BY HASH (tenant_id);

-- Create 64 partitions
CREATE TABLE network_nodes_p0 PARTITION OF network_nodes
  FOR VALUES WITH (MODULUS 64, REMAINDER 0);
CREATE TABLE network_nodes_p1 PARTITION OF network_nodes
  FOR VALUES WITH (MODULUS 64, REMAINDER 1);
-- ... through p63

-- Enable RLS
ALTER TABLE network_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_nodes FORCE ROW LEVEL SECURITY;  -- applies to table owner too

-- RLS: tenant isolation (hard)
CREATE POLICY tenant_isolation ON network_nodes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- RLS: geo scope (hard, downward inheritance)
CREATE POLICY scope_geo ON network_nodes
  USING (
    current_setting('app.scope_geo_unrestricted', true)::boolean = true
    OR geo <@ ANY(
      string_to_array(
        current_setting('app.scope_geo_paths', true),
        ','
      )::ltree[]
    )
  );

-- RLS: infra_tier scope (hard, strict match)
CREATE POLICY scope_infra_tier ON network_nodes
  USING (
    infra_tier IS NULL
    OR current_setting('app.scope_infra_tier_unrestricted', true)::boolean = true
    OR infra_tier = ANY(
      string_to_array(
        current_setting('app.scope_infra_tier_paths', true),
        ','
      )::ltree[]
    )
  );

-- GiST index on ltree scope columns (per partition, automatic)
CREATE INDEX idx_network_nodes_geo ON network_nodes USING GIST (geo);
CREATE INDEX idx_network_nodes_infra ON network_nodes USING GIST (infra_tier)
  WHERE infra_tier IS NOT NULL;

-- Btree on classification columns
CREATE INDEX idx_network_nodes_sensitivity ON network_nodes (tenant_id, sensitivity);
```

---

## 9. Index Strategy (Detailed)

### 9.1 Per-Dimension Index Types

| Dimension type | Column type | Index type | Why |
|---|---|---|---|
| Scope (hierarchical) | `ltree` | GiST | Purpose-built for `<@` (descendant) and `@>` (ancestor) queries. Handles multi-path `<@ ANY(array)` in a single scan. |
| Classification (flat) | `smallint` | Btree composite with `tenant_id` | Integer btree is compact. Leading `tenant_id` aligns with RLS partition pruning. |
| Boolean gate | `boolean` | Partial index | `WHERE has_pii = true` — index only the minority case. |
| Time-series column | `timestamptz` | BRIN (block range) | ~1000x smaller than btree for naturally ordered data. |
| Spatial column | `geometry` | GiST (PostGIS) | Standard spatial index. Combined with scope via bitmap AND. |

### 9.2 Covering Indexes for Hot Queries

For dashboard and list endpoints that always SELECT the same columns, a covering index eliminates heap fetches entirely:

```sql
-- Dashboard query: list nodes with name, status, last_maintenance
-- Covering index: all selected columns are IN the index
CREATE INDEX idx_nodes_dashboard
  ON network_nodes (tenant_id, geo, status)
  INCLUDE (node_name, lat, lng, last_maintenance);

-- This enables index-only scans:
-- PostgreSQL reads the index page (which contains all needed data)
-- Never touches the heap table page
-- 50-80% I/O reduction for this query pattern
```

The SDK provides a helper for declaring hot query paths:

```typescript
export const networkNodes = defineTableScoping('network_nodes', {
  scopes: [...],
  classifications: [...],
  hotQueries: [
    {
      name: 'dashboard_list',
      indexColumns: ['tenant_id', 'geo', 'status'],
      includeColumns: ['node_name', 'lat', 'lng', 'last_maintenance'],
    },
    {
      name: 'maintenance_due',
      indexColumns: ['tenant_id', 'geo', 'last_maintenance'],
      includeColumns: ['node_name', 'status'],
      where: "status = 'active'",  // partial index
    },
  ],
});
```

### 9.3 BRIN Indexes for Append-Only Tables

Sensor readings, audit events, telemetry — tables where rows are inserted in roughly time order and rarely updated:

```sql
-- BRIN index: stores min/max per block range (128 pages default)
-- Size: ~0.1% of equivalent btree
CREATE INDEX idx_readings_time ON sensor_readings USING BRIN (recorded_at);

-- Combined with partitioning + RLS:
-- 1. Partition pruning eliminates other tenants' partitions
-- 2. RLS scope eliminates out-of-scope rows
-- 3. BRIN eliminates blocks outside the time range
-- Net: billion-row table -> thousands of rows scanned
```

### 9.4 GiST Index Behavior with ltree + RLS

When the query planner sees both the RLS policy (`geo <@ 'in.mh'::ltree`) and a user predicate (`status = 'active'`), it generates a plan like:

```
Index Scan using idx_network_nodes_geo on network_nodes
  Index Cond: (geo <@ 'in.mh'::ltree)      <- from RLS policy
  Filter: (status = 'active')                <- from user query
  Rows Removed by Filter: 237               <- small because GiST was selective
```

If the product team also has a composite btree on `(tenant_id, status)`, the planner might instead choose:

```
Bitmap Heap Scan on network_nodes
  Recheck Cond: ((geo <@ 'in.mh'::ltree) AND (status = 'active'))
  -> BitmapAnd
    -> Bitmap Index Scan on idx_network_nodes_geo
        Index Cond: (geo <@ 'in.mh'::ltree)
    -> Bitmap Index Scan on idx_network_nodes_status
        Index Cond: (tenant_id = '...' AND status = 'active')
```

The planner combines multiple indexes via bitmap AND when it estimates this is cheaper than a single index scan with filter. This is automatic — product teams don't need to orchestrate it.

---

## 10. Platform Team Responsibilities

### 10.1 Scope Resolution Service + Cache

See Section 7. Resolves SpiceDB scope_nodes and classification clearances. Three-tier cache. Event-driven invalidation.

### 10.2 Connection Middleware

Sets PostgreSQL session variables on every connection checkout. See Section 7.3. Single batched SET command per checkout. RESET ALL on checkin.

### 10.3 Predicate Compiler (for Classifications + Boolean Gates)

Classifications and boolean gates remain SDK-compiled (not RLS) because they have legitimate bypass scenarios. The compiler operates on the cached profile:

```typescript
interface PredicateSet {
  clauses: string[];        // ['sensitivity = ANY($1::smallint[])', 'has_pii = FALSE']
  params: any[];            // [[1, 2]]
  omitted: string[];        // unrestricted dimensions
  audit: PredicateAudit;
}
```

### 10.4 Migration Helpers

As described in Section 8.3. Creates partitioned tables, ltree columns, GiST indexes, RLS policies, classification columns, and btree indexes.

### 10.5 SDK Label-to-ID Resolution

Cached mapping from classification labels to integer codes:

```typescript
// Resolved at startup and on classification_values table change
const classificationMap = await loadClassificationMap(tenantId);
// { sensitivity: { unclassified: 1, internal: 2, confidential: 3, restricted: 4 },
//   criticality: { p1: 1, p2: 2, p3: 3, p4: 4 } }

// Used transparently by SDK on insert and select
```

---

## 11. Product Team Responsibilities

### 11.1 Declare Dimensions Per Table

```typescript
import { defineTableScoping } from '@platform-fabric/sdk/scoping';

export const networkNodes = defineTableScoping('network_nodes', {
  scopes: [
    { scopeType: 'geo',         column: 'geo',         inheritance: 'downward' },
    { scopeType: 'infra_tier',  column: 'infra_tier',   inheritance: 'strict' },
  ],
  classifications: [
    { classificationType: 'sensitivity', column: 'sensitivity' },
    { classificationType: 'criticality', column: 'criticality' },
  ],
  booleanGates: [
    { name: 'pii', column: 'has_pii' },
  ],
  hotQueries: [
    {
      name: 'dashboard',
      indexColumns: ['tenant_id', 'geo', 'status'],
      includeColumns: ['node_name', 'lat', 'lng', 'last_maintenance'],
    },
  ],
});
```

If an org has dimensions that don't apply to this table, don't declare them. The RLS policy is only generated for declared dimensions. The compiler skips undeclared dimensions.

### 11.2 Populate Scope Columns on Every Write

```typescript
async function createNode(ctx: RequestContext, input: NodeInput) {
  const geoValue = await resolver.resolveLtree('geo', input.region);
  const infraValue = await resolver.resolveLtree('infra_tier', input.tier);

  return networkNodes.insert(ctx, {
    geo: geoValue,                  // ltree: 'in.mh.mumbai.west'
    infra_tier: infraValue,         // ltree: 'core.aggr.dist.access'
    sensitivity: 'unclassified',    // SDK resolves to smallint 1
    criticality: 'p3',             // SDK resolves to smallint 3
    has_pii: false,
    node_name: input.name,
    lat: input.latitude,
    lng: input.longitude,
  });
}
```

**SDK validates on insert:**

| Rule | Enforcement | Failure |
|---|---|---|
| `tenant_id` must be set | SDK middleware (automatic) | 400 error |
| Declared scope columns must be non-null (unless nullable) | SDK insert hook | 400 with column name |
| ltree values must be valid format | SDK validation | 400 with invalid value |
| ltree values must match existing hierarchy node | SDK validation (opt-in) | 400 with unresolved node |
| Classification labels must exist in lookup table | SDK validation | 400 with unknown label |

### 11.3 Use Scoped Queries for Reads

**Automatic mode** (scopes enforced by RLS, classifications by SDK):

```typescript
async function listNodes(ctx: RequestContext) {
  return networkNodes
    .query(ctx)
    .select('node_id', 'node_name', 'lat', 'lng')
    .where('status', 'active')
    .orderBy('last_maintenance', 'asc')
    .limit(200);
}
```

**What the database sees (Jio field tech, Mumbai West, access tier):**

```sql
-- Session variables (set once on connection checkout):
-- app.tenant_id = 'jio-uuid'
-- app.scope_geo_paths = 'in.mh.mumbai.west'
-- app.scope_infra_tier_paths = 'core.aggr.dist.access'

-- RLS policies (invisible to product code, planner-inlined):
-- tenant_id = 'jio-uuid'            -> partition pruning (64 -> 1)
-- geo <@ 'in.mh.mumbai.west'        -> GiST index scan
-- infra_tier = 'core.aggr.dist.access' -> GiST filter (strict mode)

-- Product query + SDK classification predicates:
SELECT node_id, node_name, lat, lng
FROM network_nodes
WHERE sensitivity = ANY(ARRAY[1, 2]::smallint[])   -- SDK: classification
  AND has_pii = FALSE                                -- SDK: boolean gate
  AND status = 'active'                              -- product filter
ORDER BY last_maintenance ASC LIMIT 200
```

**Query execution at 1.2B rows:**

```
1. Partition pruning: tenant_id hash -> 1 partition (~18M rows)
2. GiST scan: geo <@ 'in.mh.mumbai.west' -> ~45K rows
3. GiST filter: infra_tier = 'core.aggr.dist.access' -> ~38K rows
4. Btree filter: sensitivity IN (1,2) -> ~37K rows
5. Filter: status = 'active' -> ~35K rows
6. Sort + limit: 200 rows returned

Total: ~120ms, 45K rows scanned from 1.2B
```

**Manual mode** (for complex queries):

```typescript
async function spatialAnalysis(ctx: RequestContext) {
  // RLS handles all scope enforcement automatically
  // Only need classification predicates manually for joined tables
  const storePreds = compileScopePredicates(ctx, {
    table: 'stores', alias: 's',
    classifications: [
      { classificationType: 'sensitivity', column: 'sensitivity' },
    ],
    booleanGates: [{ name: 'pii', column: 'has_pii' }],
  });

  // Note: NO scope predicates in raw SQL — RLS handles them
  const result = await db.raw(`
    SELECT s.store_id, s.store_name,
           ST_Distance(s.geom, c.geom) as competitor_dist,
           f.weekly_footfall
    FROM stores s
    JOIN competitor_locations c ON ST_DWithin(s.geom, c.geom, 5000)
    JOIN footfall_agg f ON f.store_id = s.store_id
    WHERE ${storePreds.whereClause}
      AND f.period = ?
    ORDER BY f.weekly_footfall DESC
  `, [...storePreds.params, '2026-W10']);

  return result.rows;
}
```

### 11.4 Register for Hierarchy Mutations

```typescript
import { onHierarchyRewrite } from '@platform-fabric/sdk/scopes';

onHierarchyRewrite('geo', {
  tables: [
    { name: 'network_nodes',    column: 'geo' },
    { name: 'sensor_readings',  column: 'geo' },
    { name: 'incident_reports', column: 'geo' },
  ],
  batchSize: 10000,
});
```

**ltree mutation is cleaner than TEXT path rewriting:**

```sql
-- Rename: 'in.mh.mumbai.west' -> 'in.mh.mumbai.zone_a'
UPDATE network_nodes
SET geo = 'in.mh.mumbai.zone_a' || subpath(geo, nlevel('in.mh.mumbai.west'))
WHERE geo <@ 'in.mh.mumbai.west'
  AND tenant_id = $1;

-- Move subtree: 'in.mh.mumbai' -> 'in.gj.mumbai'
UPDATE network_nodes
SET geo = 'in.gj.mumbai' || subpath(geo, nlevel('in.mh.mumbai'))
WHERE geo <@ 'in.mh.mumbai'
  AND tenant_id = $1;
```

ltree's `subpath()` and `nlevel()` make mutations surgical — no string REPLACE with risk of partial matches. The WHERE clause (`geo <@ old_prefix`) is GiST-accelerated.

---

## 12. The ltree Contract

### 12.1 Path Format

```
-- ltree uses dot-separated labels
-- Labels: [a-zA-Z0-9_], max 256 chars per label
-- No leading/trailing dots

in.mh.mumbai.west               -- geographic
core.aggr.dist.access            -- infrastructure tier
engineering.platform.data        -- department
retail_stores.north.delhi        -- channel
cc_100.cc_110                    -- cost center
zone_a.restricted                -- security zone
q1_2026.smartmarket_v2           -- project portfolio
```

### 12.2 Query Operators

| Operator | Meaning | Example | Use case |
|---|---|---|---|
| `<@` | Is descendant of (or equal) | `geo <@ 'in.mh'` | Downward inheritance — see all within |
| `@>` | Is ancestor of (or equal) | `geo @> 'in.mh.mumbai.west'` | "Which scopes cover this node?" |
| `=` | Exact match | `infra_tier = 'core.aggr.dist.access'` | Strict inheritance mode |
| `<@ ANY(arr)` | Descendant of any in array | `geo <@ ANY('{in.mh.mumbai,in.gj.ahmedabad}'::ltree[])` | Multi-path scope |
| `nlevel()` | Depth of path | `nlevel(geo) = 3` | Filter/aggregate by level |
| `subpath(p, off, len)` | Extract sub-path | `subpath(geo, 0, 2)` = `'in.mh'` | Subtree extraction |
| `lca(p1, p2)` | Lowest common ancestor | `lca(a.geo, b.geo)` | Scope overlap analysis |

### 12.3 Inheritance Modes

| Mode | Operator | Behavior | Example |
|---|---|---|---|
| `downward` | `<@` | Access at parent includes all descendants | Geo: Maharashtra includes Mumbai, Pune, all districts |
| `strict` | `=` | Access at node X means only X, not its children or parent | Infra: access-tier access does NOT imply distribution-tier |
| `downward_only` | `<@` with level check | Access at node X includes descendants but not ancestors | Channel: distributor sees reseller data, not vice versa |

The inheritance mode is configured per scope_type in the Ontology Registry. The RLS policy generator reads this config to select the correct operator.

---

## 13. The Classification Contract

Classifications are flat label dimensions. No hierarchy, no paths. Just a set of org-defined values, and a set of values the principal is cleared for.

| Property | Scope dimension | Classification dimension |
|---|---|---|
| Structure | Hierarchical (tree) | Flat (set of labels) |
| Column type | `ltree` | `smallint` (mapped to label) |
| Predicate | `<@` (descendant) or `=` (strict) | `= ANY(cleared_ids)` |
| Enforcement | RLS (hard) | SDK WHERE (soft, bypassable with audit) |
| Inheritance | Configurable per type | None — explicit clearance required |
| Index type | GiST | Btree composite |
| Typical cardinality | Deep (5+ levels, thousands of nodes) | Shallow (3-10 values per type) |

---

## 14. Performance Benchmarks (Expected)

Targets for a table with 1.2 billion rows, 64 hash partitions, GiST on ltree.

| Scenario | Rows scanned | Rows returned | Expected latency |
|---|---|---|---|
| Single narrow scope (city zone, 1 tier) | ~45K | ~35K | <150ms |
| Regional scope (state-wide, all tiers) | ~180M | ~170M (paginated) | <250ms first page |
| National scope (unrestricted geo) | ~300M | ~280M (paginated) | <300ms first page |
| Cross-scope join (spatial + scope) | ~4K stores x spatial | ~3.5K | <400ms |
| Time-range + scope (BRIN + GiST) | ~100K | ~50K | <100ms |
| Dashboard with covering index | ~200 | 200 | <20ms |

**What makes this fast:**

```
Request arrives
  |
  +- Scope resolution: <1ms (L1 cache hit, 85% of requests)
  |
  +- Session variable SET: <0.5ms (batched SQL)
  |
  +- Query planning: <2ms
  |   +- Partition pruning: tenant_id hash -> 1/64 partitions
  |   +- RLS inlined as quals -> participates in index selection
  |   +- GiST on ltree selected for scope predicate
  |
  +- Index scan: varies by scope selectivity
  |   +- GiST containment (ltree subtree scan)
  |   +- Bitmap AND with classification btree if needed
  |   +- Covering index -> index-only scan if applicable
  |
  +- Result: rows matching tenant + scope + classification + product filters
```

No step is wasted. Partition pruning removes 63/64 of data. GiST ltree narrows to subtree. Classification btree narrows further. Covering index avoids heap. Each layer multiplies the reduction.

---

## 15. Escape Hatches

```typescript
// Bypass scope RLS for admin dashboard
const results = await networkNodes.query(ctx.withScopeElevation('admin_dashboard'));
// Under the hood: SET app.scope_{type}_unrestricted = 'true'
// Audit entry created automatically

// Bypass classification predicates
const results = await networkNodes.query(ctx.withClassificationBypass(['sensitivity']));
// Omits sensitivity from SDK WHERE clause

// Full bypass (platform admin tools only)
const results = await networkNodes.query(ctx.withFullElevation('MIGRATION-1234'));
// All scopes unrestricted + all classifications omitted
// tenant_id RLS is NEVER bypassed
```

**Rules:**

- `tenant_id` RLS is never bypassable by any escape hatch
- Every bypass is logged to `site-control-audit` with: principal, reason, dimensions bypassed, row count, timestamp
- `withFullElevation` requires a ticket/migration reference
- Scope elevation is reviewed by platform team in code review

---

## 16. Testing Contract

### 16.1 Required Tests (Per Table)

1. **Scope isolation** — insert rows with different ltree paths. Query as scoped principal. Assert only descendant rows returned.
2. **Strict scope** — for strict-inheritance dimensions, assert parent rows excluded when scoped to child.
3. **Classification gate** — insert rows with different classification IDs. Assert restricted rows excluded.
4. **Cross-tenant isolation** — insert rows for two tenants. Assert zero cross-tenant leakage.
5. **Multi-path scope** — assign principal to two non-contiguous nodes. Assert rows from both returned, rows from neither excluded.
6. **NULL scope column rejection** — assert insert with NULL required scope column fails.
7. **Hierarchy inheritance** — insert at child nodes, query as parent-scoped. Assert children included (downward mode).
8. **Escape hatch audit** — execute elevated query. Assert audit log entry.
9. **RLS enforcement on raw SQL** — execute raw SQL without SDK. Assert RLS still filters. Proves enforcement is database-level.

### 16.2 SDK Test Helpers

```typescript
import { createTestContext, seed } from '@platform-fabric/sdk/testing';

describe('network_nodes scope isolation', () => {
  it('geo scope excludes out-of-scope rows via RLS', async () => {
    const ctx = createTestContext({
      tenantId: 'test-tenant',
      scopes: {
        geo: { ltree_values: ['in.mh.mumbai.west'], inheritance: 'downward' },
        infra_tier: { ltree_values: ['core.aggr.dist.access'], inheritance: 'strict' },
      },
      clearances: {
        sensitivity: { cleared_ids: [1, 2] },
      },
    });

    await seed('network_nodes', [
      { geo: 'in.mh.mumbai.west',  infra_tier: 'core.aggr.dist.access', sensitivity: 1, name: 'visible' },
      { geo: 'in.mh.mumbai.east',  infra_tier: 'core.aggr.dist.access', sensitivity: 1, name: 'wrong-geo' },
      { geo: 'in.mh.mumbai.west',  infra_tier: 'core',                  sensitivity: 1, name: 'wrong-tier' },
      { geo: 'in.mh.mumbai.west',  infra_tier: 'core.aggr.dist.access', sensitivity: 4, name: 'wrong-class' },
    ]);

    const result = await networkNodes.query(ctx).select('name');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('visible');
  });

  it('RLS enforces scope even with raw SQL', async () => {
    const ctx = createTestContext({
      tenantId: 'test-tenant',
      scopes: { geo: { ltree_values: ['in.mh.mumbai.west'], inheritance: 'downward' } },
    });

    await seed('network_nodes', [
      { geo: 'in.mh.mumbai.west', name: 'visible' },
      { geo: 'in.gj.ahmedabad',   name: 'invisible' },
    ]);

    // Raw SQL — no SDK involvement, RLS still enforces
    const result = await db.raw('SELECT name FROM network_nodes');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('visible');
  });
});
```

---

## 17. Decision Matrix

| Question | If Yes | If No |
|---|---|---|
| Does this table hold tenant data? | Add `tenant_id`, enable RLS. Mandatory. | Platform table — no scoping. |
| Is this data associated with any org hierarchy? | Declare scope dimensions (`ltree` + GiST). | Omit. |
| Does the scope use downward inheritance? | `inheritance: 'downward'` — ltree `<@`. | `inheritance: 'strict'` — ltree `=`. |
| Does your org define classification types for this data? | Declare classification dimensions (`smallint` + btree). | Omit. |
| Could rows contain PII? | Add boolean gate. | Omit or default false. |
| Is this table > 100M rows? | `createPartitionedTable` with hash partitions. | Standard table. |
| Is this table append-only / time-series? | BRIN index on timestamp. | Btree. |
| Does one query pattern dominate? | Declare `hotQueries` for covering indexes. | Default indexes. |

---

## 18. Implementation Checklist

### 18.1 Platform Team (Build Once, Ship in Three Languages)

- [ ] PostgreSQL `ltree` extension enabled on all site databases
- [ ] `classification_values` lookup table deployed per site
- [ ] Scope Resolution Service + 3-tier cache (L1 in-process, L2 Redis, L3 SpiceDB)
- [ ] Event-driven cache invalidation on scope assignment / hierarchy changes
- [ ] Connection middleware for all three runtimes:
  - TypeScript: `pool.on('checkout')` / `pool.on('checkin')`
  - Python: SQLAlchemy `@event.listens_for` or asyncpg `setup`/`reset`
  - Java: `ScopedDataSource` extending HikariCP
- [ ] RLS policy generator for tenant_id + per-scope-type policies (downward / strict)
- [ ] Predicate compiler for classification + boolean gate WHERE clauses (all three languages)
- [ ] Migration helpers:
  - TypeScript: Knex functions (`createPartitionedTable`, `addScopeDimensions`, etc.)
  - Python: Alembic functions (`create_partitioned_table`, `add_scope_dimensions`, etc.)
  - Java: CLI tool (`generate-migration`) producing Flyway-compatible SQL
- [ ] Scope resolver (ltree resolution + cache) in all three languages
- [ ] Label-to-ID resolution cache for classifications in all three languages
- [ ] Hierarchy rewrite framework with ltree `subpath()` / `nlevel()` mutations
- [ ] Test utilities in all three languages (`createTestContext` / `create_test_context` / `@ScopeTestContext`)
- [ ] Audit logging for all elevation/bypass events
- [ ] SDK lint rule: no table with `tenant_id` ships without scoping declaration

### 18.2 Product Team (Per Table — All Languages)

- [ ] Identify scope + classification dimensions (Section 17 matrix)
- [ ] Create scoping declaration:
  - TypeScript: `defineTableScoping()` with inheritance modes
  - Python: `@scoped_table` decorator on SQLAlchemy model
  - Java: `@ScopedTable` annotation on model class
- [ ] Run migration:
  - TypeScript: Knex migration with `createPartitionedTable()`
  - Python: Alembic migration with `create_partitioned_table()`
  - Java: Flyway SQL migration (use SDK CLI `generate-migration` for boilerplate)
- [ ] Add covering indexes for hot query paths (all: raw SQL in migration)
- [ ] Add BRIN indexes for time-series columns (all: raw SQL in migration)
- [ ] Populate ltree + classification columns on every write path
- [ ] Use scope resolver — never construct ltree values manually:
  - TypeScript: `resolver.resolveLtree()`
  - Python: `resolver.resolve_ltree()`
  - Java: `scopeResolver.resolveLtree()`
- [ ] Use scoped queries for reads:
  - TypeScript: `createScopedQuery` / `compileScopePredicates`
  - Python: `scoped_query()` / `compile_scope_predicates()`
  - Java: `nodeRepo.scopedQuery()` / `ScopePredicateCompiler.compile()`
- [ ] Register with hierarchy rewrite handler per scope type
- [ ] Write all 9 required tests including raw SQL RLS test
- [ ] Benchmark queries against Section 14 targets
- [ ] Document elevation usage; platform team reviews in PR

### 18.3 Review Gates

- No tenant table ships without scope declaration — SDK lint
- No elevation ships without audit logging — compile-time check
- No module passes QA without scope isolation tests — CI gate
- No table > 100M rows ships without partitioning plan — architecture review
- All hierarchy rewrite handlers registered — deploy-time check
- Query performance benchmarked against Section 14 targets — pre-release gate

---

## 19. Language-Specific SDK Reference

The platform SDK ships in three languages. The platform team maintains all three as first-class implementations — not wrappers. The core contract (ltree columns, SMALLINT classifications, RLS policies, GiST indexes) is identical. Only the API surface differs.

| Concern | TypeScript (Node.js) | Python | Java |
|---|---|---|---|
| Migration tool | Knex migrations | Alembic | Flyway |
| ORM / query builder | Knex | SQLAlchemy | JOOQ / JDBI |
| Connection pooling | node-postgres pool | SQLAlchemy engine pool / asyncpg | HikariCP |
| Test framework | Jest / Vitest | pytest | JUnit 5 |
| SDK package | `@platform-fabric/sdk` | `platform_fabric.sdk` | `com.platformfabric:scope-sdk` |

---

### 19.1 Python SDK (Alembic + SQLAlchemy)

#### 19.1.1 Migrations (Alembic)

The Python SDK provides Alembic helper functions that generate the same DDL as the TypeScript helpers.

```python
# alembic/versions/001_create_network_nodes.py
"""Create network_nodes with scope dimensions."""

from alembic import op
import sqlalchemy as sa
from platform_fabric.sdk.migrations import (
    create_partitioned_table,
    add_scope_dimensions,
    add_classification_dimensions,
    add_boolean_gate,
    enable_ltree,
)

revision = '001'
down_revision = None

def upgrade():
    # Ensure ltree extension (idempotent)
    enable_ltree(op)

    # Create partitioned table with all scope infrastructure
    create_partitioned_table(
        op,
        table_name='network_nodes',
        partition_by='hash',
        partition_column='tenant_id',
        partition_count=64,
        columns=[
            sa.Column('id', sa.dialects.postgresql.UUID, server_default=sa.text('gen_random_uuid()')),
            sa.Column('tenant_id', sa.dialects.postgresql.UUID, nullable=False),
            # product-specific columns
            sa.Column('node_name', sa.Text),
            sa.Column('lat', sa.Float),
            sa.Column('lng', sa.Float),
            sa.Column('status', sa.Text),
            sa.Column('last_maintenance', sa.DateTime(timezone=True)),
        ],
        # Scope dimensions — generates ltree columns + GiST indexes + RLS policies
        scopes=[
            {'scope_type': 'geo',        'column': 'geo',        'inheritance': 'downward'},
            {'scope_type': 'infra_tier', 'column': 'infra_tier', 'inheritance': 'strict'},
        ],
        # Classification dimensions — generates smallint columns + btree indexes
        classifications=[
            {'classification_type': 'sensitivity', 'column': 'sensitivity', 'default': 'unclassified', 'not_null': True},
            {'classification_type': 'criticality', 'column': 'criticality', 'default': None, 'not_null': False},
        ],
        # Boolean gates
        boolean_gates=[
            {'name': 'pii', 'column': 'has_pii', 'default': False},
        ],
    )


def downgrade():
    op.drop_table('network_nodes')
```

**Adding scope dimensions to an existing table:**

```python
# alembic/versions/015_add_opzone_to_network_nodes.py
"""Add operational_zone scope to network_nodes."""

from alembic import op
from platform_fabric.sdk.migrations import add_scope_dimensions, backfill_scope_dimension

revision = '015'
down_revision = '014'

def upgrade():
    # Add new scope dimension (ltree column + GiST index + RLS policy)
    add_scope_dimensions(op, 'network_nodes', [
        {'scope_type': 'operational_zone', 'column': 'opzone', 'inheritance': 'downward'},
    ])

    # Backfill existing rows
    backfill_scope_dimension(
        op,
        table_name='network_nodes',
        column='opzone',
        scope_type='operational_zone',
        derive_sql="""
            CASE
                WHEN geo <@ 'in.mh.mumbai' THEN 'mumbai_ops'::ltree
                WHEN geo <@ 'in.mh.pune'   THEN 'pune_ops'::ltree
                ELSE 'default_zone'::ltree
            END
        """,
        batch_size=50000,
    )
```

**Adding covering indexes and BRIN:**

```python
# alembic/versions/020_add_hot_indexes.py
"""Add covering index for dashboard query and BRIN for time-series."""

from alembic import op

revision = '020'
down_revision = '019'

def upgrade():
    # Covering index for dashboard list endpoint
    op.execute("""
        CREATE INDEX idx_nodes_dashboard
        ON network_nodes (tenant_id, geo, status)
        INCLUDE (node_name, lat, lng, last_maintenance)
    """)

    # BRIN for time-series queries on sensor_readings
    op.execute("""
        CREATE INDEX idx_readings_time_brin
        ON sensor_readings USING brin (recorded_at)
        WITH (pages_per_range = 128)
    """)
```

#### 19.1.2 Table Scoping Declaration (SQLAlchemy)

```python
# models/network_nodes.py
from platform_fabric.sdk.scoping import scoped_table, ScopeDimension, ClassificationDimension, BooleanGate
from platform_fabric.sdk.types import Ltree
from sqlalchemy import Column, Text, Float, DateTime, Boolean, SmallInteger
from sqlalchemy.dialects.postgresql import UUID

@scoped_table(
    scopes=[
        ScopeDimension(scope_type='geo',        column='geo',        inheritance='downward'),
        ScopeDimension(scope_type='infra_tier', column='infra_tier', inheritance='strict'),
    ],
    classifications=[
        ClassificationDimension(classification_type='sensitivity', column='sensitivity'),
        ClassificationDimension(classification_type='criticality', column='criticality'),
    ],
    boolean_gates=[
        BooleanGate(name='pii', column='has_pii'),
    ],
)
class NetworkNode(Base):
    __tablename__ = 'network_nodes'

    id = Column(UUID, primary_key=True, server_default=text('gen_random_uuid()'))
    tenant_id = Column(UUID, nullable=False)

    # Scope columns (ltree — populated via ScopeResolver)
    geo = Column(Ltree, nullable=False)
    infra_tier = Column(Ltree)

    # Classification columns (smallint — populated via ClassificationRegistry)
    sensitivity = Column(SmallInteger, nullable=False, server_default='1')
    criticality = Column(SmallInteger)

    # Boolean gates
    has_pii = Column(Boolean, nullable=False, server_default='false')

    # Product columns
    node_name = Column(Text)
    lat = Column(Float)
    lng = Column(Float)
    status = Column(Text)
    last_maintenance = Column(DateTime(timezone=True))
```

#### 19.1.3 Writing Data (Insert / Import)

```python
# services/node_service.py
from platform_fabric.sdk.scopes import ScopeResolver
from platform_fabric.sdk.classifications import ClassificationRegistry
from platform_fabric.sdk.context import RequestContext

async def create_node(ctx: RequestContext, input: NodeInput) -> NetworkNode:
    resolver = ScopeResolver(ctx.tenant_id)
    registry = ClassificationRegistry(ctx.tenant_id)

    geo_path = await resolver.resolve_ltree('geo', input.region)
    infra_path = await resolver.resolve_ltree('infra_tier', input.tier)
    sensitivity_id = await registry.resolve_id('sensitivity', input.sensitivity or 'unclassified')
    criticality_id = await registry.resolve_id('criticality', input.criticality) if input.criticality else None

    node = NetworkNode(
        tenant_id=ctx.tenant_id,         # SDK sets automatically if using scoped_session
        geo=geo_path,                     # ltree: 'in.mh.mumbai.west'
        infra_tier=infra_path,            # ltree: 'core.aggr.dist.access'
        sensitivity=sensitivity_id,       # smallint: 2
        criticality=criticality_id,       # smallint or None
        has_pii=False,
        node_name=input.name,
        lat=input.latitude,
        lng=input.longitude,
    )

    ctx.session.add(node)
    await ctx.session.flush()
    return node


async def import_nodes(ctx: RequestContext, csv_rows: list[dict]) -> int:
    resolver = ScopeResolver(ctx.tenant_id)
    registry = ClassificationRegistry(ctx.tenant_id)

    # Batch resolve (single DB query each, cached)
    unique_regions = list({row['region'] for row in csv_rows})
    unique_tiers = list({row['tier'] for row in csv_rows})
    geo_map = await resolver.resolve_ltrees('geo', unique_regions)
    infra_map = await resolver.resolve_ltrees('infra_tier', unique_tiers)
    sens_map = await registry.resolve_ids('sensitivity',
        list({row.get('classification', 'unclassified') for row in csv_rows}))

    prepared = [
        {
            'tenant_id': ctx.tenant_id,
            'geo': geo_map[row['region']],
            'infra_tier': infra_map[row['tier']],
            'sensitivity': sens_map[row.get('classification', 'unclassified')],
            'has_pii': bool(row.get('contains_pii')),
            'node_name': row['name'],
            'lat': row['latitude'],
            'lng': row['longitude'],
        }
        for row in csv_rows
    ]

    # Bulk insert with SDK validation (rejects missing scope columns)
    from platform_fabric.sdk.query import bulk_insert
    return await bulk_insert(ctx, NetworkNode, prepared)
```

#### 19.1.4 Reading Data (Scoped Queries)

```python
# services/node_service.py
from platform_fabric.sdk.query import scoped_query, compile_scope_predicates

async def list_nodes(ctx: RequestContext, status_filter: str = 'active') -> list[NetworkNode]:
    """Automatic mode: RLS enforces scopes, SDK adds classification predicates."""
    query = (
        scoped_query(ctx, NetworkNode)          # injects classification + boolean WHERE clauses
        .filter(NetworkNode.status == status_filter)
        .order_by(NetworkNode.last_maintenance.asc())
        .limit(200)
    )
    return (await ctx.session.execute(query)).scalars().all()


async def spatial_analysis(ctx: RequestContext, period: str) -> list[dict]:
    """Manual mode: raw SQL with RLS + explicit classification predicates."""
    store_preds = compile_scope_predicates(ctx, {
        'table': 'stores', 'alias': 's',
        'classifications': [
            {'classification_type': 'sensitivity', 'column': 'sensitivity'},
        ],
        'boolean_gates': [{'name': 'pii', 'column': 'has_pii'}],
    })

    # RLS handles all scope enforcement — only classification predicates needed in SQL
    result = await ctx.session.execute(
        sa.text(f"""
            SELECT s.store_id, s.store_name,
                   ST_Distance(s.geom, c.geom) as competitor_dist,
                   f.weekly_footfall
            FROM stores s
            JOIN competitor_locations c ON ST_DWithin(s.geom, c.geom, 5000)
            JOIN footfall_agg f ON f.store_id = s.store_id
            WHERE {store_preds.where_clause}
              AND f.period = :period
            ORDER BY f.weekly_footfall DESC
        """),
        {**store_preds.params, 'period': period},
    )
    return [dict(row) for row in result]
```

#### 19.1.5 Connection Middleware (Session Variable Injection)

```python
# platform_fabric/sdk/middleware.py
from sqlalchemy import event
from platform_fabric.sdk.cache import scope_cache

def configure_scope_middleware(engine):
    """Hook into SQLAlchemy connection pool to set scope session variables."""

    @event.listens_for(engine, 'checkout')
    def on_checkout(dbapi_conn, connection_record, connection_proxy):
        ctx = get_current_request_context()
        if ctx is None:
            return

        profile = scope_cache.get(ctx.principal_id, ctx.tenant_id)
        cursor = dbapi_conn.cursor()
        try:
            cursor.execute("SET app.tenant_id = %s", (str(ctx.tenant_id),))
            for scope_type, resolution in profile.scopes.items():
                paths_str = ','.join(resolution.ltree_paths)
                cursor.execute(f"SET app.scope_{scope_type}_paths = %s", (paths_str,))
                cursor.execute(f"SET app.scope_{scope_type}_unrestricted = %s",
                             (str(resolution.is_unrestricted).lower(),))
        finally:
            cursor.close()

    @event.listens_for(engine, 'checkin')
    def on_checkin(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        try:
            cursor.execute("RESET ALL")
        finally:
            cursor.close()
```

For **async** (asyncpg):

```python
# Using asyncpg pool hooks
async def setup_connection(conn):
    ctx = get_current_request_context()
    if ctx is None:
        return
    profile = await scope_cache.get(ctx.principal_id, ctx.tenant_id)
    await conn.execute(f"""
        SET app.tenant_id = '{ctx.tenant_id}';
        SET app.scope_geo_paths = '{",".join(profile.scopes["geo"].ltree_paths)}';
        SET app.scope_geo_unrestricted = '{str(profile.scopes["geo"].is_unrestricted).lower()}';
    """)

async def teardown_connection(conn):
    await conn.execute("RESET ALL")

pool = await asyncpg.create_pool(dsn, setup=setup_connection, reset=teardown_connection)
```

#### 19.1.6 Hierarchy Rewrite Registration

```python
# workers/hierarchy_rewrite.py
from platform_fabric.sdk.scopes import register_hierarchy_rewrite

register_hierarchy_rewrite(
    scope_type='geo',
    tables=[
        {'name': 'network_nodes',    'column': 'geo'},
        {'name': 'sensor_readings',  'column': 'geo'},
        {'name': 'incident_reports', 'column': 'geo'},
    ],
    batch_size=50000,
)

register_hierarchy_rewrite(
    scope_type='infra_tier',
    tables=[
        {'name': 'network_nodes', 'column': 'infra_tier'},
    ],
    batch_size=50000,
)
```

#### 19.1.7 Testing (pytest)

```python
# tests/test_network_nodes_scope.py
import pytest
from platform_fabric.sdk.testing import create_test_context, seed

@pytest.fixture
def scoped_ctx(db_session):
    return create_test_context(
        session=db_session,
        tenant_id='test-tenant',
        scopes={
            'geo': {'ltree_values': ['in.mh.mumbai.west'], 'inheritance': 'downward'},
            'infra_tier': {'ltree_values': ['core.aggr.dist.access'], 'inheritance': 'strict'},
        },
        clearances={
            'sensitivity': {'cleared_ids': [1, 2]},
        },
    )

class TestNetworkNodesScopeIsolation:

    async def test_geo_scope_excludes_out_of_scope(self, scoped_ctx):
        await seed('network_nodes', [
            {'geo': 'in.mh.mumbai.west',  'infra_tier': 'core.aggr.dist.access', 'sensitivity': 1, 'node_name': 'visible'},
            {'geo': 'in.mh.mumbai.east',  'infra_tier': 'core.aggr.dist.access', 'sensitivity': 1, 'node_name': 'wrong-geo'},
            {'geo': 'in.mh.mumbai.west',  'infra_tier': 'core',                  'sensitivity': 1, 'node_name': 'wrong-tier'},
            {'geo': 'in.mh.mumbai.west',  'infra_tier': 'core.aggr.dist.access', 'sensitivity': 4, 'node_name': 'wrong-class'},
        ], ctx=scoped_ctx)

        nodes = await list_nodes(scoped_ctx)
        assert len(nodes) == 1
        assert nodes[0].node_name == 'visible'

    async def test_rls_enforces_even_with_raw_sql(self, scoped_ctx):
        await seed('network_nodes', [
            {'geo': 'in.mh.mumbai.west', 'node_name': 'visible'},
            {'geo': 'in.gj.ahmedabad',   'node_name': 'invisible'},
        ], ctx=scoped_ctx)

        # Raw SQL — no SDK involvement, RLS still enforces
        result = await scoped_ctx.session.execute(sa.text('SELECT node_name FROM network_nodes'))
        rows = result.fetchall()
        assert len(rows) == 1
        assert rows[0].node_name == 'visible'

    async def test_cross_tenant_isolation(self, db_session):
        ctx_a = create_test_context(session=db_session, tenant_id='tenant-a',
            scopes={'geo': {'ltree_values': ['in'], 'inheritance': 'downward'}})
        ctx_b = create_test_context(session=db_session, tenant_id='tenant-b',
            scopes={'geo': {'ltree_values': ['in'], 'inheritance': 'downward'}})

        await seed('network_nodes', [{'geo': 'in.mh', 'node_name': 'a-node'}], ctx=ctx_a)
        await seed('network_nodes', [{'geo': 'in.mh', 'node_name': 'b-node'}], ctx=ctx_b)

        nodes_a = await list_nodes(ctx_a)
        assert len(nodes_a) == 1
        assert nodes_a[0].node_name == 'a-node'

    async def test_escape_hatch_logged(self, scoped_ctx):
        elevated_ctx = scoped_ctx.with_scope_elevation('admin_dashboard')
        await list_nodes(elevated_ctx)

        audit_entries = await get_audit_entries(scoped_ctx, action='scope_elevation')
        assert len(audit_entries) == 1
        assert audit_entries[0].reason == 'admin_dashboard'
```

---

### 19.2 Java SDK (Flyway + JOOQ/JDBI)

#### 19.2.1 Migrations (Flyway)

Flyway uses versioned SQL files. The Java SDK provides a **migration generator CLI** that produces the SQL, and a **Flyway callback** that registers RLS policies after migration.

```sql
-- db/migration/V001__create_network_nodes.sql
-- Generated by: platform-fabric-sdk generate-migration network_nodes

CREATE EXTENSION IF NOT EXISTS ltree;

-- Partitioned table
CREATE TABLE network_nodes (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Scope dimensions (ltree)
    geo ltree NOT NULL,
    infra_tier ltree,

    -- Classification dimensions (smallint)
    sensitivity SMALLINT NOT NULL DEFAULT 1,
    criticality SMALLINT,

    -- Boolean gates
    has_pii BOOLEAN NOT NULL DEFAULT false,

    -- Product columns
    node_name TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    geom geometry(Point, 4326),
    status TEXT,
    last_maintenance TIMESTAMPTZ,

    PRIMARY KEY (id, tenant_id)
) PARTITION BY HASH (tenant_id);

-- Create 64 hash partitions
DO $$
BEGIN
    FOR i IN 0..63 LOOP
        EXECUTE format(
            'CREATE TABLE network_nodes_p%s PARTITION OF network_nodes FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
            lpad(i::text, 2, '0'), i
        );
    END LOOP;
END $$;

-- Enable RLS
ALTER TABLE network_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_nodes FORCE ROW LEVEL SECURITY;

-- RLS: tenant isolation (hard, always present)
CREATE POLICY tenant_isolation ON network_nodes
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- RLS: geo scope (hard, downward inheritance)
CREATE POLICY scope_geo ON network_nodes
    USING (
        current_setting('app.scope_geo_unrestricted', true)::boolean = true
        OR geo <@ ANY(
            string_to_array(
                current_setting('app.scope_geo_paths', true), ','
            )::ltree[]
        )
    );

-- RLS: infra_tier scope (hard, strict match)
CREATE POLICY scope_infra_tier ON network_nodes
    USING (
        infra_tier IS NULL
        OR current_setting('app.scope_infra_tier_unrestricted', true)::boolean = true
        OR infra_tier = ANY(
            string_to_array(
                current_setting('app.scope_infra_tier_paths', true), ','
            )::ltree[]
        )
    );

-- GiST indexes on ltree scope columns
CREATE INDEX idx_network_nodes_geo ON network_nodes USING GIST (geo);
CREATE INDEX idx_network_nodes_infra ON network_nodes USING GIST (infra_tier) WHERE infra_tier IS NOT NULL;

-- Btree indexes on classification columns
CREATE INDEX idx_network_nodes_sensitivity ON network_nodes (tenant_id, sensitivity);
CREATE INDEX idx_network_nodes_criticality ON network_nodes (tenant_id, criticality) WHERE criticality IS NOT NULL;
```

**Adding a new dimension:**

```sql
-- db/migration/V015__add_opzone_to_network_nodes.sql

ALTER TABLE network_nodes ADD COLUMN opzone ltree;
CREATE INDEX idx_network_nodes_opzone ON network_nodes USING GIST (opzone) WHERE opzone IS NOT NULL;

-- RLS policy for new scope dimension
CREATE POLICY scope_opzone ON network_nodes
    USING (
        opzone IS NULL
        OR current_setting('app.scope_operational_zone_unrestricted', true)::boolean = true
        OR opzone <@ ANY(
            string_to_array(
                current_setting('app.scope_operational_zone_paths', true), ','
            )::ltree[]
        )
    );

-- Backfill
UPDATE network_nodes SET opzone = CASE
    WHEN geo <@ 'in.mh.mumbai' THEN 'mumbai_ops'::ltree
    WHEN geo <@ 'in.mh.pune'   THEN 'pune_ops'::ltree
    ELSE 'default_zone'::ltree
END
WHERE opzone IS NULL;

ALTER TABLE network_nodes ALTER COLUMN opzone SET NOT NULL;
```

**Adding covering indexes and BRIN:**

```sql
-- db/migration/V020__add_hot_indexes.sql

-- Covering index for dashboard list endpoint
CREATE INDEX idx_nodes_dashboard
    ON network_nodes (tenant_id, geo, status)
    INCLUDE (node_name, lat, lng, last_maintenance);

-- BRIN for time-series queries on sensor_readings
CREATE INDEX idx_readings_time_brin
    ON sensor_readings USING brin (recorded_at)
    WITH (pages_per_range = 128);
```

#### 19.2.2 Table Scoping Declaration (Java)

```java
// model/NetworkNode.java
package com.example.trafficure.model;

import com.platformfabric.sdk.scoping.*;
import java.util.UUID;
import java.time.Instant;

@ScopedTable(
    scopes = {
        @ScopeDimension(scopeType = "geo",        column = "geo",        inheritance = Inheritance.DOWNWARD),
        @ScopeDimension(scopeType = "infra_tier", column = "infra_tier", inheritance = Inheritance.STRICT),
    },
    classifications = {
        @ClassificationDimension(classificationType = "sensitivity", column = "sensitivity"),
        @ClassificationDimension(classificationType = "criticality", column = "criticality"),
    },
    booleanGates = {
        @BooleanGate(name = "pii", column = "has_pii"),
    }
)
public class NetworkNode {
    private UUID id;
    private UUID tenantId;

    // Scope columns (ltree values stored as String in Java, cast to ltree in SQL)
    private String geo;
    private String infraTier;

    // Classification columns (smallint mapped by SDK)
    private short sensitivity;
    private Short criticality;    // nullable

    // Boolean gates
    private boolean hasPii;

    // Product columns
    private String nodeName;
    private double lat;
    private double lng;
    private String status;
    private Instant lastMaintenance;

    // getters, setters, builder ...
}
```

#### 19.2.3 Writing Data (Insert / Import)

```java
// service/NodeService.java
package com.example.trafficure.service;

import com.platformfabric.sdk.scopes.ScopeResolver;
import com.platformfabric.sdk.classifications.ClassificationRegistry;
import com.platformfabric.sdk.context.RequestContext;

@Service
public class NodeService {

    private final ScopeResolver scopeResolver;
    private final ClassificationRegistry classificationRegistry;
    private final ScopedRepository<NetworkNode> nodeRepo;

    public NodeService(ScopeResolver scopeResolver,
                       ClassificationRegistry classificationRegistry,
                       ScopedRepository<NetworkNode> nodeRepo) {
        this.scopeResolver = scopeResolver;
        this.classificationRegistry = classificationRegistry;
        this.nodeRepo = nodeRepo;
    }

    public NetworkNode createNode(RequestContext ctx, NodeInput input) {
        String geoPath = scopeResolver.resolveLtree("geo", input.getRegion());
        String infraPath = scopeResolver.resolveLtree("infra_tier", input.getTier());
        short sensitivityId = classificationRegistry.resolveId("sensitivity",
            input.getSensitivity() != null ? input.getSensitivity() : "unclassified");
        Short criticalityId = input.getCriticality() != null
            ? classificationRegistry.resolveId("criticality", input.getCriticality())
            : null;

        NetworkNode node = NetworkNode.builder()
            .tenantId(ctx.getTenantId())          // SDK validates non-null
            .geo(geoPath)                          // "in.mh.mumbai.west"
            .infraTier(infraPath)                  // "core.aggr.dist.access"
            .sensitivity(sensitivityId)            // 2
            .criticality(criticalityId)            // 3 or null
            .hasPii(false)
            .nodeName(input.getName())
            .lat(input.getLatitude())
            .lng(input.getLongitude())
            .build();

        // SDK validates all scope/classification columns before insert
        return nodeRepo.insert(ctx, node);
    }

    public int importNodes(RequestContext ctx, List<CsvRow> csvRows) {
        // Batch resolve unique values (single DB call each, cached)
        Set<String> uniqueRegions = csvRows.stream().map(CsvRow::getRegion).collect(toSet());
        Set<String> uniqueTiers = csvRows.stream().map(CsvRow::getTier).collect(toSet());
        Map<String, String> geoMap = scopeResolver.resolveLtrees("geo", uniqueRegions);
        Map<String, String> infraMap = scopeResolver.resolveLtrees("infra_tier", uniqueTiers);

        Set<String> uniqueSens = csvRows.stream()
            .map(r -> r.getClassification() != null ? r.getClassification() : "unclassified")
            .collect(toSet());
        Map<String, Short> sensMap = classificationRegistry.resolveIds("sensitivity", uniqueSens);

        List<NetworkNode> nodes = csvRows.stream().map(row -> NetworkNode.builder()
            .tenantId(ctx.getTenantId())
            .geo(geoMap.get(row.getRegion()))
            .infraTier(infraMap.get(row.getTier()))
            .sensitivity(sensMap.get(
                row.getClassification() != null ? row.getClassification() : "unclassified"))
            .hasPii(row.isContainsPii())
            .nodeName(row.getName())
            .lat(row.getLatitude())
            .lng(row.getLongitude())
            .build()
        ).toList();

        // Bulk insert with SDK validation
        return nodeRepo.bulkInsert(ctx, nodes);
    }
}
```

#### 19.2.4 Reading Data (Scoped Queries)

```java
// service/NodeService.java (continued)

public List<NetworkNode> listNodes(RequestContext ctx, String statusFilter) {
    // Automatic mode: RLS enforces scopes, SDK adds classification predicates
    return nodeRepo.scopedQuery(ctx)
        .where("status", statusFilter)
        .orderBy("last_maintenance", SortOrder.ASC)
        .limit(200)
        .fetch();
}

// Manual mode with JOOQ for complex queries
public List<SpatialResult> spatialAnalysis(RequestContext ctx, String period) {
    ScopePredicates storePreds = ScopePredicateCompiler.compile(ctx, ScopePredicateConfig.builder()
        .table("stores").alias("s")
        .classification("sensitivity", "sensitivity")
        .booleanGate("pii", "has_pii")
        .build());

    // RLS handles scope enforcement — only classification predicates in SQL
    return ctx.jdbi().withHandle(handle ->
        handle.createQuery("""
            SELECT s.store_id, s.store_name,
                   ST_Distance(s.geom, c.geom) as competitor_dist,
                   f.weekly_footfall
            FROM stores s
            JOIN competitor_locations c ON ST_DWithin(s.geom, c.geom, 5000)
            JOIN footfall_agg f ON f.store_id = s.store_id
            WHERE """ + storePreds.getWhereClause() + """
              AND f.period = :period
            ORDER BY f.weekly_footfall DESC
            """)
        .bindMap(storePreds.getParams())
        .bind("period", period)
        .mapTo(SpatialResult.class)
        .list()
    );
}
```

#### 19.2.5 Connection Middleware (HikariCP)

```java
// config/ScopeDataSourceConfig.java
package com.example.trafficure.config;

import com.platformfabric.sdk.cache.ScopeCache;
import com.platformfabric.sdk.context.RequestContextHolder;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.SQLException;

public class ScopedDataSource extends HikariDataSource {

    private final ScopeCache scopeCache;

    public ScopedDataSource(HikariConfig config, ScopeCache scopeCache) {
        super(config);
        this.scopeCache = scopeCache;
    }

    @Override
    public Connection getConnection() throws SQLException {
        Connection conn = super.getConnection();
        var ctx = RequestContextHolder.get();
        if (ctx != null) {
            var profile = scopeCache.get(ctx.getPrincipalId(), ctx.getTenantId());
            try (var stmt = conn.createStatement()) {
                stmt.execute(String.format("SET app.tenant_id = '%s'", ctx.getTenantId()));
                for (var entry : profile.getScopes().entrySet()) {
                    String scopeType = entry.getKey();
                    var resolution = entry.getValue();
                    String paths = String.join(",", resolution.getLtreePaths());
                    stmt.execute(String.format("SET app.scope_%s_paths = '%s'", scopeType, paths));
                    stmt.execute(String.format("SET app.scope_%s_unrestricted = '%s'",
                        scopeType, resolution.isUnrestricted()));
                }
            }
        }
        return conn;
    }

    // Connection return hook — reset session variables
    // HikariCP's connectionInitSql or customizer handles this:
    // connectionInitSql: "RESET ALL"
}
```

**Spring Boot configuration:**

```java
// config/DataSourceConfig.java
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource(ScopeCache scopeCache) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/site_db");
        config.setMaximumPoolSize(20);
        config.setConnectionInitSql("RESET ALL");  // Clean state on pool return
        return new ScopedDataSource(config, scopeCache);
    }
}
```

#### 19.2.6 Hierarchy Rewrite Registration

```java
// config/HierarchyRewriteConfig.java
package com.example.trafficure.config;

import com.platformfabric.sdk.scopes.HierarchyRewriteRegistry;

@Configuration
public class HierarchyRewriteConfig {

    @Bean
    public HierarchyRewriteRegistry hierarchyRewriteRegistry(DataSource dataSource) {
        HierarchyRewriteRegistry registry = new HierarchyRewriteRegistry(dataSource);

        registry.register("geo", List.of(
            new RewriteTarget("network_nodes",    "geo"),
            new RewriteTarget("sensor_readings",  "geo"),
            new RewriteTarget("incident_reports", "geo")
        ), RewriteConfig.builder().batchSize(50000).build());

        registry.register("infra_tier", List.of(
            new RewriteTarget("network_nodes", "infra_tier")
        ), RewriteConfig.builder().batchSize(50000).build());

        return registry;
    }
}
```

#### 19.2.7 Testing (JUnit 5)

```java
// test/NetworkNodesScopeTest.java
package com.example.trafficure;

import com.platformfabric.sdk.testing.ScopeTestContext;
import com.platformfabric.sdk.testing.ScopeTestExtension;
import com.platformfabric.sdk.testing.Seed;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(ScopeTestExtension.class)
class NetworkNodesScopeTest {

    @Test
    void geoScopeExcludesOutOfScopeRows(
            @ScopeTestContext(
                tenantId = "test-tenant",
                scopes = {
                    @TestScope(scopeType = "geo", ltreeValues = "in.mh.mumbai.west", inheritance = "downward"),
                    @TestScope(scopeType = "infra_tier", ltreeValues = "core.aggr.dist.access", inheritance = "strict"),
                },
                clearances = {
                    @TestClearance(classificationType = "sensitivity", clearedIds = {1, 2}),
                }
            ) RequestContext ctx) {

        Seed.table("network_nodes")
            .row(Map.of("geo", "in.mh.mumbai.west",  "infra_tier", "core.aggr.dist.access", "sensitivity", 1, "node_name", "visible"))
            .row(Map.of("geo", "in.mh.mumbai.east",  "infra_tier", "core.aggr.dist.access", "sensitivity", 1, "node_name", "wrong-geo"))
            .row(Map.of("geo", "in.mh.mumbai.west",  "infra_tier", "core",                  "sensitivity", 1, "node_name", "wrong-tier"))
            .row(Map.of("geo", "in.mh.mumbai.west",  "infra_tier", "core.aggr.dist.access", "sensitivity", 4, "node_name", "wrong-class"))
            .insert(ctx);

        List<NetworkNode> nodes = nodeService.listNodes(ctx, "active");
        assertThat(nodes).hasSize(1);
        assertThat(nodes.get(0).getNodeName()).isEqualTo("visible");
    }

    @Test
    void rlsEnforcesEvenWithRawSql(
            @ScopeTestContext(
                tenantId = "test-tenant",
                scopes = @TestScope(scopeType = "geo", ltreeValues = "in.mh.mumbai.west", inheritance = "downward")
            ) RequestContext ctx) {

        Seed.table("network_nodes")
            .row(Map.of("geo", "in.mh.mumbai.west", "node_name", "visible"))
            .row(Map.of("geo", "in.gj.ahmedabad",   "node_name", "invisible"))
            .insert(ctx);

        // Raw SQL — no SDK, RLS still enforces
        List<String> names = ctx.jdbi().withHandle(h ->
            h.createQuery("SELECT node_name FROM network_nodes")
             .mapTo(String.class)
             .list());

        assertThat(names).containsExactly("visible");
    }

    @Test
    void crossTenantIsolation() {
        var ctxA = ScopeTestContext.create("tenant-a",
            Map.of("geo", new TestScopeValue("in", "downward")));
        var ctxB = ScopeTestContext.create("tenant-b",
            Map.of("geo", new TestScopeValue("in", "downward")));

        Seed.table("network_nodes")
            .row(Map.of("geo", "in.mh", "node_name", "a-node")).insert(ctxA);
        Seed.table("network_nodes")
            .row(Map.of("geo", "in.mh", "node_name", "b-node")).insert(ctxB);

        List<NetworkNode> nodesA = nodeService.listNodes(ctxA, "active");
        assertThat(nodesA).extracting("nodeName").containsExactly("a-node");
    }

    @Test
    void escapeHatchCreatesAuditEntry(
            @ScopeTestContext(tenantId = "test-tenant",
                scopes = @TestScope(scopeType = "geo", ltreeValues = "in.mh", inheritance = "downward")
            ) RequestContext ctx) {

        RequestContext elevated = ctx.withScopeElevation("admin_dashboard");
        nodeService.listNodes(elevated, "active");

        List<AuditEntry> entries = auditService.getEntries(ctx, "scope_elevation");
        assertThat(entries).hasSize(1);
        assertThat(entries.get(0).getReason()).isEqualTo("admin_dashboard");
    }
}
```

---

### 19.3 Cross-Language Consistency

The three SDKs are independently implemented but **functionally identical**. The generated SQL, RLS policies, indexes, and session variables are the same regardless of which SDK produced them. A table created by a Python Alembic migration can be queried by a Java service and vice versa.

**What the platform team guarantees across all SDKs:**

| Contract | Identical across languages |
|---|---|
| RLS policy SQL | Yes — generated from same template |
| GiST index definitions | Yes — same CREATE INDEX statements |
| ltree path format | Yes — same dot-separated convention |
| Session variable names | Yes — `app.tenant_id`, `app.scope_{type}_paths`, `app.scope_{type}_unrestricted` |
| Classification lookup table schema | Yes — same `classification_values` table |
| SMALLINT mapping | Yes — same IDs for same labels in same tenant |
| Hierarchy rewrite SQL | Yes — same `subpath()` / `nlevel()` pattern |
| Audit log schema | Yes — same `site-control-audit` events |

**What differs by language (surface only):**

| Concern | TypeScript | Python | Java |
|---|---|---|---|
| Migration tool | Knex | Alembic | Flyway (raw SQL) |
| Async model | `async/await` (native) | `async/await` (asyncio) or sync | `CompletableFuture` or sync |
| Connection hook | `pool.on('checkout')` | `@event.listens_for(engine, 'checkout')` | `HikariDataSource` override |
| Test setup | `createTestContext()` | `create_test_context()` | `@ScopeTestContext` annotation |
| ORM integration | Knex query builder | SQLAlchemy `scoped_query()` | JOOQ / JDBI + `scopedQuery()` |

---

## 20. FAQ

**Q: Why ltree instead of TEXT with LIKE?**

GiST indexes on ltree are purpose-built for containment queries. `<@` uses index-native ancestor/descendant checks, not character-by-character prefix scanning. Multi-path queries (`<@ ANY(array)`) execute in a single GiST scan rather than OR-ing LIKE patterns (which forces bitmap merges). At depth 5+ hierarchies with millions of rows, ltree is 3-10x faster. ltree also provides `nlevel()`, `subpath()`, and `lca()` for clean hierarchy operations without string parsing.

**Q: Why smallint instead of TEXT for classifications?**

Integer comparison is 3-5x faster. Smallint is 2 bytes vs ~12 bytes average for text. More values per index page, less I/O, ~40% smaller indexes. At billion-row scale, this is material. The SDK handles label-to-ID mapping transparently — product teams write `'internal'`, the database stores `2`.

**Q: Why RLS for scopes instead of just SDK WHERE injection?**

Three reasons. First, RLS predicates are inlined during query planning — the planner uses them for index selection and partition pruning. SDK WHERE clauses appended by ORMs may miss this optimization window. Second, RLS is physically unbypassable without SET ROLE — even raw SQL, misconfigured ORMs, and debug queries respect scope boundaries. Third, it eliminates an entire class of bugs where product code forgets to call the SDK scope helper.

**Q: What's the performance overhead of RLS?**

Near zero. `current_setting()` reads a session-local hash table (<1 microsecond). The planner inlines RLS quals alongside user predicates — no separate filter pass. Benchmarks show RLS-enforced queries within 1-2% of equivalent manual WHERE clauses.

**Q: What about PgBouncer in transaction mode?**

Session variables set with `SET` persist for the session, not the transaction. In PgBouncer transaction mode, you need `SET LOCAL` (transaction-scoped) instead. The SDK connection middleware detects the pooling mode and uses the correct variant. For Supavisor or built-in node-postgres pooling, standard `SET` works.

**Q: How does this work for air-gapped deployments?**

Identically. SpiceDB, PostgreSQL, ltree, the SDK — everything runs locally. No Factory connectivity. The entitlement bundle includes initial hierarchy data and classification value tables.

**Q: Can product teams define new scope types?**

Yes. Register in Ontology Registry. Define hierarchy nodes. Create scope_node tuples in SpiceDB. No SDK code changes. Product teams declare the new type in `defineTableScoping` and run the migration helper. The RLS policy generator creates the policy automatically.

**Q: What if a principal has no assignment for a declared dimension?**

Session variable is set to empty string. RLS evaluates `<@ ANY('{}'::ltree[])` which matches nothing. Zero rows. Missing assignment = no access. Assign at root for unrestricted.

**Q: What about array-valued classification columns?**

For tables where a single row maps to multiple classification values (e.g., a document tagged with both `trai_regulated` and `pii`), use `smallint[]` and the `&&` (overlap) operator: `WHERE regulatory_tags && ARRAY[1,2]::smallint[]`. The SDK supports this — declare `array: true` on the classification. Use sparingly; single-value columns are more index-friendly. GIN index on the array column if needed.

**Q: How do hierarchy mutations work with ltree?**

ltree provides `subpath(path, offset, len)` for surgical tree ops. Renaming: `SET geo = 'in.mh.mumbai.zone_a' || subpath(geo, nlevel('in.mh.mumbai.west'))`. Moving: same pattern, different prefix. The WHERE clause (`geo <@ old_prefix`) is GiST-accelerated. No string REPLACE, no risk of partial matches.

**Q: What about the connection pool overhead of SET/RESET?**

SET is ~0.1ms. RESET ALL on checkin is equally fast. For a request making 5 queries, scope is resolved once and variables are set once — amortized to ~0.02ms per query. Negligible compared to any real query.

**Q: Can a Python service and a Java service share the same database table?**

Yes. The RLS policies, ltree columns, GiST indexes, and classification lookup tables are database-level constructs — language-agnostic. A table created by an Alembic migration can be queried by a Java service, and vice versa. The only requirement is that both services use the same session variable convention (`app.tenant_id`, `app.scope_{type}_paths`, etc.), which all three SDKs implement identically.

**Q: What if one team uses Alembic and another uses Flyway on the same database?**

Avoid this. Use one migration tool per database. If Python and Java services share a database, designate one as the migration owner (typically whichever team owns the schema). The other team's SDK consumes the schema. The Flyway SQL generator CLI (`platform-fabric-sdk generate-migration`) produces raw SQL that can be adapted to either tool if needed.

**Q: Do I need the SDK at all, or can I just write the SQL myself?**

You can write the SQL. The SDK is a convenience layer. The real enforcement is in the database: RLS policies, ltree GiST indexes, and session variables. If your team prefers raw SQL (common in Java shops using Flyway), use the CLI to generate the DDL and write queries that set session variables correctly. The critical contract is the session variable naming convention and the RLS policy structure — not the SDK wrapper.
