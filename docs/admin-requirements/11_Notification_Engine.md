# Step 11 — Notification Engine

**Phase:** 2A
**Depends on:** 03, 05, 10
**Blocks:** 16, 21
**Owner:** Backend
**Estimated effort:** 5 days

---

## 1. Goal

Consume `notify.requested` events (from Step 10 alert escalations, and later from other producers), resolve them into concrete deliveries across channels (in-app, email, SMS, push, voice, webhook), respect per-user preferences and quiet hours, and guarantee exactly-once delivery per (recipient, event, channel).

## 2. Why now

Step 10 emits escalation events; without a delivery layer they go nowhere. Also consolidates the 3 different email/SMS paths currently living in the product (alert email cron, invite email from auth, report scheduler).

## 3. Scope

### In scope

- Channel adapters: `in_app`, `email`, `sms`, `push` (FCM/APNs), `voice` (Twilio), `webhook`.
- Recipient resolution: role-based (e.g. "all operators in Pune") → concrete user list.
- User preferences: `enterprise.user_notification_pref` (per-channel, per-category, quiet hours).
- Retry policy: exponential backoff, max 5 attempts, dead-letter queue.
- Rate limit per user per channel (`notifications.rate_limit_per_user_hour`).
- Delivery audit (who got what, when, via which channel, provider message-id).
- Templating: handlebars with allowlisted vars; i18n via locale.

### Out of scope

- Marketing/transactional split and unsubscribe CAN-SPAM flows — Phase 2.
- Bring-your-own SMTP per customer — Phase 2.
- Slack/Teams channels — Phase 2 (webhook covers).

## 4. Deliverables

1. `@lepton/notifications` package with channel adapters + dispatcher.
2. Tables: `admin.notification_event`, `admin.notification_delivery`, `enterprise.user_notification_pref`, `admin.notification_template`.
3. Worker `notification-dispatcher`.
4. Provider integrations: Postmark (email), Twilio (SMS + voice), FCM + APNs (push).
5. In-app feed endpoint `GET /me/notifications` (consumed by product UI).

## 5. Design

### 5.1 Event contract

```ts
interface NotifyRequest {
  id: string // idempotency key
  category: "alert" | "invite" | "report" | "billing" | "system" | "demo"
  severity: "info" | "low" | "medium" | "high" | "critical"
  customerId: string
  orgId?: string
  recipients: RecipientRef[] // resolved lazily
  channels: Channel[] // requested channels
  templateKey: string // e.g. 'alert.opened'
  data: Record<string, unknown> // handlebars vars
  ttlSeconds?: number // drop if not delivered by now+ttl
  correlation?: { alertId?: string; ruleId?: string }
}

type RecipientRef =
  | { kind: "user"; userId: string }
  | {
      kind: "role"
      roleKey: string
      scope: { type: "org" | "customer"; id: string }
    }
  | { kind: "email"; address: string } // for invites
  | { kind: "webhook"; url: string; secretRef: string }
```

Producers enqueue onto Redis Stream `notify:requests`. Consumer group `dispatcher`.

### 5.2 Tables

