/**
 * Documents controller.
 *
 * Two-table model: org.document (identity) + org.document_version (snapshots).
 * Content lives on filesystem; metadata in Postgres.
 *
 * Routes:
 *   /documents/documents                       → LIST/GET/UPDATE/DELETE via ontologyRoutes
 *   /documents/documents/:slugOrId/versions    → LIST versions (via ontologyRoutes relation)
 *   /documents/upsert                          → POST upsert document by slug
 *   /documents/documents/:slugOrId/versions    → POST create new version (custom)
 *   /documents/documents/:slugOrId/content     → GET latest content
 */
import {
  CreateDocumentSchema,
  CreateDocumentVersionSchema,
  UpdateDocumentSchema,
} from "@smp/factory-shared/schemas/org"
import { and, desc, eq, max, sql } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { document, documentVersion } from "../../db/schema/org"
import { ontologyRoutes } from "../../lib/crud"
import { newId } from "../../lib/id"
import { documentExists, readDocument, writeDocument } from "./storage"

async function resolveDocument(db: Database, slugOrId: string) {
  const [bySlug] = await db
    .select()
    .from(document)
    .where(eq(document.slug, slugOrId))
    .limit(1)
  if (bySlug) return bySlug
  const [byId] = await db
    .select()
    .from(document)
    .where(eq(document.id, slugOrId))
    .limit(1)
  return byId ?? null
}

async function materializeContent(p: Record<string, unknown>) {
  if (typeof p.content === "string" && p.slug) {
    const content = p.content as string
    const contentPath =
      (p.contentPath as string | undefined) ?? `${p.type}/${p.slug}.md`
    await writeDocument(contentPath, content)
    p.contentPath = contentPath
    p.sizeBytes = Buffer.byteLength(content, "utf-8")
    p.contentHash = new Bun.CryptoHasher("sha256").update(content).digest("hex")
    delete p.content
  }
}

export function documentsController(db: Database) {
  return (
    new Elysia({ prefix: "/documents" })
      // ── Upsert by slug ──────────────────────────────────────
      .post("/upsert", async ({ body, set }) => {
        const parsed = CreateDocumentSchema.parse(body)
        const p = parsed as Record<string, unknown>

        await materializeContent(p)

        // Check if document with same slug already exists → update
        const [existing] = await db
          .select()
          .from(document)
          .where(eq(document.slug, p.slug as string))
          .limit(1)

        if (existing) {
          const { slug: _slug, ...updateFields } = p
          const [updated] = await db
            .update(document)
            .set({
              ...updateFields,
              spec: p.spec
                ? { ...(existing.spec as object), ...(p.spec as object) }
                : existing.spec,
            } as any)
            .where(eq(document.id, existing.id))
            .returning()
          return { success: true, ...updated, upserted: true }
        }

        // New document — insert
        const [row] = await db
          .insert(document)
          .values(p as any)
          .returning()
        set.status = 201
        return { success: true, ...row }
      })
      // ── CRUD via ontologyRoutes ─────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "documents",
          singular: "document",
          table: document,
          slugColumn: document.slug,
          idColumn: document.id,
          prefix: "doc",
          kindAlias: "document",
          createSchema: CreateDocumentSchema,
          updateSchema: UpdateDocumentSchema,
          deletable: true,
          relations: {
            versions: {
              path: "versions",
              table: documentVersion,
              fk: documentVersion.documentId,
              orderBy: documentVersion.version,
            },
          },
          hooks: {
            beforeCreate: async ({ parsed }) => {
              await materializeContent(parsed)
              return parsed
            },
          },
        })
      )
      // ── Create version ──────────────────────────────────────
      .post("/documents/:slugOrId/versions", async ({ params, body, set }) => {
        const parsed = CreateDocumentVersionSchema.parse(body)

        const doc = await resolveDocument(db, params.slugOrId)
        if (!doc) {
          set.status = 404
          return { error: "Document not found" }
        }

        // Write content to filesystem
        const contentHash = new Bun.CryptoHasher("sha256")
          .update(parsed.content)
          .digest("hex")
        const sizeBytes = Buffer.byteLength(parsed.content, "utf-8")

        // Transaction: compute next version + insert atomically
        const version = await db.transaction(async (tx) => {
          const [maxRow] = await tx
            .select({ maxVersion: max(documentVersion.version) })
            .from(documentVersion)
            .where(eq(documentVersion.documentId, doc.id))
          const nextVersion = (maxRow?.maxVersion ?? 0) + 1

          const contentPath = `${doc.type}/${doc.slug}/v${nextVersion}.md`
          await writeDocument(contentPath, parsed.content)

          const [row] = await tx
            .insert(documentVersion)
            .values({
              id: newId("docv"),
              documentId: doc.id,
              version: nextVersion,
              contentPath,
              contentHash,
              sizeBytes,
              source: parsed.source,
              threadId: parsed.threadId,
              spec: parsed.spec as any,
            })
            .returning()

          // Update parent document's content_hash and updated_at
          await tx
            .update(document)
            .set({
              contentHash,
              sizeBytes,
              updatedAt: new Date(),
            } as any)
            .where(eq(document.id, doc.id))

          return row
        })

        set.status = 201
        return { success: true, ...version }
      })
      // ── View rendered document ────────────────────────────────
      .get("/documents/:slugOrId/view", async ({ params, set }) => {
        const doc = await resolveDocument(db, params.slugOrId)
        if (!doc) {
          set.status = 404
          return { error: "Document not found" }
        }

        const [latestVersion] = await db
          .select()
          .from(documentVersion)
          .where(eq(documentVersion.documentId, doc.id))
          .orderBy(desc(documentVersion.version))
          .limit(1)

        const contentPath = latestVersion?.contentPath ?? doc.contentPath
        if (!contentPath || !(await documentExists(contentPath))) {
          set.status = 404
          return { error: "Document content not found" }
        }

        const buf = await readDocument(contentPath)
        const markdown = buf.toString("utf-8")
        const title = (doc.title as string) ?? doc.slug
        const version = latestVersion?.version ?? null
        const updatedAt = (doc as any).updatedAt
          ? new Date((doc as any).updatedAt).toLocaleString()
          : ""

        set.headers["content-type"] = "text/html; charset=utf-8"
        return renderMarkdownPage(title, markdown, version, updatedAt)
      })
      // ── Get latest content ──────────────────────────────────
      .get("/documents/:slugOrId/content", async ({ params, query, set }) => {
        const doc = await resolveDocument(db, params.slugOrId)
        if (!doc) {
          set.status = 404
          return { error: "Document not found" }
        }

        const versionParam = (query as Record<string, string | undefined>)
          ?.version
        const wantedVersion = versionParam
          ? Number.parseInt(versionParam, 10)
          : null

        let row: typeof documentVersion.$inferSelect | undefined
        if (wantedVersion != null && Number.isFinite(wantedVersion)) {
          ;[row] = await db
            .select()
            .from(documentVersion)
            .where(
              and(
                eq(documentVersion.documentId, doc.id),
                eq(documentVersion.version, wantedVersion)
              )
            )
            .limit(1)
        } else {
          ;[row] = await db
            .select()
            .from(documentVersion)
            .where(eq(documentVersion.documentId, doc.id))
            .orderBy(desc(documentVersion.version))
            .limit(1)
        }

        const contentPath = row?.contentPath ?? doc.contentPath
        if (!contentPath || !(await documentExists(contentPath))) {
          set.status = 404
          return { error: "Document content not found" }
        }

        const buf = await readDocument(contentPath)
        return {
          content: buf.toString("utf-8"),
          path: contentPath,
          version: row?.version ?? null,
        }
      })
  )
}

