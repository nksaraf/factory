# Step 15 — Auth: Impersonation & Internal MFA (Minimal)

**Phase:** 2
**Depends on:** 01, 02, 06
**Blocks:** 16, 17
**Owner:** Backend
**Estimated effort:** 4 days

---

## 1. Goal

Enable Lepton internal staff to authenticate with TOTP MFA and for super_admins to impersonate customer users with full audit, time-box constraints, and endpoint restrictions. No customer-facing MFA or SSO in this phase.

## 2. Why now

Lepton Admin (Steps 17–21) grants super_admins access to every customer. Without MFA + impersonation audit + session binding, one compromised employee = breach of all tenants. Impersonation is critical for debugging and support.

## 3. Scope

### In scope

- **MFA for internal staff only**: TOTP enrollment + challenge for `platform_role != 'user'` (Lepton team).
- **Impersonation session**: super_admin acts as a customer user with:
  - Red banner on UI indicating impersonation mode.
  - Full audit trail: start, actions, end.
  - 30-minute expiry (hard stop).
  - Impersonator cannot change passwords or call `admin.*` or `billing.*` endpoints.
- **Session table**: `platform.impersonation_session` with full context and audit refs.
- **MFA table**: `enterprise.user_mfa_totp` with encrypted secrets, verified timestamp, last-used tracking, backup codes.

### Out of scope

- **SSO (SAML/OIDC)** — Phase 2, post-enterprise deals.
- **WebAuthn / Passkeys** — Phase 2.
- **MFA policy engine** — Phase 2 (will allow per-org MFA enforcement).
- **Customer-side MFA** — Phase 2.
- **MFA grace periods, exemptions, or mass lockout handling** — Phase 2.
- **Passwordless flows** — Phase 2.
- **Hardware key attestation** — Phase 3.

Deferred items explicitly listed above will be addressed in a future auth step.

## 4. Deliverables

1. `platform.impersonation_session` table and indexes.
2. `enterprise.user_mfa_totp` table for internal staff TOTP factors.
3. Five new endpoints for MFA and impersonation (listed below).
4. Middleware to enforce impersonation constraints (no `admin.*` / `billing.*` endpoints).
5. Audit event types for MFA and impersonation lifecycle.
6. Metrics for enrollment, challenge, and session activity.

## 5. Design

### 5.1 Tables

```sql
CREATE TABLE enterprise.user_mfa_totp (
  user_id              UUID PRIMARY KEY REFERENCES enterprise.user(id) ON DELETE CASCADE,
  secret_encrypted     BYTEA NOT NULL,            -- TOTP seed, encrypted at rest
  verified_at          TIMESTAMPTZ NOT NULL,      -- when MFA was first confirmed
  last_used_at         TIMESTAMPTZ,               -- last successful TOTP challenge
  backup_codes_hashed  TEXT[] NOT NULL DEFAULT '{}',  -- hashed backup codes
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_totp_verified ON enterprise.user_mfa_totp(user_id) WHERE verified_at IS NOT NULL;

CREATE TABLE platform.impersonation_session (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id      UUID NOT NULL REFERENCES enterprise.user(id),
  target_user_id     UUID NOT NULL REFERENCES enterprise.user(id),
  target_customer_id UUID NOT NULL REFERENCES platform.customer(id),
  reason             TEXT NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  ip                 INET,
  user_agent         TEXT,
  audit_refs         UUID[] NOT NULL DEFAULT '{}',  -- refs to impersonation_started, impersonation_ended audit events
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_imp_active ON platform.impersonation_session(actor_user_id) WHERE ended_at IS NULL;
CREATE INDEX idx_imp_target ON platform.impersonation_session(target_user_id) WHERE ended_at IS NULL;
```

Also extend the Better Auth `session` table:

```sql
ALTER TABLE session
  ADD COLUMN impersonation_session_id UUID REFERENCES platform.impersonation_session(id) ON DELETE SET NULL,
  ADD COLUMN auth_method VARCHAR(16) NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password', 'sso', 'recovery')),
  ADD COLUMN amr TEXT[] NOT NULL DEFAULT '{}';  -- Authentication Methods Reference: ['pwd','totp']
```

### 5.2 MFA Enrollment & Challenge Flow

**POST /admin/mfa/totp/enroll** (internal staff only)

- Request: none (uses current user context)
- Response:
  ```json
  {
    "otpauth_url": "otpauth://totp/TraffiCure:user%40lepton.io?secret=...",
    "qr_data_uri": "data:image/png;base64,...",
    "temporary_secret": "xxxxx" (base32, for manual entry)
  }
  ```
