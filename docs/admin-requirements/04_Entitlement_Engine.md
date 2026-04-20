# Step 04 — Entitlement Engine

**Phase:** 1A
**Depends on:** 01, 03
**Blocks:** 05, 14, 16, 18, 22
**Owner:** Backend
**Estimated effort:** 5 days

---

## 1. Goal

Build the middleware that enforces every customer-level limit, module access, and quota at request time. After this step, any backend endpoint that wraps itself in `withEntitlement(key, cost?)` will automatically block over-quota or disabled-module requests with a structured error, consume from the Redis counter when applicable, and emit a usage record to PostgreSQL.

## 2. Why now

Without this engine, module toggles and limits (Step 03 keys `modules.*`, `limits.*`) are data with no teeth. Every subsequent feature (alerts, Ask AI, exports) must call it. The RBAC engine (Step 05) composes on top of entitlements — entitlement failure short-circuits before permissions are even checked.

## 3. Scope

### In scope

- Entitlement-check middleware for HTTP (Express/Fastify) and for job handlers.
- Redis counter scheme for real-time quota enforcement (sliding + monthly windows).
- `platform.usage_log` table (partitioned monthly) for durable history.
- Monthly reset job (`resetMonthlyCounters`) triggered by cron.
- `429 entitlement_exceeded` error shape.
- Typed helpers for the common patterns:
  - `checkModule(ctx, module)` — throws if module disabled
  - `checkLimit(ctx, key)` — throws if limit == 0 or hard block
  - `consumeQuota(ctx, key, amount)` — increments counter, blocks if over

### Out of scope

- Invoice generation — Step 14.
- UI for viewing usage — Step 18.
- Soft-limit warning emails — Step 11.

## 4. Deliverables

1. Migration `20260418_001_usage_log.sql` (+ monthly partition creator function).
2. `packages/entitlement-engine/` TS package with middleware + helpers.
3. Redis key schema doc committed at `packages/entitlement-engine/README.md`.
4. Cron job `cron/reset_monthly_counters.ts`.
5. Typed errors module `packages/errors/src/entitlement.ts`.

## 5. Design

### 5.1 `platform.usage_log`

Append-only durable record of every quota-consuming action.

```sql
CREATE TABLE platform.usage_log (
    id              BIGSERIAL,
    customer_id     UUID         NOT NULL REFERENCES platform.customer(id),
    org_id          UUID         REFERENCES enterprise.organization(id),
    user_id         UUID         REFERENCES enterprise.user(id),
    entitlement_key VARCHAR(128) NOT NULL REFERENCES platform.config_key(key),
    amount          INT          NOT NULL DEFAULT 1,
    request_id      UUID,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    metadata        JSONB        NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Monthly partitions, auto-created by platform.ensure_usage_log_partition()
CREATE INDEX idx_usage_log_cust_time
  ON platform.usage_log (customer_id, occurred_at DESC);
CREATE INDEX idx_usage_log_key_time
  ON platform.usage_log (entitlement_key, occurred_at DESC);
```

Partition manager:

```sql
CREATE OR REPLACE FUNCTION platform.ensure_usage_log_partition(p_month DATE) RETURNS VOID AS $$
DECLARE
    start_d DATE := DATE_TRUNC('month', p_month);
    end_d   DATE := start_d + INTERVAL '1 month';
    part_name TEXT := 'usage_log_' || TO_CHAR(start_d, 'YYYY_MM');
BEGIN
    EXECUTE FORMAT(
      'CREATE TABLE IF NOT EXISTS platform.%I PARTITION OF platform.usage_log
       FOR VALUES FROM (%L) TO (%L)', part_name, start_d, end_d);
END;
$$ LANGUAGE plpgsql;
```

A cron at month-turn +5 min runs `ensure_usage_log_partition(now())` and `ensure_usage_log_partition(now() + interval '1 month')`.

### 5.2 Redis key schema

Real-time counters live in Redis for sub-ms reads.

| Purpose             | Key                                           | TTL     | Notes                                        |
| ------------------- | --------------------------------------------- | ------- | -------------------------------------------- |
| Monthly consumed    | `ent:monthly:{customerId}:{key}:{YYYY-MM}`    | 35 days | Incremented on every consume; resets via TTL |
| Sliding-minute      | `ent:minute:{customerId}:{key}:{epochMinute}` | 70 sec  | For RPM enforcement                          |
| Concurrent sessions | `ent:sessions:{userId}`                       | 0 (set) | Set of session IDs                           |
| Module gate cache   | `ent:module:{customerId}:{module}`            | 60 sec  | Cached from ConfigClient                     |

