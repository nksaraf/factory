-- Comprehensive analytics views for adoption tracking, efficiency analysis,
-- and operational dashboards. Builds on the thread/turn/webhook_event data
-- to power Metabase dashboards.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ADOPTION & ENGAGEMENT
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
  -- Per-source session counts
  COUNT(*) FILTER (WHERE th."source" = 'claude-code')     AS "claude_code_sessions",
  COUNT(*) FILTER (WHERE th."source" = 'conductor')       AS "conductor_sessions",
  COUNT(*) FILTER (WHERE th."source" = 'cursor')          AS "cursor_sessions",
  COUNT(*)                                                AS "total_sessions",
  -- Token totals
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0))   AS "tokens_input",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "tokens_output",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))  AS "tokens_cache_read",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "tokens_total",
  -- Averages
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))  AS "avg_tokens_per_session",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns_per_session",
  AVG((th."spec" ->> 'durationMinutes')::numeric)         AS "avg_duration_minutes",
  -- Tool usage
  SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0))  AS "total_tool_calls",
  SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)) AS "total_tool_errors",
  -- Active range
  MIN(th."started_at")                                    AS "first_session_at",
  MAX(th."started_at")                                    AS "last_session_at",
  COUNT(DISTINCT date_trunc('day', th."started_at"))      AS "active_days",
  COUNT(DISTINCT date_trunc('week', th."started_at"))     AS "active_weeks",
  -- Distinct models and repos
  COUNT(DISTINCT th."spec" ->> 'model')                   AS "models_used",
  COUNT(DISTINCT th."repo_slug")                          AS "repos_touched"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session'
GROUP BY th."principal_id", p."name", p."slug";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SESSION EFFICIENCY & QUALITY
-- ═══════════════════════════════════════════════════════════════════════════

-- Per-session efficiency metrics for scatter plots and distributions
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
  -- Counts
  (th."spec" ->> 'turnCount')::int                        AS "turn_count",
  (th."spec" ->> 'toolCallCount')::int                    AS "tool_call_count",
  (th."spec" ->> 'toolErrorCount')::int                   AS "tool_error_count",
  (th."spec" ->> 'durationMinutes')::numeric              AS "duration_minutes",
  -- Tokens
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)   AS "tokens_input",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)  AS "tokens_output",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)  AS "tokens_cache_read",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint, 0) AS "tokens_cache_write",
  COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0) AS "tokens_billable",
  -- Efficiency ratios
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
  -- Cache efficiency: what fraction of input context was served from cache
  CASE WHEN COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
          + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0) > 0
    THEN COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)::numeric
        / (COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
         + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
    ELSE NULL
  END                                                     AS "cache_hit_ratio",
  -- Tool error rate
  CASE WHEN COALESCE((th."spec" ->> 'toolCallCount')::int, 0) > 0
    THEN COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)::numeric
        / (th."spec" ->> 'toolCallCount')::int
    ELSE NULL
  END                                                     AS "tool_error_rate",
  -- Tokens per minute (throughput)
  CASE WHEN (th."spec" ->> 'durationMinutes')::numeric > 0
    THEN (COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))::numeric
        / (th."spec" ->> 'durationMinutes')::numeric
    ELSE NULL
  END                                                     AS "output_tokens_per_minute"
FROM "org"."thread" th
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. TOOL USAGE PATTERNS
-- ═══════════════════════════════════════════════════════════════════════════

-- Exploded tool usage: one row per (session, tool) for frequency analysis
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

-- Aggregated tool popularity: how often each tool appears across sessions
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
-- 4. PROJECT & REPO ACTIVITY
-- ═══════════════════════════════════════════════════════════════════════════

-- AI usage by repository
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
-- 5. TEMPORAL PATTERNS
-- ═══════════════════════════════════════════════════════════════════════════

-- Hour-of-day activity heatmap data
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
-- 6. TURN-LEVEL ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════

-- Thread turns flattened: per-turn tokens, model, tool calls
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
  -- Turn-level metadata from spec
  tt."spec" ->> 'model'                                   AS "model",
  tt."spec" ->> 'category'                                AS "category",
  (tt."spec" -> 'tokenUsage' ->> 'input')::bigint        AS "tokens_input",
  (tt."spec" -> 'tokenUsage' ->> 'output')::bigint       AS "tokens_output",
  (tt."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint    AS "tokens_cache_read",
  (tt."spec" -> 'tokenUsage' ->> 'cacheWrite')::bigint   AS "tokens_cache_write",
  COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)
                                                          AS "tokens_total",
  -- Tool call info
  (tt."spec" ->> 'toolCallCount')::int                    AS "tool_call_count",
  tt."spec" -> 'toolCalls'                                AS "tool_calls",
  -- Content length (proxy for complexity)
  length(tt."spec" ->> 'content')                         AS "content_length",
  length(tt."spec" ->> 'summary')                         AS "summary_length"
