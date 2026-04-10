-- Document Store
-- Generic document metadata table for plans, PRDs, HLDs, LLDs, ADRs, decks, etc.
-- Filesystem-backed content, Postgres metadata.

CREATE TABLE IF NOT EXISTS "org"."document" (
  "id"           text PRIMARY KEY,
  "path"         text NOT NULL,
  "type"         text NOT NULL,
  "source"       text,
  "title"        text,
  "thread_id"    text REFERENCES "org"."thread"("id") ON DELETE SET NULL,
  "channel_id"   text REFERENCES "org"."channel"("id") ON DELETE SET NULL,
  "version"      integer,
  "parent_id"    text REFERENCES "org"."document"("id") ON DELETE SET NULL,
  "content_hash" text,
  "size_bytes"   integer,
  "spec"         jsonb DEFAULT '{}' NOT NULL,
  "created_at"   timestamptz DEFAULT now() NOT NULL
); --> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "org_document_path_unique" ON "org"."document" ("path"); --> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_document_thread_idx" ON "org"."document" ("thread_id"); --> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_document_type_idx" ON "org"."document" ("type"); --> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_document_parent_idx" ON "org"."document" ("parent_id"); --> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_document_source_idx" ON "org"."document" ("source"); --> statement-breakpoint