### 5.3 Middleware

```ts
// packages/entitlement-engine/src/middleware.ts
export interface EntitlementCtx {
  customerId: string
  orgId?: string
  userId?: string
  requestId: string
}

export function withEntitlement(spec: {
  module?: string
  limitKey?: string
  cost?: number | ((req) => number)
}) {
  return async (req, res, next) => {
    const ctx: EntitlementCtx = req.entitlementCtx
    try {
      if (spec.module) await checkModule(ctx, spec.module)
      if (spec.limitKey) {
        const cost =
          typeof spec.cost === "function" ? spec.cost(req) : (spec.cost ?? 1)
        await consumeQuota(ctx, spec.limitKey, cost)
      }
      next()
    } catch (e) {
      next(e) // handled by error middleware → 429 entitlement_exceeded
    }
  }
}
```

Usage in an endpoint:

```ts
router.post(
  "/ask-ai/query",
  withEntitlement({
    module: "modules.citypulse_ask_ai",
    limitKey: "limits.ask_ai_monthly",
    cost: 1,
  }),
  askAiHandler
)

router.post(
  "/exports/traffic",
  withEntitlement({
    module: "modules.data_export_api",
    limitKey: "limits.export_rows_per_request",
    cost: (req) => req.body.expectedRows,
  }),
  exportHandler
)
```

### 5.4 `consumeQuota` algorithm

```ts
export async function consumeQuota(ctx, key, amount) {
  const meta = await configClient.getMeta(key) // returns { type, unit, ... }
  const limit = await configClient.getInt(key, { customerId: ctx.customerId })
  const policy = await configClient.get<string>("billing.overage_policy", {
    customerId: ctx.customerId,
  })

  if (key.endsWith("_monthly")) {
    const month = new Date().toISOString().slice(0, 7)
    const rk = `ent:monthly:${ctx.customerId}:${key}:${month}`
    const used = await redis.incrby(rk, amount)
    await redis.expire(rk, 35 * 86400)

    if (used > limit) {
      if (policy === "block") throw new EntitlementExceeded(key, limit, used)
      if (policy === "warn_only") emitSoftWarn(ctx, key, limit, used)
      // 'allow_and_charge' → proceed; overage surfaces in Step 14
    }
  } else if (key.endsWith("_rpm")) {
    const min = Math.floor(Date.now() / 60000)
    const rk = `ent:minute:${ctx.customerId}:${key}:${min}`
    const used = await redis.incrby(rk, amount)
    await redis.expire(rk, 70)
    if (used > limit) throw new EntitlementExceeded(key, limit, used)
  } else {
    // Hard-block numeric limits like segment_limit — counted against a live count query, not Redis
    const live = await getCurrentCount(ctx, key)
    if (live + amount > limit) throw new EntitlementExceeded(key, limit, live)
  }

  // Durable record
  await pg.query(
    `INSERT INTO platform.usage_log
     (customer_id, org_id, user_id, entitlement_key, amount, request_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ctx.customerId, ctx.orgId, ctx.userId, key, amount, ctx.requestId]
  )
}
```

### 5.5 `checkModule`

```ts
export async function checkModule(ctx, module) {
  const enabled = await configClient.getBool(module, {
    customerId: ctx.customerId,
  })
  if (!enabled) throw new ModuleDisabled(module)
}
```

### 5.6 Error shapes

```ts
// packages/errors/src/entitlement.ts
export class EntitlementExceeded extends AppError {
  code = "entitlement_exceeded"
  httpStatus = 429
  constructor(
    public key: string,
    public limit: number,
    public used: number
  ) {
    super(`Quota ${key} exceeded: ${used} > ${limit}`)
  }
  toJSON() {
    return {
      error: this.code,
      entitlement: this.key,
      limit: this.limit,
      used: this.used,
      retry_after: this.key.endsWith("_rpm") ? 60 : firstOfNextMonth(),
    }
  }
}

