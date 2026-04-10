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
import { desc, eq, max } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { document, documentVersion } from "../../db/schema/org-v2"
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
      // ── Get latest content ──────────────────────────────────
      .get("/documents/:slugOrId/content", async ({ params, set }) => {
        const doc = await resolveDocument(db, params.slugOrId)
        if (!doc) {
          set.status = 404
          return { error: "Document not found" }
        }

        // Try latest version first
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
        return {
          content: buf.toString("utf-8"),
          path: contentPath,
          version: latestVersion?.version ?? null,
        }
      })
  )
}
