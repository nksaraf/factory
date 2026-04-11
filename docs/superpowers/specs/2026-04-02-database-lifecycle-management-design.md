# Database Lifecycle Management — Design Spec

## Context

Developers don't create isolated environments (sandboxes, previews, dev) because getting a realistic database is too hard. They need to manually provision databases, figure out how to seed them, and deal with stale or empty data. This friction means people test against shared environments or skip testing entirely.

This feature makes database management a first-class concern in Factory:

1. **Automated backup/restore** of production databases (pgBackRest for Postgres, extensible to other engines)
2. **Environment seeding** — sandbox/preview/dev environments automatically get anonymized production snapshots
3. **Simple anonymization** — column-level rules (email→fake, name→redact) defined per project

Factory is the **orchestrator** — it delegates to specialized tools (pgBackRest, etc.) and manages them via K8s Jobs. PostgreSQL is the v1 engine; the abstraction supports any DB.

---

## User Journeys

### 1. Project Init — "I need a database"

```
dx init project my-app → template asks DB needs → generates docker-compose.yaml with database service
dx dev → provisions local Postgres via docker-compose
```

### 2. Sandbox Creation — "Give me real data"

```
dx sandbox create my-feature
  → Factory sees project declares postgres with seed config
  → Provisions Postgres sidecar pod in sandbox namespace
  → Restores latest prod backup → anonymizes → done
  → Sandbox ready with realistic data (developer didn't think about DB setup)
```

### 3. Preview Environment — "PR has real data"

```
PR opened → CI builds image → Factory creates preview
  → Checks component's database dependencies
  → Provisions ephemeral Postgres + seeds from latest backup (anonymized)
  → Preview URL ready with real-ish data
  → PR closed → preview + database destroyed
```

### 4. Production Backup — "Nightly backups"

```
dx db backup-policy set app-db --schedule "0 2 * * *" --retention 30d --storage s3://backups
  → Every night: Factory runs pgBackRest as K8s Job → stores in S3
  → Cleans up backups older than 30 days
```

### 5. Production Restore — "Something broke"

```
dx db restore app-db --from latest
dx db restore app-db --from bkup_abc123 --point-in-time "2026-04-01T15:00:00Z"
  → Factory runs restore Job → operator monitors with dx db operations --watch
```

### 6. Refresh Dev Data — "My data is stale"

```
dx db seed --target my-sandbox --from production --anonymize
  → Finds latest prod backup → drops & recreates → restores + anonymizes
```

### 7. Anonymization Rules — "Protect PII"

```
dx db anonymize-profile create pii-safe \
  --rule "users.email=fake_email" \
  --rule "users.name=fake_name" \
  --rule "payments.card_number=mask:last4" \
  --exclude-table "audit_log"
```

### 8. Register Existing Database — "Bring my DB into Factory"

```
dx db register app-db \
  --engine postgres --version 16 \
  --host db-server-01.internal --port 5432 \
  --credentials-secret factory/app-db-creds \
  --target production

  → Creates database record with provisionMode='external'
  → Factory doesn't manage the DB process — just knows where it is
  → Now you can layer on backup policy and use it as a seed source

dx db backup-policy set app-db --schedule "0 2 * * *" --retention 30d --storage s3://backups
  → Factory backs it up nightly via K8s Jobs that connect to the external host
  → Sandboxes can now seed from it
```

### 9. Database Inventory — "What exists?"

```
dx db list
┌──────────┬────────┬───────────┬─────────┬─────────────┬────────┐
│ Name     │ Engine │ Target    │ Mode    │ Last Backup │ Status │
├──────────┼────────┼───────────┼─────────┼─────────────┼────────┤
│ app-db   │ pg 16  │ prod      │ managed │ 2h ago      │ healthy│
│ app-db   │ pg 16  │ sandbox-1 │ sidecar │ —           │ seeded │
│ app-db   │ pg 16  │ preview-3 │ sidecar │ —           │ seeding│
└──────────┴────────┴───────────┴─────────┴─────────────┴────────┘
```

