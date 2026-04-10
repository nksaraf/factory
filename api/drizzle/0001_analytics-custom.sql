-- Custom analytics objects that drizzle-kit cannot generate:
-- views, materialized views, PL/pgSQL functions, and their indexes.
-- This file is maintained manually alongside generated migrations.

CREATE SCHEMA IF NOT EXISTS "analytics";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- WEBHOOK EVENT ANALYTICS (base views)
-- ═══════════════════════════════════════════════════════════════════════════

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
  AND f."status" IS DISTINCT FROM 'failed';--> statement-breakpoint

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
  (we."spec" -> 'payload' -> 'pull_request' ->> 'number')::int        AS "pr_number",
  we."spec" -> 'payload' -> 'pull_request' ->> 'title'                AS "pr_title",
  we."spec" -> 'payload' -> 'pull_request' ->> 'html_url'             AS "pr_url",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'additions')::int     AS "additions",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'deletions')::int     AS "deletions",
  (we."spec" -> 'payload' -> 'pull_request' ->> 'changed_files')::int AS "changed_files",
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

-- ═══════════════════════════════════════════════════════════════════════════
-- MATERIALIZED VIEW + INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

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
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- THREAD / IDE SESSION ANALYTICS
-- ═══════════════════════════════════════════════════════════════════════════

