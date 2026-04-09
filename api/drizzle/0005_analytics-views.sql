-- Analytics views for webhook_events
-- Creates a dedicated "analytics" schema with flattened views
-- for Metabase/Grafana consumption.

CREATE SCHEMA IF NOT EXISTS "analytics";--> statement-breakpoint

-- GIN index on spec JSONB for extraction performance
CREATE INDEX IF NOT EXISTS "org_webhook_event_spec_gin_idx"
  ON "org"."webhook_event" USING gin ("spec");--> statement-breakpoint

-- Base flattened view: extracts all useful fields from spec JSONB
CREATE OR REPLACE VIEW "analytics"."v_webhook_event_flat" AS
SELECT
  we."id",
  we."source",
  we."provider_id",
  we."delivery_id",
  we."actor_id",
  we."event_type",
  we."entity_id",
  we."created_at",
  -- Extracted from spec JSONB
  we."spec" ->> 'eventType'                            AS "raw_event_type",
  we."spec" ->> 'action'                               AS "action",
  we."spec" ->> 'status'                               AS "status",
  we."spec" ->> 'reason'                               AS "reason",
  we."spec" ->> 'error'                                AS "error",
  (we."spec" ->> 'processedAt')::timestamptz           AS "processed_at",
  we."spec" -> 'actor' ->> 'externalId'                AS "actor_external_id",
  we."spec" -> 'actor' ->> 'externalUsername'           AS "actor_external_username",
  we."spec" -> 'entity' ->> 'externalRef'              AS "entity_external_ref",
  we."spec" -> 'entity' ->> 'kind'                     AS "entity_kind",
  -- Derived columns
  we."source" IN ('cursor', 'claude-code', 'windsurf') AS "is_ai_source",
  split_part(we."event_type", '.', 1)                  AS "event_domain",
  EXTRACT(EPOCH FROM (
    (we."spec" ->> 'processedAt')::timestamptz - we."created_at"
  )) * 1000                                            AS "processing_latency_ms",
  EXTRACT(HOUR FROM we."created_at")                   AS "hour_of_day",
  EXTRACT(ISODOW FROM we."created_at")                 AS "day_of_week",
  date_trunc('day', we."created_at")                   AS "date_trunc_day",
  date_trunc('week', we."created_at")                  AS "date_trunc_week"
FROM "org"."webhook_event" we;--> statement-breakpoint

-- Developer activity: joins principal + team for easy grouping
CREATE OR REPLACE VIEW "analytics"."v_developer_activity" AS
SELECT
  f.*,
  p."name"  AS "principal_name",
  p."slug"  AS "principal_slug",
  p."type"  AS "principal_type",
  t."name"  AS "team_name",
  t."slug"  AS "team_slug"
FROM "analytics"."v_webhook_event_flat" f
LEFT JOIN "org"."principal" p ON f."actor_id" = p."id"
LEFT JOIN "org"."membership" m ON p."id" = m."principal_id"
LEFT JOIN "org"."team" t ON m."team_id" = t."id"
WHERE f."event_type" IS NOT NULL
  AND f."status" != 'failed';--> statement-breakpoint

-- AI tool events: pre-filtered with IDE-specific payload extraction
CREATE OR REPLACE VIEW "analytics"."v_ai_events" AS
SELECT
  f.*,
  p."name"                                                   AS "principal_name",
  p."slug"                                                   AS "principal_slug",
  -- IDE session fields
  we."spec" -> 'payload' ->> 'sessionId'                     AS "session_id",
  we."spec" -> 'payload' ->> 'project'                       AS "project",
  we."spec" -> 'payload' ->> 'model'                         AS "ai_model",
  (we."spec" -> 'payload' ->> 'durationMinutes')::numeric    AS "duration_minutes",
  (we."spec" -> 'payload' ->> 'turnCount')::int              AS "turn_count",
  (we."spec" -> 'payload' -> 'tokenUsage' ->> 'input')::bigint      AS "tokens_input",
  (we."spec" -> 'payload' -> 'tokenUsage' ->> 'output')::bigint     AS "tokens_output",
  (we."spec" -> 'payload' -> 'tokenUsage' ->> 'cacheRead')::bigint  AS "tokens_cache_read",
  (we."spec" -> 'payload' -> 'tokenUsage' ->> 'cacheWrite')::bigint AS "tokens_cache_write"
FROM "analytics"."v_webhook_event_flat" f
JOIN "org"."webhook_event" we ON f."id" = we."id"
LEFT JOIN "org"."principal" p ON f."actor_id" = p."id"
WHERE f."is_ai_source" = true;--> statement-breakpoint