---

## Schema Design

Three new tables in `factory_fleet`, replacing the unused `dependencyWorkload`.

### `database` (replaces `dependency_workload`)

```typescript
export const database = factoryFleet.table(
  "database",
  {
    databaseId: text("database_id")
      .primaryKey()
      .$defaultFn(() => newId("db")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    catalogResourceId: text("catalog_resource_id").references(
      () => catalogResource.resourceId,
      { onDelete: "set null" }
    ),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    engine: text("engine").notNull(), // 'postgres' | 'mysql' | 'redis' | 'mongo'
    engineVersion: text("engine_version"), // e.g. "16", "8.0"

    // How this database is provisioned
    provisionMode: text("provision_mode").notNull(), // 'sidecar' | 'managed' | 'external'

    // Sidecar mode (Factory deploys it as a K8s StatefulSet)
    image: text("image"), // e.g. "postgres:16-alpine"
    port: integer("port"), // e.g. 5432
    cpu: text("cpu"),
    memory: text("memory"),
    storageGb: integer("storage_gb"),

    // Managed/external mode (RDS, CloudSQL, bring-your-own)
    externalHost: text("external_host"),
    externalPort: integer("external_port"),
    externalCredentialsRef: text("external_credentials_ref"), // K8s secret name

    // Connection info (populated after provisioning)
    connectionRef: text("connection_ref"), // env var prefix or secret name

    // Backup configuration (null = no backups)
    backupConfig: jsonb("backup_config").$type<{
      tool: string // 'pgbackrest' | 'pg_dump' | 'xtrabackup' | 'rdb_snapshot' | 'volume_snapshot'
      schedule: string // cron expression
      retentionDays: number
      storageBackend: string // 's3' | 'minio' | 'gcs'
      storageBucket: string
      storagePrefix?: string
      storageCredentialsRef?: string // K8s secret for storage access
    } | null>(),

    // Seed configuration (null = no auto-seeding)
    seedConfig: jsonb("seed_config").$type<{
      sourceDeploymentTargetSlug: string // e.g. "production"
      sourceDatabaseSlug: string // e.g. "app-db"
      autoSeedOnCreate: boolean
      anonymizationProfileId?: string
    } | null>(),

    status: text("status").notNull().default("provisioning"),
    lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("database_target_slug_unique").on(t.deploymentTargetId, t.slug),
    index("database_engine_idx").on(t.engine),
    check(
      "database_engine_valid",
      sql`${t.engine} IN ('postgres', 'mysql', 'redis', 'mongo')`
    ),
    check(
      "database_provision_mode_valid",
      sql`${t.provisionMode} IN ('sidecar', 'managed', 'external')`
    ),
    check(
      "database_status_valid",
      sql`${t.status} IN ('provisioning', 'running', 'seeding', 'failed', 'stopped', 'destroyed')`
    ),
  ]
)
```

### `database_operation`

Tracks all backup/restore/seed/anonymize operations as K8s Jobs.