-- Thread-level view: flattened token usage and session metadata
CREATE OR REPLACE VIEW "analytics"."v_thread_sessions" AS
SELECT
  th."id",
  th."type",
  th."source",
  th."external_id"                                                    AS "session_id",
  th."principal_id",
  th."agent_id",
  th."channel_id",
  th."status",
  th."repo_slug",
  th."branch",
  th."started_at",
  th."ended_at",
  th."created_at",
  th."spec" ->> 'title'                                               AS "title",
  th."spec" ->> 'model'                                               AS "model",
  th."spec" ->> 'cwd'                                                 AS "cwd",
  th."spec" ->> 'agentType'                                           AS "agent_type",
  (th."spec" ->> 'durationMinutes')::numeric                          AS "duration_minutes",
  (th."spec" ->> 'turnCount')::int                                    AS "turn_count",
  (th."spec" ->> 'toolCallCount')::int                                AS "tool_call_count",
  (th."spec" ->> 'toolErrorCount')::int                               AS "tool_error_count",
  th."spec" ->> 'version'                                             AS "cli_version",
  th."spec" ->> 'permissionMode'                                      AS "permission_mode",
  (th."spec" -> 'tokenUsage' ->> 'input')::bigint                    AS "tokens_input",
  (th."spec" -> 'tokenUsage' ->> 'output')::bigint                   AS "tokens_output",
  (th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint                AS "tokens_cache_read",
  (th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint               AS "tokens_cache_write",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)  AS "tokens_total",
  EXTRACT(EPOCH FROM (th."ended_at" - th."started_at")) / 60.0       AS "actual_duration_minutes",
  date_trunc('day', th."started_at")                                  AS "date_trunc_day",
  date_trunc('week', th."started_at")                                 AS "date_trunc_week",
  p."name"                                                            AS "principal_name",
  p."slug"                                                            AS "principal_slug",
  ch."name"                                                           AS "channel_name",
  ch."kind"                                                           AS "channel_kind"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
LEFT JOIN "org"."channel" ch ON th."channel_id" = ch."id"
WHERE th."type" = 'ide-session';--> statement-breakpoint

-- Daily token usage aggregation by principal and source
CREATE OR REPLACE VIEW "analytics"."v_daily_token_usage" AS
SELECT
  date_trunc('day', th."started_at")                                  AS "day",
  th."source",
  th."principal_id",
  p."name"                                                            AS "principal_name",
  p."slug"                                                            AS "principal_slug",
  COUNT(*)                                                            AS "session_count",
  SUM((th."spec" -> 'tokenUsage' ->> 'input')::bigint)               AS "tokens_input",
  SUM((th."spec" -> 'tokenUsage' ->> 'output')::bigint)              AS "tokens_output",
  SUM((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint)           AS "tokens_cache_read",
  SUM((th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint)          AS "tokens_cache_write",
  SUM(
    COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
  )                                                                   AS "tokens_total",
  AVG(
    COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
  )                                                                   AS "avg_tokens_per_session",
  SUM((th."spec" ->> 'turnCount')::int)                               AS "total_turns",
  AVG((th."spec" ->> 'turnCount')::numeric)                           AS "avg_turns_per_session",
  SUM((th."spec" ->> 'durationMinutes')::numeric)                     AS "total_duration_minutes",
  AVG((th."spec" ->> 'durationMinutes')::numeric)                     AS "avg_duration_minutes",
  SUM((th."spec" ->> 'toolCallCount')::int)                           AS "total_tool_calls",
  SUM((th."spec" ->> 'toolErrorCount')::int)                          AS "total_tool_errors"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session'
  AND th."spec" -> 'tokenUsage' IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;--> statement-breakpoint

-- Model usage breakdown: tokens by model, by day
CREATE OR REPLACE VIEW "analytics"."v_model_usage" AS
SELECT
  date_trunc('day', th."started_at")                                  AS "day",
  th."source",
  th."spec" ->> 'model'                                               AS "model",
  COUNT(*)                                                            AS "session_count",
  SUM((th."spec" -> 'tokenUsage' ->> 'input')::bigint)               AS "tokens_input",
  SUM((th."spec" -> 'tokenUsage' ->> 'output')::bigint)              AS "tokens_output",
  SUM((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint)           AS "tokens_cache_read",
  SUM((th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint)          AS "tokens_cache_write",
  SUM(
    COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
  )                                                                   AS "tokens_total",
  CASE WHEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
             + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)) > 0
    THEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
         / SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
             + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
    ELSE 0
  END                                                                 AS "cache_hit_ratio"
FROM "org"."thread" th
WHERE th."type" = 'ide-session'
  AND th."spec" ->> 'model' IS NOT NULL
GROUP BY 1, 2, 3;--> statement-breakpoint

-- Channel activity: tokens and sessions by workspace/channel
CREATE OR REPLACE VIEW "analytics"."v_channel_activity" AS
SELECT
  ch."id"                                                             AS "channel_id",
  ch."kind"                                                           AS "channel_kind",
  ch."name"                                                           AS "channel_name",
  ch."repo_slug"                                                      AS "repo_slug",
  COUNT(DISTINCT th."id")                                             AS "session_count",
  COUNT(DISTINCT th."principal_id")                                   AS "unique_principals",
  SUM(
    COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
  )                                                                   AS "tokens_total",
  AVG(
    COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
  )                                                                   AS "avg_tokens_per_session",
  MIN(th."started_at")                                                AS "first_session_at",
  MAX(th."started_at")                                                AS "last_session_at"
FROM "org"."channel" ch
LEFT JOIN "org"."thread" th ON th."channel_id" = ch."id" AND th."type" = 'ide-session'
GROUP BY 1, 2, 3, 4;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- ADOPTION & ENGAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- Weekly adoption trends: active users, sessions, new-user detection
CREATE OR REPLACE VIEW "analytics"."v_weekly_adoption" AS
WITH weekly AS (
  SELECT
    date_trunc('week', th."started_at")                   AS "week",
    th."source",
    th."principal_id",
    p."name"                                              AS "principal_name",
    p."slug"                                              AS "principal_slug",
    COUNT(*)                                              AS "session_count",
    SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
      + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "tokens_total",
    SUM((th."spec" ->> 'turnCount')::int)                 AS "total_turns",
    AVG((th."spec" ->> 'durationMinutes')::numeric)       AS "avg_duration_minutes"
  FROM "org"."thread" th
  LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
  WHERE th."type" = 'ide-session'
    AND th."started_at" IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
),
first_seen AS (
  SELECT
    "principal_id",
    "source",
    MIN(date_trunc('week', "started_at")) AS "first_week"
  FROM "org"."thread"
  WHERE "type" = 'ide-session' AND "started_at" IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  w."week",
  w."source",
  w."principal_id",
  w."principal_name",
  w."principal_slug",
  w."session_count",
  w."tokens_total",
  w."total_turns",
  w."avg_duration_minutes",
  (w."week" = fs."first_week")                            AS "is_first_week"
FROM weekly w
LEFT JOIN first_seen fs
  ON w."principal_id" = fs."principal_id"
  AND w."source" = fs."source";--> statement-breakpoint

-- Developer scoreboard: per-developer lifetime stats
CREATE OR REPLACE VIEW "analytics"."v_developer_scoreboard" AS
SELECT
  th."principal_id",
  p."name"                                                AS "principal_name",
  p."slug"                                                AS "principal_slug",
  COUNT(*) FILTER (WHERE th."source" = 'claude-code')     AS "claude_code_sessions",
  COUNT(*) FILTER (WHERE th."source" = 'conductor')       AS "conductor_sessions",
  COUNT(*) FILTER (WHERE th."source" = 'cursor')          AS "cursor_sessions",
  COUNT(*)                                                AS "total_sessions",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0))   AS "tokens_input",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "tokens_output",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))  AS "tokens_cache_read",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "tokens_total",
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "avg_tokens_per_session",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns_per_session",
  AVG((th."spec" ->> 'durationMinutes')::numeric)         AS "avg_duration_minutes",
  SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0))  AS "total_tool_calls",
  SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)) AS "total_tool_errors",
  MIN(th."started_at")                                    AS "first_session_at",
  MAX(th."started_at")                                    AS "last_session_at",
  COUNT(DISTINCT date_trunc('day', th."started_at"))      AS "active_days",
  COUNT(DISTINCT date_trunc('week', th."started_at"))     AS "active_weeks",
  COUNT(DISTINCT th."spec" ->> 'model')                   AS "models_used",
  COUNT(DISTINCT th."repo_slug")                          AS "repos_touched"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session'