FROM "org"."thread_turn" tt
JOIN "org"."thread" th ON tt."thread_id" = th."id"
LEFT JOIN "org"."principal" p ON th."principal_id" = p."id"
WHERE th."type" = 'ide-session';--> statement-breakpoint

-- Per-thread turn distribution: min/max/avg tokens per turn
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
  -- Token stats across turns
  AVG(COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "avg_tokens_per_turn",
  MAX(COALESCE((tt."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((tt."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))
                                                          AS "max_tokens_in_turn",
  -- Content length stats (complexity proxy)
  AVG(length(tt."spec" ->> 'content'))                    AS "avg_content_length",
  MAX(length(tt."spec" ->> 'content'))                    AS "max_content_length",
  -- Tool usage across turns
  SUM(COALESCE((tt."spec" ->> 'toolCallCount')::int, 0)) AS "total_tool_calls"
FROM "org"."thread_turn" tt
JOIN "org"."thread" th ON tt."thread_id" = th."id"
WHERE th."type" = 'ide-session'
GROUP BY tt."thread_id", th."source", th."principal_id",
  th."repo_slug", th."spec" ->> 'model', th."started_at";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. WEBHOOK EVENT PIPELINE (live hooks vs backfill)
-- ═══════════════════════════════════════════════════════════════════════════

-- Event flow: counts by type, source, and day — to track hook adoption
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
-- 8. SOURCE COMPARISON
-- ═══════════════════════════════════════════════════════════════════════════

-- Side-by-side source comparison (one row per source)
CREATE OR REPLACE VIEW "analytics"."v_source_comparison" AS
SELECT
  th."source",
  COUNT(*)                                                AS "total_sessions",
  COUNT(DISTINCT th."principal_id")                       AS "unique_users",
  COUNT(DISTINCT th."repo_slug")                          AS "unique_repos",
  COUNT(DISTINCT th."spec" ->> 'model')                   AS "unique_models",
  -- Completion
  COUNT(*) FILTER (WHERE th."status" = 'completed')       AS "completed_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'active')          AS "active_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'failed')          AS "failed_sessions",
  COUNT(*) FILTER (WHERE th."status" = 'abandoned')       AS "abandoned_sessions",
  -- Tokens
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0))  AS "tokens_input",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0)) AS "tokens_output",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))  AS "tokens_cache_read",
  SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))     AS "tokens_billable",
  -- Averages
  AVG(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
    + COALESCE((th."spec" -> 'tokenUsage' ->> 'output')::bigint, 0))     AS "avg_tokens_per_session",
  AVG((th."spec" ->> 'turnCount')::numeric)               AS "avg_turns_per_session",
  AVG((th."spec" ->> 'durationMinutes')::numeric)         AS "avg_duration_minutes",
  -- Tool stats
  SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0)) AS "total_tool_calls",
  SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0)) AS "total_tool_errors",
  CASE WHEN SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0)) > 0
    THEN SUM(COALESCE((th."spec" ->> 'toolErrorCount')::int, 0))::numeric
        / SUM(COALESCE((th."spec" ->> 'toolCallCount')::int, 0))
    ELSE 0
  END                                                     AS "tool_error_rate",
  -- Cache efficiency
  CASE WHEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
           + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0)) > 0
    THEN SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
        / SUM(COALESCE((th."spec" -> 'tokenUsage' ->> 'input')::bigint, 0)
           + COALESCE((th."spec" -> 'tokenUsage' ->> 'cacheRead')::bigint, 0))::numeric
    ELSE 0
  END                                                     AS "cache_hit_ratio",
  -- Date range
  MIN(th."started_at")                                    AS "first_session_at",
  MAX(th."started_at")                                    AS "last_session_at"
FROM "org"."thread" th
WHERE th."type" = 'ide-session'
GROUP BY th."source";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. SESSION STATUS & COMPLETION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

-- Daily session status breakdown (completed/active/failed/abandoned)
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
-- 10. SUBAGENT ANALYSIS (from webhook events)
-- ═══════════════════════════════════════════════════════════════════════════

-- Subagent summaries from thread.subagent_summary events
CREATE OR REPLACE VIEW "analytics"."v_subagent_activity" AS
SELECT
  th."id"                                                 AS "thread_id",
  th."source",
  th."principal_id",
  p."slug"                                                AS "principal_slug",
  th."repo_slug",
  date_trunc('day', th."started_at")                      AS "day",
  -- Count subagent-related webhook events
  (SELECT COUNT(*) FROM "org"."webhook_event" we
    WHERE we."source" = th."source"
      AND we."entity_id" = th."external_id"
      AND we."event_type" = 'thread.subagent_summary')    AS "subagent_count",
  -- Thread-level stats for context
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