```typescript
export const databaseOperation = factoryFleet.table(
  "database_operation",
  {
    databaseOperationId: text("database_operation_id")
      .primaryKey()
      .$defaultFn(() => newId("dbop")),
    databaseId: text("database_id")
      .notNull()
      .references(() => database.databaseId, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull(), // 'backup' | 'restore' | 'seed' | 'anonymize'
    trigger: text("trigger").notNull(), // 'scheduled' | 'manual' | 'environment_create'
    triggeredBy: text("triggered_by"), // principal ID

    // Storage references
    sourceUri: text("source_uri"), // S3 path to backup artifact (for restore/seed)
    targetUri: text("target_uri"), // S3 path where backup is stored (for backup)
    nativeSnapshotRef: text("native_snapshot_ref"), // VolumeSnapshot or RDS snapshot name (fast-path)

    // K8s Job tracking
    k8sJobName: text("k8s_job_name"),
    k8sJobNamespace: text("k8s_job_namespace"),

    // Anonymization (for seed operations)
    anonymizationProfileId: text("anonymization_profile_id").references(
      () => anonymizationProfile.anonymizationProfileId,
      { onDelete: "set null" }
    ),

    sizeBytes: text("size_bytes"),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}), // tool-specific info (WAL ranges, etc.)

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // for backup retention
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("db_operation_database_idx").on(t.databaseId),
    index("db_operation_status_idx").on(t.status),
    index("db_operation_type_idx").on(t.operationType),
    check(
      "db_operation_type_valid",
      sql`${t.operationType} IN ('backup', 'restore', 'seed', 'anonymize')`
    ),
    check(
      "db_operation_trigger_valid",
      sql`${t.trigger} IN ('scheduled', 'manual', 'environment_create')`
    ),
    check(
      "db_operation_status_valid",
      sql`${t.status} IN ('pending', 'running', 'completed', 'failed', 'expired')`
    ),
  ]
)
```

### `anonymization_profile`

Shared, reusable anonymization rules.

```typescript
export const anonymizationProfile = factoryFleet.table(
  "anonymization_profile",
  {
    anonymizationProfileId: text("anonymization_profile_id")
      .primaryKey()
      .$defaultFn(() => newId("anon")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    engine: text("engine").notNull(), // 'postgres' | 'mysql'
    rules: jsonb("rules").notNull().$type<
      Array<{
        table: string
        column: string
        strategy:
          | "fake_email"
          | "fake_name"
          | "fake_phone"
          | "redact"
          | "hash"
          | "mask"
          | "null"
          | "preserve"
          | "custom_sql"
        config?: Record<string, unknown> // e.g. { domain: "example.com" }, { keep_last: 4 }
      }>
    >(),
    excludeTables: jsonb("exclude_tables")
      .notNull()
      .default([])
      .$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("anonymization_profile_slug_unique").on(t.slug),
    check(
      "anon_profile_engine_valid",
      sql`${t.engine} IN ('postgres', 'mysql')`
    ),
  ]
)
```

### Migration: `dependency_workload` → `database`

The existing `dependencyWorkload` table is unused. The migration:

1. Creates the 3 new tables
2. Drops `dependency_workload` (no data to migrate)

---

## Adapter Pattern

### `DatabaseAdapter` interface

```typescript
// api/src/adapters/database-adapter.ts

export interface DatabaseAdapter {
  readonly engine: string

  /** Generate K8s StatefulSet + Service + PVC for sidecar provisioning */
  generateProvisionResources(db: DatabaseRecord): KubeResource[]

  /** Generate K8s Job manifest for backup operation */
  generateBackupJob(
    db: DatabaseRecord,
    operation: DatabaseOperationRecord
  ): KubeResource

  /** Generate K8s Job manifest for restore operation */
  generateRestoreJob(
    db: DatabaseRecord,
    operation: DatabaseOperationRecord
  ): KubeResource

  /** Generate K8s Job manifest for seed (restore + anonymize) */
  generateSeedJob(
    db: DatabaseRecord,
    operation: DatabaseOperationRecord,
    anonymizationRules?: AnonymizationRule[]
  ): KubeResource
}
```

### Backup Tool Strategy (Postgres v1)

Two tools supported, chosen based on access level:

|              | `pgbackrest` (physical)                                         | `pg_dump` (logical)                                     |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------- |
| **Speed**    | Fast, incremental, WAL-based PITR                               | Slower, full dump each time                             |
| **Setup**    | Needs pgBackRest agent on DB host or network access to data dir | Just needs connection string                            |
| **PITR**     | Yes                                                             | No                                                      |
| **Best for** | Production DBs on Factory-managed infra                         | External DBs where Factory only has a connection string |