- Idempotent: calling again before confirmation returns new QR.

**POST /admin/mfa/totp/verify** (internal staff only)

- Request:
  ```json
  {
    "code": "123456" // 6-digit TOTP
  }
  ```
- Response on success:
  ```json
  {
    "verified": true,
    "backup_codes": ["code1", "code2", ..., "code10"],
    "message": "MFA enabled. Save backup codes in secure location."
  }
  ```
- On failure: `400 mfa.totp_invalid` with retry count hint.
- Sets `verified_at` timestamp on `user_mfa_totp` row.

### 5.3 Impersonation Flow

**POST /admin/impersonation/start** (super_admin only)

- Request:
  ```json
  {
    "target_user_id": "<uuid>",
    "reason": "Debugging alert rule for customer XYZ"
  }
  ```
- Response:
  ```json
  {
    "impersonation_session_id": "<uuid>",
    "target_customer_id": "<uuid>",
    "expires_at": "2026-04-15T19:32:00Z",
    "message": "You are impersonating user@customer.io. All actions are audited."
  }
  ```
- Creates `platform.impersonation_session` row.
- Emits `auth.impersonation_started` audit event.
- Validation:
  - Caller must be `platform_role = 'super_admin'`.
  - Target user must exist.
  - Target user must not already be impersonated.
  - Reason must be non-empty.

**POST /admin/impersonation/stop** (super_admin only)

- Request: none (uses impersonation_session_id from session context)
- Response:
  ```json
  {
    "message": "Impersonation session ended."
  }
  ```
- Sets `ended_at` on the session.
- Emits `auth.impersonation_ended` audit event.

**GET /admin/impersonation/active** (super_admin only)

- Response:
  ```json
  {
    "active_sessions": [
      {
        "id": "<uuid>",
        "target_user_id": "<uuid>",
        "target_customer_id": "<uuid>",
        "started_at": "2026-04-15T19:02:00Z",
        "expires_at": "2026-04-15T19:32:00Z",
        "reason": "..."
      }
    ]
  }
  ```

### 5.4 Constraints & Middleware

**Impersonation Expiry**

- Sessions expire after exactly 30 minutes. On request, middleware checks `started_at + 30min > now()`.
- If expired, return `410 impersonation.session_expired` and clear session.

**Endpoint Restrictions During Impersonation**

- If request has active impersonation_session_id:
  - Block: any `POST /admin/*`, `DELETE /admin/*`, `PATCH /admin/*` (all mutations).
  - Block: any `POST /billing/*`, `GET /billing/history`.
  - Allow: read-only `/admin/*` and customer operations in scope.
  - Allow: POST `/auth/logout` (to end the impersonation cleanly).
- Return `403 impersonation.forbidden_endpoint` if blocked.

**Red Banner on UI**

- Frontend receives `impersonation_session_id` in session token claims.
- If present, render fixed top banner: "🚨 You are impersonating <target_user_email>. All actions are logged. Session expires at <time>."
- Banner includes [End Impersonation] button → calls `POST /admin/impersonation/stop`.

## 6. Enforcement / Runtime

- MFA challenge is performed by Better Auth middleware on `POST /auth/login` for users with `platform_role != 'user'`.
- Impersonation session context is passed through request lifecycle (similar to scope middleware).
- Middleware enforces endpoint restrictions before routing to handler.

## 7. Configuration surface

- `auth.mfa_required_for_internal = true` (enforces MFA enrollment for `platform_role != 'user'`).
- `auth.impersonation_session_ttl_minutes = 30` (expiry window).
- `auth.mfa_totp_window_size = 1` (TOTP time window tolerance, ±30s).

## 8. Migration plan

1. **Stage 1** (Day 1–2): Deploy tables, endpoints, audit event types.
2. **Stage 2** (Day 2–3): Enable MFA enrollment for internal staff (not enforced yet).
3. **Stage 3** (Day 3–4): Enforce MFA on login; enable impersonation; frontend banner.
4. **Rollback**: Disable `auth.mfa_required_for_internal`, revert impersonation endpoints to 404.

Database migration:

- Create tables in dev/staging with fixtures.
- Backfill: mark existing internal users with `user_mfa_totp.verified_at = NOW()` and random secret (for testing).
- Test: verify MFA challenge flow and impersonation constraints in staging.
- Prod deployment: tables first, then code, then enforcement flag.

## 9. Acceptance criteria