// ── Markdown rendering ─────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderMarkdownPage(
  title: string,
  markdown: string,
  version: number | null,
  updatedAt: string
): string {
  const versionStr = version ? ` (v${version})` : ""
  // marked.parse with default options sanitizes output (no raw HTML passthrough).
  // Content is from our own document store, not user-submitted HTML.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css">
  <style>
    body { background: #0d1117; padding: 2rem; margin: 0; }
    .container { max-width: 960px; margin: 0 auto; }
    .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 1rem; font-family: -apple-system, sans-serif; }
    .markdown-body { padding: 2rem; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
  </style>
</head>
<body>
  <div class="container">
    <div class="meta">${escapeHtml(title)}${versionStr}${updatedAt ? ` · updated ${escapeHtml(updatedAt)}` : ""}</div>
    <div class="markdown-body" id="content"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
  <script>
    const raw = marked.parse(${JSON.stringify(markdown)});
    document.getElementById("content").innerHTML = DOMPurify.sanitize(raw);
  </script>
</body>
</html>`
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const documentsOntologyConfigs: Pick<
  OntologyRouteConfig<any>,
  | "entity"
  | "singular"
  | "table"
  | "slugColumn"
  | "idColumn"
  | "prefix"
  | "kindAlias"
  | "createSchema"
>[] = [
  {
    entity: "documents",
    singular: "document",
    table: document,
    slugColumn: document.slug,
    idColumn: document.id,
    prefix: "doc",
    kindAlias: "document",
  },
]

function factoryBaseUrl(): string {
  return (
    process.env.FACTORY_URL ??
    process.env.BETTER_AUTH_BASE_URL ??
    "https://factory.lepton.software"
  ).replace(/\/$/, "")
}

/**
 * Plans index: one entry per document where type='plan', joined to its
 * latest version for sourceTurnId + version number. Mounted inside the
 * authenticated factory plane at GET /api/v1/factory/plans.
 */
export function plansController(db: Database) {
  return new Elysia({ prefix: "/plans" })
    .get("/", async ({ query }) => {
      const q = (query ?? {}) as Record<string, string | undefined>
      const limit = Math.min(
        Math.max(Number.parseInt(q.limit ?? "100", 10) || 100, 1),
        500
      )
      const offset = Math.max(Number.parseInt(q.offset ?? "0", 10) || 0, 0)

      const latestVersionSub = db
        .select({
          documentId: documentVersion.documentId,
          maxVersion: max(documentVersion.version).as("max_version"),
        })
        .from(documentVersion)
        .groupBy(documentVersion.documentId)
        .as("latest")

      const rows = await db
        .select({
          slug: document.slug,
          title: document.title,
          source: document.source,
          threadId: document.threadId,
          updatedAt: document.updatedAt,
          createdAt: document.createdAt,
          spec: document.spec,
          latestVersion: latestVersionSub.maxVersion,
          sourceTurnId: documentVersion.sourceTurnId,
        })
        .from(document)
        .leftJoin(
          latestVersionSub,
          eq(latestVersionSub.documentId, document.id)
        )
        .leftJoin(
          documentVersion,
          and(
            eq(documentVersion.documentId, document.id),
            eq(documentVersion.version, latestVersionSub.maxVersion)
          )
        )
        .where(eq(document.type, "plan"))
        .orderBy(desc(document.updatedAt))
        .limit(limit)
        .offset(offset)

      const base = factoryBaseUrl()
      return {
        plans: rows.map((r) => {
          const spec = (r.spec ?? {}) as Record<string, unknown>
          return {
            slug: r.slug,
            title: r.title,
            source: r.source,
            latestVersion: r.latestVersion ?? null,
            threadId: r.threadId,
            sourceTurnId: r.sourceTurnId,
            editCount: (spec.editCount as number | undefined) ?? 0,
            stub: (spec.stub as boolean | undefined) ?? false,
            updatedAt: r.updatedAt,
            createdAt: r.createdAt,
            viewUrl: `${base}/api/v1/factory/documents/${encodeURIComponent(r.slug)}/view`,
          }
        }),
        limit,
        offset,
      }
    })
    .get("/search", async ({ query }) => {
      const q = (query ?? {}) as Record<string, string | undefined>
      const term = (q.q ?? "").trim()
      const limit = Math.min(
        Math.max(Number.parseInt(q.limit ?? "50", 10) || 50, 1),
        200
      )
      if (term.length < 2) return { plans: [], q: term }

      const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

      const rows = await db.execute(sql`
      SELECT
        d.slug, d.title, d.source, d.thread_id, d.spec,
        d.created_at, d.updated_at,
        latest.max_version AS latest_version,
        latest.source_turn_id AS source_turn_id,
        CASE
          WHEN d.title ILIKE ${pattern} THEN 100
          WHEN d.slug ILIKE ${pattern} THEN 50
          ELSE 10
        END AS rank
      FROM org.document d
      LEFT JOIN LATERAL (
        SELECT version AS max_version, source_turn_id
        FROM org.document_version
        WHERE document_id = d.id
        ORDER BY version DESC
        LIMIT 1
      ) latest ON true
      WHERE d.type = 'plan'
        AND (
          d.title ILIKE ${pattern}
          OR d.slug ILIKE ${pattern}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              COALESCE(d.spec->'titleHistory', '[]'::jsonb)
            ) AS h(t) WHERE h.t ILIKE ${pattern}
          )
        )
      ORDER BY rank DESC, d.updated_at DESC
      LIMIT ${limit}
    `)

      const base = factoryBaseUrl()
      const plans = ((rows as any).rows ?? []).map((r: any) => {
        const spec = (r.spec ?? {}) as Record<string, unknown>
        return {
          slug: r.slug,
          title: r.title,
          source: r.source,
          latestVersion: r.latest_version ?? null,
          threadId: r.thread_id,
          sourceTurnId: r.source_turn_id ?? null,
          editCount: (spec.editCount as number | undefined) ?? 0,
          stub: (spec.stub as boolean | undefined) ?? false,
          updatedAt: r.updated_at,
          createdAt: r.created_at,
          viewUrl: `${base}/api/v1/factory/documents/${encodeURIComponent(r.slug)}/view`,
        }
      })
      return { plans, q: term }
    })
}

export function publicDocumentViewerController(db: Database) {
  return new Elysia({ prefix: "/api/v1/factory/documents" }).get(
    "/:slugOrId/view",
    async ({ params, set }) => {
      const doc = await resolveDocument(db, params.slugOrId)
      if (!doc) {
        set.status = 404
        return { error: "Document not found" }
      }

      const [latestVersion] = await db
        .select()
        .from(documentVersion)
        .where(eq(documentVersion.documentId, doc.id))
        .orderBy(desc(documentVersion.version))
        .limit(1)

      const contentPath = latestVersion?.contentPath ?? doc.contentPath
      if (!contentPath || !(await documentExists(contentPath))) {
        set.status = 404
        return { error: "Document content not found" }
      }

      const buf = await readDocument(contentPath)
      const markdown = buf.toString("utf-8")
      const title = (doc.title as string) ?? doc.slug
      const version = latestVersion?.version ?? null
      const updatedAt = (doc as any).updatedAt
        ? new Date((doc as any).updatedAt).toLocaleString()
        : ""

      set.headers["content-type"] = "text/html; charset=utf-8"
      return renderMarkdownPage(title, markdown, version, updatedAt)
    }
  )
}