GROUP BY th."principal_id", p."name", p."slug";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- SESSION EFFICIENCY & QUALITY
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_session_efficiency" AS
SELECT
  th."id",
  th."source",
  th."external_id"                                        AS "session_id",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  th."repo_slug",
  th."status",
  th."spec" ->> 'model'                                   AS "model",
  th."started_at",
  date_trunc('day', th."started_at")                      AS "day",
  (th."spec" ->> 'turnCount')::int                        AS "turn_count",
  (th."spec" ->> 'toolCallCount')::int                    AS "tool_call_count",
  (th."spec" ->> 'toolErrorCount')::int                   AS "tool_error_count",
  (th."spec" ->> 'durationMinutes')::numeric              AS "duration_minutes",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)   AS "tokens_input",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)  AS "tokens_output",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)  AS "tokens_cache_read",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint, 0) AS "tokens_cache_write",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0) AS "tokens_billable",
  CASE WHEN (th."spec" ->> 'turnCount')::int > 0
    THEN (COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
        + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))::numeric
        / (th."spec" ->> 'turnCount')::int
    ELSE NULL
  END                                                     AS "tokens_per_turn",
  CASE WHEN (th."spec" ->> 'turnCount')::int > 0
    THEN (th."spec" ->> 'toolCallCount')::numeric / (th."spec" ->> 'turnCount')::int
    ELSE NULL
  END                                                     AS "tool_calls_per_turn",
  CASE WHEN COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
          + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0) > 0
    THEN COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)::numeric
        / (COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
         + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
    ELSE NULL
  END                                                     AS "cache_hit_ratio",
  CASE WHEN COALESCE((th."spec" ->> 'toolCallCount')::int, 0) > 0
    THEN COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)::numeric
        / (th."spec" ->> 'toolCallCount')::int
    ELSE NULL
  END                                                     AS "tool_error_rate",
  CASE WHEN (th."spec" ->> 'durationMinutes')::numeric > 0
    THEN (COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))::numeric
        / (th."spec" ->> 'durationMinutes')::numeric
    ELSE NULL
  END                                                     AS "output_tokens_per_minute"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- TOOL USAGE PATTERNS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_tool_usage" AS
SELECT
  th."id"                                                 AS "thread_id",
  th."source",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  th."repo_slug",
  th."spec" ->> 'model'                                   AS "model",
  th."started_at",
  date_trunc('day', th."started_at")                      AS "day",
  tool.value #>> '{}'                                     AS "tool_name"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