1. MFA TOTP enrollment returns otpauth URL and QR that can be scanned by authenticator apps (Google Authenticator, Authy, etc.).
2. Verification code accepts current and ±1 time window (RFC 6238).
3. Backup codes (10x, alphanumeric) are generated and can be used in place of TOTP if provided.
4. Impersonation session expires exactly 30 minutes after start; no refresh.
5. Active impersonation blocks all `admin.*` and `billing.*` mutations; read-only ops allowed.
6. Impersonation session expired error is `410` with code `impersonation.session_expired`.
7. Red banner renders on frontend when impersonation_session_id is in token.
8. All MFA and impersonation events appear in audit log with actor, target, timestamp, request_id.

## 10. Test plan

- **Unit tests**:
  - TOTP code generation and validation (current + time window).
  - Backup code hashing and matching.
  - Impersonation expiry logic.
  - Endpoint restriction middleware.
- **Integration tests**:
  - Full MFA enrollment → verify flow via HTTP.
  - Impersonation start → active check → stop flow.
  - Try to call `POST /admin/...` during impersonation (should fail).
  - Try to call `POST /billing/...` during impersonation (should fail).
  - Audit events emitted correctly.
- **Manual/E2E**:
  - Scan QR with authenticator app; verify TOTP code works.
  - Use backup codes (and verify they can only be used once).
  - Start impersonation, see banner on UI, perform read-only operations, end impersonation.
  - Let impersonation session expire; verify next request returns 410.

## 11. Edge cases & errors

| Case                                          | Behavior                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| User tries to enroll MFA twice                | Idempotent: returns new QR for pending enrollment. If already verified, reject with `mfa.already_enrolled`.   |
| Invalid TOTP code (5 wrong attempts in 5 min) | Lock out user temporarily (5 min backoff). Return `429` with retry-after.                                     |
| Impersonation expires during active session   | Middleware returns `410 impersonation.session_expired`; frontend clears banner and redirects to `/dashboard`. |
| Try to impersonate another super_admin        | Reject with `403 impersonation.forbidden` (can only impersonate customer-tier users).                         |
| Impersonate user, then delete that user       | Impersonation becomes invalid; next request gets `410 impersonation.session_expired`.                         |
| Backup code used twice                        | Reject with `mfa.backup_code_already_used`.                                                                   |

## 12. Observability

**Metrics** (follow `<domain>_<noun>_<unit>` pattern):

```
auth_mfa_enrollment_total{status}
  — Count of TOTP enrollments (label: status ∈ {started, verified, failed})

auth_mfa_challenge_total{result}
  — Count of TOTP challenge attempts (label: result ∈ {success, invalid_code, locked_out})

auth_impersonation_sessions_active
  — Gauge: number of active impersonation sessions

auth_impersonation_duration_seconds
  — Histogram: lifetime of completed impersonation sessions (from started_at to ended_at)
```

**Logs**:

- MFA enrollment: user_id, status, timestamp.
- MFA challenge: user_id, result, timestamp.
- Impersonation start: actor_id, target_id, target_customer_id, reason, timestamp.
- Impersonation stop: actor_id, reason (normal / expired / error), timestamp.

**Alerts**:

- If `auth_mfa_challenge_total{result=locked_out}` > threshold in 5m window, notify ops (possible brute-force).

## 13. Audit events

- **`auth.mfa_enrolled`**: TOTP successfully verified. Fields: user_id, actor_id (self), timestamp.
- **`auth.mfa_challenged`**: TOTP code provided. Fields: user_id, actor_id (self), result (success|invalid), timestamp.
- **`auth.impersonation_started`**: Impersonation session created. Fields: actor_user_id, target_user_id, target_customer_id, reason, session_id, timestamp.
- **`auth.impersonation_ended`**: Impersonation session ended. Fields: actor_user_id, target_user_id, session_id, end_reason (normal|expired|error), timestamp.

All events include `request_id`, `ip`, `user_agent`.

## 14. Open questions

- Q1. Should backup codes be printed/downloadable, or only shown once on enrollment? Recommendation: show once on verification screen; user must save. No re-download.
- Q2. Should we log every TOTP-protected endpoint call, or only MFA challenges? Recommendation: log only challenges and enrollments; per-endpoint logs are noisy.
- Q3. If impersonation expires mid-request, should we commit or rollback? Recommendation: rollback any mutations; read-only ops allowed to complete.
- Q4. Should super_admins be able to impersonate other super_admins for debugging? Recommendation: no — only customer-tier users. Different process for admin-to-admin access.