-- PR lifecycle: GitHub PR events with extracted metadata
CREATE OR REPLACE VIEW "analytics"."v_pr_lifecycle" AS
SELECT
  f."id",
  f."actor_id",
  f."actor_external_username",
  f."entity_id",
  f."entity_external_ref"                                              AS "repo",
  f."event_type",
  f."status",
  f."created_at",
  f."date_trunc_day",
  f."date_trunc_week",
  -- PR-specific payload fields
  (we."spec" -> 'payload' -> 'pull_request' ->> 'number')::int        AS "pr_number",
  we."spec" -> 'payload' -> 'pull_request' ->> 'title'                AS "pr_title",
  we."spec" -> 'payload' -> 'pull_request' ->> 'html_url'             AS "pr_url",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'additions')::int     AS "additions",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'deletions')::int     AS "deletions",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'changed_files')::int AS "changed_files",
  -- Does this PR author also use AI tools?
  EXISTS (
    SELECT 1 FROM "org"."webhook_event" ai
    WHERE ai."source" IN ('cursor', 'claude-code', 'windsurf')
      AND ai."actor_id" = f."actor_id"
      AND ai."actor_id" IS NOT NULL
  )                                                                    AS "actor_uses_ai_tools",
  p."name"                                                             AS "principal_name",
  p."slug"                                                             AS "principal_slug"
FROM "analytics"."v_webhook_event_flat" f
JOIN "org"."webhook_event" we ON f."id" = we."id"
LEFT JOIN "org"."principal" p ON f."actor_id" = p."id"
WHERE f."source" = 'github'
  AND f."event_type" LIKE 'code.pr.%';--> statement-breakpoint

-- System health: processing status, failures, latency
CREATE OR REPLACE VIEW "analytics"."v_system_health" AS
SELECT
  f."id",
  f."source",
  f."provider_id",
  f."event_type",
  f."status",
  f."reason",
  f."error",
  f."created_at",
  f."processed_at",
  f."processing_latency_ms",
  f."date_trunc_day",
  f."hour_of_day"
FROM "analytics"."v_webhook_event_flat" f;--> statement-breakpoint

-- Pre-aggregated daily activity summary (materialized for dashboard performance)
CREATE MATERIALIZED VIEW "analytics"."mv_daily_activity_summary" AS
SELECT
  date_trunc('day', we."created_at")                               AS "day",
  we."source",
  we."event_type",
  we."actor_id",
  we."source" IN ('cursor', 'claude-code', 'windsurf')             AS "is_ai_source",
  we."spec" ->> 'status'                                           AS "status",
  COUNT(*)                                                         AS "event_count",
  COUNT(DISTINCT we."actor_id")
    FILTER (WHERE we."actor_id" IS NOT NULL)                       AS "unique_actors",
  COUNT(*)
    FILTER (WHERE we."spec" ->> 'status' = 'failed')               AS "failed_count",
  AVG(
    EXTRACT(EPOCH FROM (
      (we."spec" ->> 'processedAt')::timestamptz - we."created_at"
    )) * 1000
  ) FILTER (WHERE we."spec" ->> 'processedAt' IS NOT NULL)        AS "avg_latency_ms"
FROM "org"."webhook_event" we
WHERE we."created_at" >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1, 2, 3, 4, 5, 6
WITH DATA;--> statement-breakpoint

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX "analytics_mv_daily_summary_unique"
  ON "analytics"."mv_daily_activity_summary" (
    "day", "source",
    COALESCE("event_type", ''),
    COALESCE("actor_id", ''),
    "is_ai_source",
    COALESCE("status", '')
  );--> statement-breakpoint

CREATE INDEX "analytics_mv_daily_summary_day_idx"
  ON "analytics"."mv_daily_activity_summary" ("day");--> statement-breakpoint

CREATE INDEX "analytics_mv_daily_summary_source_day_idx"
  ON "analytics"."mv_daily_activity_summary" ("source", "day");--> statement-breakpoint

CREATE INDEX "analytics_mv_daily_summary_actor_day_idx"
  ON "analytics"."mv_daily_activity_summary" ("actor_id", "day");--> statement-breakpoint

CREATE INDEX "analytics_mv_daily_summary_ai_day_idx"
  ON "analytics"."mv_daily_activity_summary" ("is_ai_source", "day");--> statement-breakpoint

-- Convenience function to refresh the materialized view
CREATE OR REPLACE FUNCTION "analytics"."refresh_views"()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY "analytics"."mv_daily_activity_summary";
END;
$$ LANGUAGE plpgsql;