The adapter generates different K8s Job manifests depending on `backupConfig.tool`. For `pg_dump`, the Job runs `pg_dump` → uploads to S3. For `pgbackrest`, the Job runs `pgbackrest backup` with full/incremental support.

Default recommendation: `pg_dump` for `provisionMode: 'external'`, `pgbackrest` for `provisionMode: 'sidecar'`.

### v1 Implementation: `PostgresAdapter`

```typescript
// api/src/adapters/database-adapter-postgres.ts

export class PostgresAdapter implements DatabaseAdapter {
  readonly engine = "postgres"

  generateProvisionResources(db) {
    // Returns: StatefulSet (postgres:16-alpine), Service (port 5432), PVC (storageGb)
    // Follows same pattern as sandbox-resource-generator.ts
  }

  generateBackupJob(db, operation) {
    // Returns: K8s Job running pgbackrest container
    // - Mounts storage credentials
    // - Runs `pgbackrest backup --type=full`
    // - Uploads to S3 path in operation.targetUri
  }

  generateRestoreJob(db, operation) {
    // Returns: K8s Job running pgbackrest container
    // - Downloads from S3 path in operation.sourceUri
    // - Runs `pgbackrest restore`
  }

  generateSeedJob(db, operation, rules) {
    // Returns: K8s Job with init container (restore) + main container (anonymize)
    // - Init: pgbackrest restore from sourceUri
    // - Main: runs generated SQL UPDATE statements per anonymization rules
    // - If no rules, skip anonymization step
  }
}
```

### Adapter Registry Extension

Add to `api/src/adapters/adapter-registry.ts`:

```typescript
const databaseAdapters: Record<string, () => DatabaseAdapter> = {
  postgres: () => new PostgresAdapter(),
}

export function getDatabaseAdapter(engine: string): DatabaseAdapter {
  const factory = databaseAdapters[engine]
  if (!factory) {
    throw new Error(
      `No database adapter for engine: ${engine}. Supported: ${Object.keys(databaseAdapters).join(", ")}`
    )
  }
  return factory()
}
```

---

## Reconciler Integration

### `DatabaseReconciler` class

New file: `api/src/reconciler/database-reconciler.ts`

Follows the same pattern as `PreviewReconciler`:

```typescript
export class DatabaseReconciler {
  constructor(
    private db: Database,
    private kube: KubeClient
  ) {}

  /** Called from Reconciler.reconcileAll() */
  async reconcileDatabases(): Promise<void> {
    // 1. Provision: find databases with status='provisioning', provisionMode='sidecar'
    //    → generate StatefulSet/Service/PVC via adapter → apply → mark 'running'
    // 2. Scheduled backups: find databases with backupConfig.schedule
    //    → check if schedule is due (lastBackupAt vs cron)
    //    → create database_operation record with type='backup'
    // 3. Process pending operations: find database_operations with status='pending'
    //    → generate K8s Job via adapter → apply → mark 'running'
    // 4. Monitor running operations: find database_operations with status='running'
    //    → check K8s Job status → mark 'completed' or 'failed'
    // 5. Auto-seed: find databases with seedConfig.autoSeedOnCreate
    //    → if database just reached 'running' and no seed operation exists
    //    → find latest backup from source → create seed operation
    // 6. Cleanup expired backups: find completed backups past expiresAt
    //    → delete from S3 → mark 'expired'
  }
}
```

### Integration into main Reconciler

In `api/src/reconciler/reconciler.ts`, add to constructor and `reconcileAll()`:

```typescript
export class Reconciler {
  private previewReconciler: PreviewReconciler
  private databaseReconciler: DatabaseReconciler // NEW

  constructor(db, kube, gitHost?) {
    this.previewReconciler = new PreviewReconciler(db, kube, gitHost)
    this.databaseReconciler = new DatabaseReconciler(db, kube) // NEW
    // ... runtime strategies
  }

  async reconcileAll() {
    // ... existing workload, sandbox, preview reconciliation ...

    // --- Database reconciliation ---                              // NEW
    try {
      await this.databaseReconciler.reconcileDatabases()
    } catch (err) {
      logger.error({ error: err }, "Failed to reconcile databases")
    }

    await expireStale(this.db)
    return { reconciled, errors }
  }
}
```