CROSS JOIN jsonb_array_elements(th."spec" -> 'toolsUsed') AS tool
WHERE th."type" = 'ide-session'
  AND th."spec" -> 'toolsUsed' IS NOT NULL;--> statement-breakpoint

CREATE OR REPLACE VIEW "analytics"."v_tool_popularity" AS
SELECT
  tool.value #>> '{}'                                     AS "tool_name",
  th."source",
  COUNT(DISTINCT th."id")                                 AS "session_count",
  COUNT(DISTINCT th."principal_id")                       AS "unique_users",
  COUNT(DISTINCT th."repo_slug")                          AS "unique_repos",
  MIN(th."started_at")                                    AS "first_used_at",
  MAX(th."started_at")                                    AS "last_used_at"
FROM "org"."thread" th
CROSS JOIN jsonb_array_elements(th."spec" -> 'toolsUsed') AS tool
WHERE th."type" = 'ide-session'
  AND th."spec" -> 'toolsUsed' IS NOT NULL
GROUP BY 1, 2;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- PROJECT & REPO ACTIVITY
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_project_usage" AS
SELECT
  th."repo_slug",
  th."source",
  COUNT(*)                                                AS "session_count",
  COUNT(DISTINCT th."principal_id")                       AS "unique_developers",
  COUNT(DISTINCT th."spec" ->> 'model')                   AS "models_used",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "tokens_total",
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "avg_tokens_per_session",
  SUM(COALESCE((th."spec" ->> 'turnCount')::int, 0))     AS "total_turns",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns_per_session",
  SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0)) AS "total_tool_calls",
  SUM(COALESCE((th."spec" ->> 'durationMinutes')::numeric, 0)) AS "total_duration_minutes",
  MIN(th."started_at")                                    AS "first_session_at",
  MAX(th."started_at")                                    AS "last_session_at",
  COUNT(DISTINCT date_trunc('day', th."started_at"))      AS "active_days"
FROM "org"."thread" th
WHERE th."type" = 'ide-session'
  AND th."repo_slug" IS NOT NULL
GROUP BY th."repo_slug", th."source";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- TEMPORAL PATTERNS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_hourly_patterns" AS
SELECT
  EXTRACT(HOUR FROM th."started_at")::int                 AS "hour_of_day",
  EXTRACT(DOW FROM th."started_at")::int                  AS "day_of_week",
  th."source",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  COUNT(*)                                                AS "session_count",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "tokens_total",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session'
  AND th."started_at" IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- TURN-LEVEL ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_turn_details" AS