```sql
CREATE TABLE admin.notification_event (
  id           UUID PRIMARY KEY,
  category     VARCHAR(24) NOT NULL,
  severity     VARCHAR(16) NOT NULL,
  customer_id  UUID NOT NULL,
  org_id       UUID,
  template_key VARCHAR(120) NOT NULL,
  payload      JSONB NOT NULL,
  correlation  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin.notification_delivery (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES admin.notification_event(id),
  recipient_user_id UUID,
  recipient_address TEXT,
  channel       VARCHAR(16) NOT NULL
                CHECK (channel IN ('in_app','email','sms','push','voice','webhook')),
  state         VARCHAR(24) NOT NULL
                CHECK (state IN ('queued','sending','sent','failed','suppressed','expired')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  provider_msg_id TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient_user_id, channel),
  UNIQUE (event_id, recipient_address, channel)
);
CREATE INDEX idx_delivery_state ON admin.notification_delivery(state, created_at);

CREATE TABLE enterprise.user_notification_pref (
  user_id       UUID PRIMARY KEY REFERENCES enterprise.user(id),
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  sms_enabled   BOOLEAN NOT NULL DEFAULT true,
  push_enabled  BOOLEAN NOT NULL DEFAULT true,
  voice_enabled BOOLEAN NOT NULL DEFAULT false,
  categories    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {alert:{email:true,sms:false},...}
  quiet_hours   JSONB,                               -- {tz,start,end,days,suppress:['sms','voice']}
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin.notification_template (
  key          VARCHAR(120) PRIMARY KEY,
  locale       VARCHAR(8)  NOT NULL DEFAULT 'en',
  channel      VARCHAR(16) NOT NULL,
  subject      TEXT,
  body         TEXT NOT NULL,
  variables    TEXT[] NOT NULL,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, locale, channel)
);
```

### 5.3 Dispatcher flow

```
redis stream → consumer (at-least-once)
  → load event, write notification_event row (idempotent on id)
  → expand recipients (role → users via RBAC; Step 05)
  → for each (recipient, channel):
       apply user pref → if disabled, state=suppressed
       apply quiet hours → if quiet and channel in suppress, state=suppressed (or defer)
       apply rate limit → if exceeded, state=suppressed
       else insert delivery row (state=queued)
  → per-channel worker picks up queued rows, sends, updates state
  → on failure: exponential backoff (30s, 2m, 8m, 30m, 2h), cap 5 attempts → state=failed, DLQ
```

All deliveries idempotent by unique constraint; duplicate event re-consume is a no-op.

### 5.4 Role → user resolution

```ts
async function resolveRole(roleKey, scope): Promise<UserId[]> {
  // members of the given scope with role template roleKey, status=active
  return db("enterprise.member_organization_role")
    .join("enterprise.user", "user.id", "member.user_id")
    .where({
      "member.role_template_key": roleKey,
      "member.scope_type": scope.type,
      "member.scope_id": scope.id,
      "user.status": "active",
    })
    .pluck("user.id")
}
```

Cached 60s per `(roleKey, scope)`.

### 5.5 Templating

Handlebars, strict mode, allowlisted helpers (`formatTime`, `formatSpeed`, `url`). No raw HTML eval. Templates live in DB so Lepton Admin can edit them (Step 21). A default set seeded at migration time (`alert.opened`, `alert.escalated`, `invite.sent`, `report.ready`, `billing.past_due`, `demo.started`, etc.).

### 5.6 Channels

| Channel | Provider                              | Notes                                                                      |
| ------- | ------------------------------------- | -------------------------------------------------------------------------- |
| in_app  | DB-only (read by `/me/notifications`) | Always attempted, never suppressed by pref.                                |
| email   | Postmark                              | Replyable `From` per customer branding (Step 03 `branding.from_email`).    |
| sms     | Twilio                                | Respect country DND; 160-char cap; critical severity only by default.      |
| push    | FCM (Android) + APNs (iOS)            | Device tokens from mobile app (Step 22).                                   |
| voice   | Twilio programmable voice             | TTS-synthesized message; only `critical` severity, only for on-call roles. |
| webhook | Signed POST                           | HMAC-SHA256 header `X-Lepton-Signature` with secret from Secrets Manager.  |

### 5.7 Quiet hours / severity override

If `quiet_hours.respect_critical=false` (default true), `critical` severity bypasses quiet hours and rate limits. Logged as `notification.quiet_hours_bypassed`.

## 6. Enforcement / Runtime

- Every send goes through `dispatch()`; no direct provider calls elsewhere in the codebase (CI lint).
- Rate limiter uses Redis sliding window keyed by `(user_id, channel)`.
- Secrets (Twilio/Postmark keys) loaded from Secrets Manager via `secret_ref` pattern (Step 09).

## 7. Configuration surface

