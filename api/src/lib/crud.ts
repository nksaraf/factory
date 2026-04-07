/**
 * Ontology CRUD controller factory.
 *
 * Generates standard LIST / GET / CREATE / UPDATE / DELETE / related-entity / action routes
 * from a declarative config. Eliminates copy-pasted CRUD boilerplate across
 * modules while keeping the ontology-structured API pattern:
 *
 *   GET    /<entities>                        → LIST
 *   GET    /<entities>/:slugOrId              → SINGLE
 *   GET    /<entities>/:slugOrId/<related>    → LIST related
 *   POST   /<entities>                        → CREATE
 *   POST   /<entities>/:slugOrId/update       → UPDATE
 *   POST   /<entities>/:slugOrId/delete       → DELETE
 *   POST   /<entities>/:slugOrId/<action>     → ACTION
 */

import { Elysia } from "elysia";
import { and, desc, eq, getTableColumns, type SQL, type InferSelectModel } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";

import type { Database } from "../db/connection";
import { currentRow, bitemporalDelete, type BitemporalTable } from "../db/temporal";
import { ok, list, action as actionResponse } from "./responses";
import { parsePagination, countRows, paginationMeta } from "./pagination";
import { resolveBySlugOrId } from "./resolvers";
import { NotFoundError } from "./errors";

// ── Drizzle generic helpers ────────────────────────────────
//
// Drizzle's .from() / .update() use a conditional type (TableLikeHasEmptySelection)
// that TypeScript cannot evaluate when the table parameter is generic <T extends PgTable>.
// The conditional always resolves to `false` for PgTable (it only matters for Subqueries),
// but TS defers evaluation on generics.
//
// These helpers widen the table to concrete PgTable for the query builder call,
// then narrow the result back to InferSelectModel<T>. This is safe because the
// rows returned from `SELECT * FROM table` are always InferSelectModel<typeof table>.

function selectFrom<T extends PgTable>(db: Database, table: T) {
  return db.select().from(table as PgTable) as unknown as
    ReturnType<ReturnType<Database["select"]>["from"]> & Promise<InferSelectModel<T>[]>;
}

function updateTable<T extends PgTable>(db: Database, table: T) {
  return db.update(table as PgTable) as ReturnType<Database["update"]>;
}

// ── Config types ───────────────────────────────────────────

export interface RelationConfig {
  /** The plural entity name in the URL, e.g. "components" */
  path: string;
  /** The related Drizzle table */
  table: PgTable;
  /** The FK column on the related table pointing to the parent entity's id */
  fk: PgColumn;
  /** Optional column to ORDER BY desc. Defaults to FK column for deterministic pagination. */
  orderBy?: PgColumn;
  /** Optional OpenAPI tag override */
  tag?: string;
  /** If the related table is bitemporal, pass its columns to filter for current rows. */
  bitemporal?: Pick<BitemporalTable, "validTo" | "systemTo">;
}

export interface ActionConfig<TEntity = Record<string, unknown>> {
  /** Handler function. Receives the resolved parent entity and the request body. */
  handler: (ctx: {
    db: Database;
    entity: TEntity;
    body: unknown;
    slugOrId: string;
  }) => Promise<unknown>;
  /** Optional Zod schema for request body validation */
  bodySchema?: ZodType;
  /** Optional OpenAPI tag override */
  tag?: string;
}

/**
 * Lifecycle hooks for customizing CRUD operations.
 *
 * These allow controllers to inject validation, computed defaults, and
 * business logic into the standard CRUD pipeline without needing custom routes.
 */