SELECT
  tt."id"                                                 AS "turn_id",
  tt."thread_id",
  th."source",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  th."repo_slug",
  tt."role",
  tt."turn_index",
  tt."created_at",
  date_trunc('day', tt."created_at")                      AS "day",
  tt."spec" ->> 'model'                                   AS "model",
  tt."spec" ->> 'category'                                AS "category",
  (tt."spec" -> 'tokenUsage' ->> 'input')::bigint        AS "tokens_input",
  (tt."spec" -> 'tokenUsage' ->> 'output')::bigint       AS "tokens_output",
  (tt."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint    AS "tokens_cache_read",
  (tt."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint   AS "tokens_cache_write",
  COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
                                                          AS "tokens_total",
  (tt."spec" ->> 'toolCallCount')::int                    AS "tool_call_count",
  tt."spec" -> 'toolCalls'                                AS "tool_calls",
  length(tt."spec" ->> 'content')                         AS "content_length",
  length(tt."spec" ->> 'summary')                         AS "summary_length"
FROM "org"."thread_turn" tt
JOIN "org"."thread" th ON tt."thread_id" = th."id"
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session';--> statement-breakpoint

CREATE OR REPLACE VIEW "analytics"."v_thread_turn_stats" AS
SELECT
  tt."thread_id",
  th."source",
  th."principal_id",
  th."repo_slug",
  th."spec" ->> 'model'                                   AS "model",
  th."started_at",
  date_trunc('day', th."started_at")                      AS "day",
  COUNT(*)                                                AS "turn_count",
  COUNT(*) FILTER (WHERE tt."role" = 'user')              AS "user_turns",
  COUNT(*) FILTER (WHERE tt."role" = 'assistant')         AS "assistant_turns",
  AVG(COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "avg_tokens_per_turn",
  MAX(COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "max_tokens_in_turn",
  AVG(length(tt."spec" ->> 'content'))                    AS "avg_content_length",
  MAX(length(tt."spec" ->> 'content'))                    AS "max_content_length",
  SUM(COALESCE((tt."spec" ->> 'toolCallCount')::int, 0)) AS "total_tool_calls"
FROM "org"."thread_turn" tt
JOIN "org"."thread" th ON tt."thread_id" = th."id"
WHERE th."type" = 'ide-session'
GROUP BY tt."thread_id", th."source", th."principal_id",
  th."repo_slug", th."spec" ->> 'model', th."started_at";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- WEBHOOK EVENT PIPELINE (hook adoption tracking)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_event_flow" AS
SELECT
  date_trunc('day', we."created_at")                      AS "day",
  we."source",
  we."event_type",
  COUNT(*)                                                AS "event_count",
  COUNT(DISTINCT we."entity_id")                          AS "unique_sessions"
FROM "org"."webhook_event" we
WHERE we."source" IN ('claude-code', 'conductor', 'cursor')
GROUP BY 1, 2, 3;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- SOURCE COMPARISON
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_source_comparison" AS
SELECT
  th."source",
  COUNT(*)                                                AS "total_sessions",
  COUNT(DISTINCT th."principal_id")                       AS "unique_users",
  COUNT(DISTINCT th."repo_slug")                          AS "unique_repos",
  COUNT(DISTINCT th."spec" ->> 'model')                   AS "unique_models",
  COUNT(*) FILTER (WHERE th."status" = 'completed')       AS "completed_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'active')          AS "active_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'failed')          AS "failed_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'abandoned')       AS "abandoned_sessions",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0))  AS "tokens_input",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)) AS "tokens_output",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))  AS "tokens_cache_read",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))     AS "tokens_billable",
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))     AS "avg_tokens_per_session",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns_per_session",
  AVG((th."spec" ->> 'durationMinutes')::numeric)         AS "avg_duration_minutes",
  SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0)) AS "total_tool_calls",
  SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)) AS "total_tool_errors",
  CASE WHEN SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0)) > 0
    THEN SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0))::numeric
        / SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0))
    ELSE 0
  END                                                     AS "tool_error_rate",
  CASE WHEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
           + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)) > 0
    THEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
        / SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
           + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
    ELSE 0
  END                                                     AS "cache_hit_ratio",
  MIN(th."started_at")                                    AS "first_session_at",
  MAX(th."started_at")                                    AS "last_session_at"
FROM "org"."thread" th
WHERE th."type" = 'ide-session'
GROUP BY th."source";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- SESSION STATUS & COMPLETION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_daily_session_status" AS
SELECT
  date_trunc('day', th."started_at")                      AS "day",
  th."source",
  th."status",
  COUNT(*)                                                AS "session_count",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns",
  AVG((th."spec" ->> 'durationMinutes')::numeric)         AS "avg_duration_minutes",
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "avg_tokens"
FROM "org"."thread" th
WHERE th."type" = 'ide-session'
  AND th."started_at" IS NOT NULL
GROUP BY 1, 2, 3;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- SUBAGENT ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "analytics"."v_subagent_activity" AS
SELECT
  th."id"                                                 AS "thread_id",
  th."source",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  th."repo_slug",
  date_trunc('day', th."started_at")                      AS "day",
  (SELECT COUNT(*) FROM "org"."webhook_event" we
    WHERE we."source" = th."source"
      AND we."entity_id" = th."external_id"
      AND we."event_type" = 'thread.subagent_summary')    AS "subagent_count",
  (th."spec" ->> 'turnCount')::int                        AS "turn_count",
  (th."spec" ->> 'toolCallCount')::int                    AS "tool_call_count",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
                                                          AS "tokens_total"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session'
  AND EXISTS (
    SELECT 1 FROM "org"."webhook_event" we
    WHERE we."source" = th."source"
      AND we."entity_id" = th."external_id"
      AND we."event_type" = 'thread.subagent_summary'
  );