| Key                                         | Scope    | Default                           |
| ------------------------------------------- | -------- | --------------------------------- |
| `notifications.channels_enabled`            | customer | `["in_app","email","sms","push"]` |
| `notifications.rate_limit_per_user_hour`    | customer | 30                                |
| `notifications.sms_countries_allowed`       | customer | `["IN"]`                          |
| `notifications.voice_enabled`               | customer | false                             |
| `notifications.from_email`                  | customer | `alerts@trafficure.ai`            |
| `notifications.webhook_default_timeout_ms`  | customer | 5000                              |
| `notifications.critical_bypass_quiet_hours` | customer | true                              |

UI: Customer Admin edits at `Org Settings → Notifications`; Super Admin edits defaults in Lepton Admin → Config (Step 21).

## 8. Migration plan

1. Build tables + dispatcher behind flag `flags.notify_engine_v2`.
2. Seed templates mirroring current email bodies.
3. Shadow-mode: new engine computes deliveries and writes rows as `suppressed:shadow`; old cron still sends.
4. Diff delivery counts for 72h.
5. Flip to live per customer; delete legacy paths after 14 days.

## 9. Acceptance criteria

1. A `notify.requested` with the same `id` re-enqueued ≤ 1 delivery row per (user, channel).
2. User with `email_enabled=false` receives zero emails.
3. Quiet hours suppress SMS but not in_app, unless severity=critical and `critical_bypass_quiet_hours=true`.
4. Rate limit exceeded → `state=suppressed, last_error='rate_limited'`.
5. Webhook receivers verify HMAC successfully using documented algorithm.
6. Provider outage → rows stay `queued`, retry with backoff; DLQ after 5 attempts.
7. `/me/notifications` returns unread in_app deliveries ordered by recency.

## 10. Test plan

### Unit

- Template renderer: unknown variable → render error (surfaced, not silent).
- Quiet hours logic across DST boundary in Asia/Kolkata.
- HMAC signing round-trip.

### Integration

- Fire 1k synthetic alert events; verify exactly-once per (user, channel).
- Simulate Postmark 500s; confirm backoff schedule.
- User flips email_enabled mid-stream; in-flight delivery still sends (pref evaluated at dispatch time, not at send time), next event suppressed.

### Contract

- Webhook receiver test harness validates signature against docs.

## 11. Edge cases

| Case                                | Behavior                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| User has no email on file           | channel=email → `state=suppressed, last_error='no_address'`.                           |
| Role has zero members               | Event logged; no delivery rows created; metric `notifications_empty_recipients_total`. |
| TTL expired before dispatch         | `state=expired`.                                                                       |
| Duplicate delivery unique violation | Treated as successful idempotent no-op.                                                |
| User deleted before send            | Suppress with reason `user_inactive`.                                                  |
| Customer branding changes mid-send  | Delivery uses snapshot at dispatch time.                                               |

## 12. Observability

- `notification_dispatch_duration_ms` histogram.
- `notification_delivered_total{channel,category,severity}`.
- `notification_failed_total{channel,reason}`.
- `notification_suppressed_total{reason}`.
- `notification_queue_depth{channel}` gauge.
- Log ERROR on any DLQ enqueue with redacted payload.

## 13. Audit events

- `notification.sent` (per delivery) — excludes PII body, keeps template_key + correlation.
- `notification.failed`, `notification.suppressed{reason}`.
- `notification_pref.updated` — user changes their prefs.
- `notification_template.updated` — admin edits template.

## 14. Open questions

- Q1. Do we store rendered bodies? Recommendation: only for email in `notification_delivery.rendered_snapshot` for 30 days, for support forensics. SMS/voice not stored.
- Q2. Should webhook retries be customer-configurable? Recommendation: yes — `notifications.webhook_max_attempts` per customer, capped at 10.
- Q3. Mobile push without device token → silent-drop or surface? Recommendation: surface in user settings ("enable push in mobile app"); do not count as failure.