export interface LifecycleHooks<TEntity = Record<string, unknown>> {
  /** Called after Zod parse, before db.insert(). Return the (possibly enriched) values to insert. */
  beforeCreate?: (ctx: { db: Database; parsed: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  /** Called after db.insert(). Can enrich/transform the returned row. */
  afterCreate?: (ctx: { db: Database; row: TEntity }) => Promise<TEntity>;
  /** Called after Zod parse + entity resolve, before db.update(). Return the values to set. */
  beforeUpdate?: (ctx: { db: Database; entity: TEntity; parsed: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  /** Called after db.update(). Can enrich/transform the returned row. */
  afterUpdate?: (ctx: { db: Database; row: TEntity }) => Promise<TEntity>;
  /** Called before delete. Throw to prevent deletion. */
  beforeDelete?: (ctx: { db: Database; entity: TEntity }) => Promise<void>;
}

export interface OntologyRouteConfig<T extends PgTable = PgTable> {
  /** Schema name for OpenAPI tags, e.g. "software" */
  schema: string;
  /** Plural entity name in URL, e.g. "systems" */
  entity: string;
  /** Singular display name for error messages, e.g. "system" */
  singular: string;
  /** The main Drizzle table */
  table: T;
  /** Slug column on the table */
  slugColumn: PgColumn;
  /** ID column on the table */
  idColumn: PgColumn;
  /** Column used for default ORDER BY desc on LIST queries. Defaults to idColumn. */
  orderByColumn?: PgColumn;
  /** Zod schema for the CREATE body (spec + name/slug/type fields) */
  createSchema?: ZodType;
  /** Zod schema for the UPDATE body (partial of create — all fields optional) */
  updateSchema?: ZodType;
  /**
   * Enables DELETE route.
   * - `true`: hard delete (DELETE FROM)
   * - `"bitemporal"`: bitemporal soft-delete via `bitemporalDelete()`
   */
  deletable?: boolean | "bitemporal";
  /** Related entity configs: key is the relation name */
  relations?: Record<string, RelationConfig>;
  /** Action configs: key is the action path segment */
  actions?: Record<string, ActionConfig<InferSelectModel<T>>>;
  /** Lifecycle hooks for customizing CRUD operations */
  hooks?: LifecycleHooks<InferSelectModel<T>>;
  /** Additional WHERE clause applied to all LIST queries (e.g. soft-delete filter) */
  baseFilter?: (db: Database) => SQL | undefined;
  /**
   * If the table uses bitemporal columns, pass the column references here.
   * Automatically filters for current live rows (validTo IS NULL AND systemTo IS NULL)
   * on LIST queries — ANDed with any explicit baseFilter.
   */
  bitemporal?: Pick<BitemporalTable, "validTo" | "systemTo">;
}

// ── Helpers ────────────────────────────────────────────────

async function resolveOrThrow<T extends PgTable>(
  db: Database,
  table: T,
  slugOrId: string,
  slugColumn: PgColumn,
  idColumn: PgColumn,
  singular: string,
  extraFilter?: SQL,
): Promise<InferSelectModel<T>> {
  const row = await resolveBySlugOrId<InferSelectModel<T>>(
    db, table, slugOrId, slugColumn, idColumn, extraFilter,
  );
  if (!row) {
    throw new NotFoundError(`${singular} '${slugOrId}' not found`);
  }
  return row;
}

// ── Factory function ───────────────────────────────────────

/**
 * Creates an Elysia instance with standard ontology CRUD routes.
 *
 * LIST, SINGLE, CREATE, UPDATE, DELETE are always registered on a single
 * Elysia chain so Eden type inference sees all routes. Handlers return 404
 * if the operation isn't configured (e.g. no createSchema → POST / returns 404).
 *
 * Relations and actions use dynamic paths from config, so they go on a
 * separate instance (Eden can't statically type dynamic path segments anyway).
 *
 * @example
 * ```ts
 * const systemRoutes = ontologyRoutes(db, {
 *   schema: "software",
 *   entity: "systems",
 *   singular: "system",
 *   table: softwareSystem,
 *   slugColumn: softwareSystem.slug,
 *   idColumn: softwareSystem.id,
 *   createSchema: CreateSystemSchema,
 *   relations: {
 *     components: {
 *       path: "components",
 *       table: component,
 *       fk: component.systemId,
 *     },
 *   },
 * });
 * ```
 */
export function ontologyRoutes<T extends PgTable>(
  db: Database,
  config: OntologyRouteConfig<T>,
) {
  const {
    schema,
    entity,
    singular,
    table,
    slugColumn,
    idColumn,
    createSchema,
    updateSchema,
    deletable,
    relations,
    actions,
    hooks,
    baseFilter,
    bitemporal: bitemporalCols,
  } = config;

  const tag = `${schema}/${entity}`;
  const tableHasUpdatedAt = "updatedAt" in getTableColumns(table);

  /** Combine bitemporal currentRow filter with any explicit baseFilter. */
  function effectiveFilter(): SQL | undefined {
    const parts: SQL[] = [];
    if (bitemporalCols) parts.push(currentRow(bitemporalCols));
    const custom = baseFilter?.(db);
    if (custom) parts.push(custom);
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : and(...parts)!;
  }

  // Core CRUD routes are always registered on a single chain so Eden
  // type inference sees LIST + SINGLE + CREATE + UPDATE + DELETE together.
  const app = new Elysia({ prefix: `/${entity}` })

    // ── LIST ──────────────────────────────────────────────
    .get("/", async ({ query }) => {
      const { limit, offset } = parsePagination({
        limit: Number(query.limit) || undefined,
        offset: Number(query.offset) || undefined,
      });

      const where = effectiveFilter();
      const total = await countRows(db, table, where);
      const rows = await selectFrom(db, table)
        .where(where)
        .orderBy(desc(config.orderByColumn ?? idColumn))
        .limit(limit)
        .offset(offset);

      return list(rows, paginationMeta(total, { limit, offset }));
    }, {
      detail: { tags: [tag], summary: `List ${entity}` },
    })

    // ── SINGLE ────────────────────────────────────────────
    .get("/:slugOrId", async ({ params }) => {
      const row = await resolveOrThrow(
        db, table, params.slugOrId, slugColumn, idColumn, singular,
        effectiveFilter(),
      );
      return ok(row);
    }, {
      detail: { tags: [tag], summary: `Get ${singular}` },
    })

    // ── CREATE ────────────────────────────────────────────
    .post("/", async ({ body }) => {
      if (!createSchema) throw new NotFoundError(`create not supported for ${entity}`);
      const parsed = createSchema.parse(body);
      const values = hooks?.beforeCreate
        ? await hooks.beforeCreate({ db, parsed })
        : parsed;
      const [row] = await db.insert(table as PgTable).values(values).returning();
      const result = hooks?.afterCreate
        ? await hooks.afterCreate({ db, row: row as InferSelectModel<T> })
        : row;
      return ok(result);
    }, {
      detail: { tags: [tag], summary: `Create ${singular}` },
    })

    // ── UPDATE ─────────────────────────────────────────────
    .post("/:slugOrId/update", async ({ params, body }) => {
      if (!updateSchema) throw new NotFoundError(`update not supported for ${entity}`);
      const parsed = updateSchema.parse(body);
      const resolved = await resolveOrThrow(
        db, table, params.slugOrId, slugColumn, idColumn, singular,
        effectiveFilter(),
      );
      const id = (resolved as Record<string, unknown>)[idColumn.name] as string;
      const values = hooks?.beforeUpdate
        ? await hooks.beforeUpdate({ db, entity: resolved, parsed })
        : parsed;
      const [updated] = await updateTable(db, table)
        .set(tableHasUpdatedAt ? { ...values, updatedAt: new Date() } : values)
        .where(eq(idColumn, id))
        .returning();
      const result = hooks?.afterUpdate
        ? await hooks.afterUpdate({ db, row: updated as InferSelectModel<T> })
        : updated;
      return ok(result);
    }, {
      detail: { tags: [tag], summary: `Update ${singular}` },
    })

    // ── DELETE ─────────────────────────────────────────────
    .post("/:slugOrId/delete", async ({ params }) => {
      if (!deletable) throw new NotFoundError(`delete not supported for ${entity}`);
      const resolved = await resolveOrThrow(
        db, table, params.slugOrId, slugColumn, idColumn, singular,
        effectiveFilter(),
      );
      if (hooks?.beforeDelete) {
        await hooks.beforeDelete({ db, entity: resolved });
      }
      const id = (resolved as Record<string, unknown>)[idColumn.name] as string;
      if (deletable === "bitemporal") {
        // Table is known to be bitemporal at this point (deletable === "bitemporal" checked above)
        const bitable = table as unknown as PgTable & BitemporalTable & { id: PgColumn; changedBy: PgColumn; changeReason: PgColumn };
        await bitemporalDelete(db, bitable, id, "api");
      } else {
        await db.delete(table as PgTable).where(eq(idColumn, id));
      }
      return ok({ deleted: true });
    }, {
      detail: { tags: [tag], summary: `Delete ${singular}` },
    });

  // Relations and actions use dynamic paths from config — Eden can't
  // statically type these, so they go on a separate instance.
  const extras = new Elysia({ prefix: `/${entity}` });

  // ── RELATED ENTITIES ──────────────────────────────────
  if (relations) {
    for (const [, rel] of Object.entries(relations)) {
      extras.get(`/:slugOrId/${rel.path}`, async ({ params, query }) => {
        const parent = await resolveOrThrow(
          db, table, params.slugOrId, slugColumn, idColumn, singular,
          bitemporalCols ? currentRow(bitemporalCols) : undefined,
        );

        const parentId = (parent as Record<string, unknown>)[idColumn.name] as string;
        const { limit, offset } = parsePagination({
          limit: Number(query.limit) || undefined,
          offset: Number(query.offset) || undefined,
        });

        const fkFilter = eq(rel.fk, parentId);
        const where = rel.bitemporal
          ? and(fkFilter, currentRow(rel.bitemporal))!
          : fkFilter;
        const total = await countRows(db, rel.table, where);
        const rows = await db
          .select()
          .from(rel.table)
          .where(where)
          .orderBy(desc(rel.orderBy ?? rel.fk))
          .limit(limit)
          .offset(offset);

        return list(rows, paginationMeta(total, { limit, offset }));
      }, {
        detail: {
          tags: [rel.tag ?? tag],
          summary: `List ${rel.path} for ${singular}`,
        },
      });
    }
  }

  // ── ACTIONS ───────────────────────────────────────────
  if (actions) {
    for (const [actionName, actionCfg] of Object.entries(actions)) {
      extras.post(`/:slugOrId/${actionName}`, async ({ params, body }) => {
        const resolved = await resolveOrThrow(
          db, table, params.slugOrId, slugColumn, idColumn, singular,
          bitemporalCols ? currentRow(bitemporalCols) : undefined,
        );

        const result = await actionCfg.handler({
          db,
          entity: resolved,
          body: actionCfg.bodySchema ? actionCfg.bodySchema.parse(body) : body,
          slugOrId: params.slugOrId,
        });

        return actionResponse(result, actionName);
      }, {
        detail: {
          tags: [actionCfg.tag ?? tag],
          summary: `${actionName} ${singular}`,
        },
      });
    }
  }

  // Merge extras into a single Elysia group that consumers .use()
  return new Elysia().use(app).use(extras);
}
