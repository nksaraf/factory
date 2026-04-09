-- Thread-based analytics views for IDE session token usage and activity.
-- Extends the "analytics" schema with views on org.thread / org.thread_turn.

-- GIN index on thread spec JSONB for extraction performance.
CREATE INDEX IF NOT EXISTS "org_thread_spec_gin_idx"
  ON "org"."thread" USING gin ("spec");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "org_thread_turn_spec_gin_idx"
  ON "org"."thread_turn" USING gin ("spec");--> statement-breakpoint

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
  -- Session metadata from spec
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
  -- Token usage
  (th."spec" -> 'tokenUsage' ->> 'input')::bigint                    AS "tokens_input",
  (th."spec" -> 'tokenUsage' ->> 'output')::bigint                   AS "tokens_output",
  (th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint                AS "tokens_cache_read",
  (th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint               AS "tokens_cache_write",
  -- Derived
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)  AS "tokens_total",
  EXTRACT(EPOCH FROM (th."ended_at" - th."started_at")) / 60.0       AS "actual_duration_minutes",
  date_trunc('day', th."started_at")                                  AS "date_trunc_day",
  date_trunc('week', th."started_at")                                 AS "date_trunc_week",
  -- Principal info
  p."name"                                                            AS "principal_name",
  p."slug"                                                            AS "principal_slug",
  -- Channel info
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
  -- Cache hit ratio: cacheRead / (input + cacheRead)
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
GROUP BY 1, 2, 3, 4;