---

## API Endpoints

New routes in `api/src/modules/infra/` or a new `api/src/modules/database/` module:

```
# Database CRUD
GET    /databases                           → list all databases (filterable by deployment target)
GET    /databases/:slug                     → get database by slug
POST   /databases                           → create/register a database
DELETE /databases/:slug                     → destroy a database

# Backup operations
POST   /databases/:slug/backup              → trigger ad-hoc backup
GET    /databases/:slug/backups             → list backups for this database

# Restore operations
POST   /databases/:slug/restore             → restore from a backup
  body: { backupId?: string, pointInTime?: string }

# Seed operations
POST   /databases/:slug/seed               → seed from another database's backup
  body: { sourceSlug: string, sourceTargetSlug: string, anonymizationProfileSlug?: string }

# Operations tracking
GET    /databases/:slug/operations          → list operations for this database
GET    /database-operations/:id             → get operation details

# Anonymization profiles
GET    /anonymization-profiles              → list profiles
POST   /anonymization-profiles              → create profile
GET    /anonymization-profiles/:slug        → get profile
PUT    /anonymization-profiles/:slug        → update profile
DELETE /anonymization-profiles/:slug        → delete profile

# Backup policy (sugar for updating database.backupConfig)
PUT    /databases/:slug/backup-policy       → set backup config
DELETE /databases/:slug/backup-policy       → remove backup config
```

---

## CLI Commands

New `dx db` subcommand tree in `cli/src/commands/db.ts`:

```
dx db list                                          # list databases across all targets
dx db register <name> --engine postgres --host <h> --port <p> --credentials-secret <s> --target <dt>  # register existing DB
dx db create <name> --engine postgres --target <dt>  # create a new sidecar database
dx db backup <slug>                                  # trigger ad-hoc backup
dx db backups <slug>                                 # list backups
dx db restore <slug> --from <backup-id|latest>       # restore
dx db seed --target <dt-slug> --from <source-dt-slug> [--anonymize <profile-slug>]
dx db operations [--database <slug>] [--watch]       # track operations
dx db anonymize-profile create <name> --rule "table.col=strategy" ...
dx db anonymize-profile list
dx db backup-policy set <slug> --schedule "0 2 * * *" --retention 30d --storage s3://...
dx db backup-policy remove <slug>
```

---

## Declarative Config (docker-compose.yaml)

Projects declare database needs in their docker-compose service definitions:

```yaml
databases:
  - name: app-db
    engine: postgres
    version: "16"
    backup:
      tool: pgbackrest
      schedule: "0 2 * * *"
      retentionDays: 30
      storage:
        backend: s3
        bucket: my-backups
        prefix: app-db
    seed:
      from:
        target: production
        database: app-db
      autoSeedOnCreate: true
      anonymize: pii-safe

anonymizationProfiles:
  - name: pii-safe
    slug: pii-safe
    engine: postgres
    rules:
      - table: users
        column: email
        strategy: fake_email
      - table: users
        column: name
        strategy: fake_name
      - table: payments
        column: card_number
        strategy: mask
        config:
          keep_last: 4
    excludeTables:
      - audit_log
      - schema_migrations
```

---

## Sandbox/Preview Integration

### Sandbox Creation Flow (modified)

In `api/src/services/sandbox/sandbox.service.ts`, when creating a sandbox:

1. Create `deploymentTarget` + `sandbox` (existing)
2. **NEW**: Check project config for database declarations
3. For each declared database:
   - Create `database` record with `provisionMode=sidecar`, `seedConfig` from project config
   - Reconciler will provision the StatefulSet + auto-seed

