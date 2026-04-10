/**
 * Documents controller.
 *
 * Generic document store: plans, PRDs, HLDs, LLDs, ADRs, decks, etc.
 * Content lives on filesystem; metadata in org.document table.
 *
 * Routes:
 *   /documents/documents              → LIST/GET/UPDATE/DELETE via ontologyRoutes
 *   /documents/documents              → POST upserts by path (custom handler)
 *   /documents/documents/:id/content  → GET document content from filesystem
 *   /documents/documents/:id/versions → GET version history (via relations)
 */
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
} from "@smp/factory-shared/schemas/org"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { document } from "../../db/schema/org-v2"
import { ontologyRoutes } from "../../lib/crud"
import { documentExists, readDocument, writeDocument } from "./storage"

export function documentsController(db: Database) {
  return (
    new Elysia({ prefix: "/documents" })
      // Custom upsert endpoint — must come BEFORE ontologyRoutes to take priority
      .post("/documents", async ({ body, set }) => {
        const parsed = CreateDocumentSchema.parse(body)
        const p = parsed as Record<string, unknown>

        // Write content to filesystem if provided
        if (typeof p.content === "string" && typeof p.path === "string") {
          const content = p.content as string
          await writeDocument(p.path as string, content)
          p.sizeBytes = Buffer.byteLength(content, "utf-8")
          delete p.content
        }

        // Check if document with same path already exists → upsert
        const [existing] = await db
          .select()
          .from(document)
          .where(eq(document.path, p.path as string))
          .limit(1)

        if (existing) {
          const { path: _path, ...updateFields } = p
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
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "documents",
          singular: "document",
          table: document,
          slugColumn: document.id,
          idColumn: document.id,
          // No createSchema — we handle create via the custom upsert POST above
          updateSchema: UpdateDocumentSchema,
          deletable: true,
          relations: {
            versions: {
              path: "versions",
              table: document,
              fk: document.parentId,
              orderBy: document.version,
            },
          },
        })
      )
      // Custom GET for content retrieval
      .get("/documents/:slugOrId/content", async ({ params, set }) => {
        const [entity] = await db
          .select()
          .from(document)
          .where(eq(document.id, params.slugOrId))
          .limit(1)
        if (!entity) {
          set.status = 404
          return { error: "Document not found" }
        }
        if (!(await documentExists(entity.path))) {
          set.status = 404
          return { error: "Document content not found on filesystem" }
        }
        const buf = await readDocument(entity.path)
        return { content: buf.toString("utf-8"), path: entity.path }
      })
  )
}