export class ModuleDisabled extends AppError {
  code = "module_disabled"
  httpStatus = 403
  constructor(public module: string) {
    super(`Module ${module} is not enabled`)
  }
}
```

## 6. Enforcement / Runtime

- **HTTP**: `withEntitlement` mounted inside the auth middleware but before the scope middleware.
- **Jobs**: workers call `consumeQuota(ctx, key, amount)` directly; on throw, the job is dead-lettered.
- **Read paths that shouldn't consume** (e.g. rendering a dashboard) do `checkModule` only.

## 7. Configuration surface

- Customer Detail → Entitlements tab (Step 18) edits `limits.*`, `modules.*`.
- Usage tab on same screen reads from `platform.usage_log` + Redis counters.

## 8. Migration plan

| Env     | Step                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev     | Create table, partitions for current + next month. Unit + integration tests pass.                                                                                                                     |
| Staging | Same. Smoke test: an Ask AI call increments counter.                                                                                                                                                  |
| Prod    | DDL safe; no table-scan backfill. Roll out middleware behind a feature flag (`flags.entitlement_enforcement`) so it can be killed instantly if it misbehaves. Flip the flag per-customer over a week. |

## 9. Acceptance criteria

1. POSTing to `/ask-ai/query` 501 times in a month for a customer with `limits.ask_ai_monthly=500` returns `429 entitlement_exceeded` on request 501 under policy `block`.
2. Same customer under `warn_only` succeeds on request 501 but emits a soft-warn log.
3. A customer with `modules.citypulse_ask_ai=false` gets `403 module_disabled` on request 1.
4. A customer's monthly counter resets at 00:00 UTC on the 1st of the month (next Redis key is used automatically; durable records in `usage_log` remain).
5. Deleting `platform.usage_log` rows is impossible without explicit partition drop by ops (no DELETE by app).
6. `withEntitlement` middleware raises no error for a request with no `limitKey` and a disabled `module` only if `module` is not passed.

## 10. Test plan

### Unit

- Counter increment/decrement correctness.
- Overage policy branches: block / warn_only / allow_and_charge.
- Error JSON shape matches spec.
- Partition creator is idempotent.

### Integration

- Simulate 1,000 concurrent requests under a 100-request limit with 2 instances — no more than 100 succeed (Redis single-source-of-truth).
- Kill Redis mid-burst; verify requests fail _closed_ (5xx, not bypass).
- Month-rollover race: increment at `23:59:59.999` lands in correct bucket.

### Load

- 5,000 req/s across 4 instances for 5 min — p95 overhead of middleware < 3ms.

## 11. Edge cases & errors

| Case                                                     | Behavior                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Redis unreachable                                        | Fail closed: return 503. Never silently bypass.                                                                    |
| PostgreSQL unreachable for usage_log write               | Queue write to in-memory buffer; flush on recovery. Request proceeds (pre-flight Redis check already passed).      |
| Negative `cost`                                          | Rejected at middleware; 400.                                                                                       |
| Clock skew across instances                              | Monthly bucket derived from UTC; minute bucket from epoch. Tolerated up to 2s skew.                                |
| Customer archived mid-month                              | `consumeQuota` checks `lifecycle_state`; if not `active`, throws `customer_inactive` (code: `customer_suspended`). |
| User with multiple customer memberships (cross-customer) | The `customerId` in `ctx` is set by scope middleware based on current org; there's always exactly one per request. |

## 12. Observability

- Metric: `entitlement_check_duration_ms{key}` histogram.
- Metric: `entitlement_exceeded_total{customer_id,key,policy}` counter.
- Metric: `entitlement_redis_errors_total`.
- Log: every `EntitlementExceeded` WARN-level with full context.
- Trace: span `entitlement.consume` wraps `consumeQuota`.

## 13. Audit events emitted

- `entitlement.exceeded` (category: `entitlement_event`) — every block, not every consume.
- `entitlement.policy_changed` — when overage policy is modified (via config write — Step 03 emits this already).

## 14. Open questions

- Q1. For `allow_and_charge`, do we charge the moment they exceed or at end-of-month invoice? Recommendation: end-of-month roll-up; per-event micro-charges are expensive to bill.
- Q2. Should we expose a read-only "current usage" endpoint to Client Admin module? Recommendation: yes, in Phase 2. For Phase 1, Lepton Admin only.
- Q3. Do we want a `grace_pct` (e.g. 10% over the limit before 429)? Recommendation: no; customers can raise their own limit by upgrading. Grace encourages ambiguity.