### Preview Creation Flow (modified)

In `api/src/reconciler/preview-reconciler.ts`, when deploying a preview:

1. Create preview resources (existing)
2. **NEW**: Check component's database dependencies
3. For each dependency:
   - Create `database` record with `provisionMode=sidecar`, `seedConfig`
   - Inject `DATABASE_URL` env var into preview Deployment
   - Reconciler handles provisioning + seeding

---

## Storage Architecture

### Universal tier: S3-compatible object storage

- pgBackRest natively supports S3/MinIO
- Backup artifacts stored as: `s3://{bucket}/{prefix}/{database-slug}/{operation-id}/`
- Works for both self-hosted (MinIO) and cloud (S3, GCS)

### Fast-path: Native snapshots

- For sidecar databases on K8s: VolumeSnapshot (reuses existing CSI infrastructure)
- For managed databases: RDS/CloudSQL snapshot APIs
- The adapter decides: if source and target are on same cluster, use VolumeSnapshot; otherwise, use S3

### Storage credentials

- Stored as K8s Secrets, referenced by name in `backupConfig.storageCredentialsRef`
- Factory doesn't store credentials in its own DB

---

## Files to Create/Modify

### New files:

- `api/src/db/schema/fleet.ts` — add `database`, `databaseOperation`, `anonymizationProfile` tables; deprecate `dependencyWorkload`
- `api/drizzle/XXXX_database_lifecycle.sql` — migration
- `api/src/adapters/database-adapter.ts` — `DatabaseAdapter` interface
- `api/src/adapters/database-adapter-postgres.ts` — PostgreSQL implementation
- `api/src/reconciler/database-reconciler.ts` — `DatabaseReconciler` class
- `api/src/reconciler/database-resource-generator.ts` — K8s manifest generators (StatefulSet, Job, PVC)
- `api/src/modules/database/index.ts` — API routes + controller
- `api/src/modules/database/database.service.ts` — business logic
- `api/src/services/database/database.service.ts` — DB queries
- `cli/src/commands/db.ts` — `dx db` CLI commands

### Modified files:

- `api/src/adapters/adapter-registry.ts` — add `getDatabaseAdapter()`
- `api/src/reconciler/reconciler.ts` — add `DatabaseReconciler` to `reconcileAll()`
- `api/src/factory.api.ts` — register database module routes
- `api/src/services/sandbox/sandbox.service.ts` — create database records on sandbox creation
- `api/src/reconciler/preview-reconciler.ts` — create database records on preview deployment
- `cli/src/register-commands.ts` — register `dx db` commands
- `shared/src/types.ts` — add database-related types
- `cli/src/templates/project.ts` — add database config to project template

### Existing patterns to reuse:

- `api/src/reconciler/sandbox-resource-generator.ts` — pattern for K8s manifest generation
- `api/src/reconciler/preview-reconciler.ts` — pattern for reconciler class structure
- `api/src/adapters/adapter-registry.ts` — pattern for adapter registration
- `api/src/lib/id.ts` — `newId()` for ID generation
- `api/src/modules/infra/gateway.service.ts` — pattern for service layer

---

## Verification Plan

### Unit tests:

- `database-resource-generator.test.ts` — verify generated K8s manifests (StatefulSet, Job, PVC)
- `database-adapter-postgres.test.ts` — verify pgBackRest Job generation
- `database-reconciler.test.ts` — verify reconciliation state machine

### Integration tests:

- Create a database record → verify reconciler provisions StatefulSet
- Trigger backup → verify Job created → simulate completion → verify operation status
- Create sandbox with seedConfig → verify auto-seed operation created
- Test anonymization profile CRUD

### E2E test:

- `dx db list` → verify output format
- `dx db backup <slug>` → verify operation created via API
- Full sandbox creation with database seeding (requires running K8s cluster)
