/**
 * Documents controller.
 *
 * Generic document store: plans, PRDs, HLDs, LLDs, ADRs, decks, etc.
 * Content lives on filesystem; metadata in org.document table.
 *
 * Routes:
 *   /documents/documents              → CRUD via ontologyRoutes
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
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "documents",
          singular: "document",
          table: document,
          slugColumn: document.id,
          idColumn: document.id,
          createSchema: CreateDocumentSchema,
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
          hooks: {
            beforeCreate: async ({ parsed }) => {
              const p = parsed as Record<string, unknown>
              // If content is provided, write to filesystem
              if (typeof p.content === "string" && typeof p.path === "string") {
                const content = p.content as string
                await writeDocument(p.path as string, content)
                p.sizeBytes = Buffer.byteLength(content, "utf-8")
                delete p.content
              }
              return parsed
            },
          },
        })
      )
      // Custom GET for content retrieval (actions are POST, but content is a read op)
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
