# Universal AuthN/AuthZ API: First-Principles Abstraction

## Research Scope

Cross-analysis of REST APIs from: **Keycloak**, **Auth0**, **Okta**, **ZITADEL**, **Ory Kratos**, **Better Auth**

Goal: Extract the implementation-agnostic, 10-year-forward universal API surface that a Trafficure-style platform runtime should expose — such that swapping the underlying IdP is a configuration change, not a code change.

---

## 1. The Three-Layer Mental Model

Every provider, when you strip away the branding, implements the same three API layers. The key insight is which layers are **protocol-standard** (never build yourself), which are **convergent** (everyone does the same thing differently), and which are **proprietary** (avoid depending on).

### Layer 1: Protocol Endpoints (Standard — Don't Implement, Delegate)

These are defined by IETF/OIDF RFCs and are identical across every provider. Your runtime should **proxy/delegate** to these, never re-implement:

| Endpoint                            | Standard          | Purpose                          |
| ----------------------------------- | ----------------- | -------------------------------- |
| `/.well-known/openid-configuration` | OIDC Discovery    | Self-describing configuration    |
| `/authorize`                        | OAuth 2.0 / OIDC  | Interactive authentication       |
| `/token`                            | OAuth 2.0         | Token issuance (all grant types) |
| `/userinfo`                         | OIDC              | User profile claims              |
| `/introspect`                       | RFC 7662          | Token validation                 |
| `/revoke`                           | RFC 7009          | Token revocation                 |
| `/end-session` (or `/logout`)       | OIDC Session Mgmt | Logout/session termination       |
| `/jwks` (or `/certs`)               | RFC 7517          | Public key distribution          |
| `/device/code`                      | RFC 8628          | Device authorization flow        |

**Every single provider** implements these identically. Keycloak at `/realms/{realm}/protocol/openid-connect/*`, Auth0 at `/{domain}/*`, Okta at `/oauth2/{server}/*`, ZITADEL at `/oauth/v2/*`, Ory Hydra at `/oauth2/*`, Better Auth via its OIDC Provider plugin.

**10-Year Forward Take:** These won't change. OAuth 2.1 is a simplification, not a new set of endpoints. The only additions will be:

- **GNAP** (Grant Negotiation and Authorization Protocol) — may eventually supplement or replace OAuth for machine-to-machine, but the token/introspect pattern persists
- **Shared Signals Framework (SSF/CAEP)** — continuous access evaluation; new endpoints for risk signal exchange
- **DPoP** (Demonstrating Proof-of-Possession) — already emerging in Okta/Auth0; changes token binding, not endpoints

### Layer 2: Identity Management API (Convergent — Abstract This)

This is where your **universal abstraction lives**. Every provider does the same things with different REST shapes. Here's the canonical surface:

#### 2a. Identity (User/Principal) CRUD

| Operation   | Keycloak                       | Auth0                       | Okta                           | ZITADEL                           | Ory Kratos                      | Better Auth              |
| ----------- | ------------------------------ | --------------------------- | ------------------------------ | --------------------------------- | ------------------------------- | ------------------------ |
| Create      | `POST /admin/realms/{r}/users` | `POST /api/v2/users`        | `POST /api/v1/users`           | `POST /management/v1/users/human` | `POST /admin/identities`        | `auth.api.signUpEmail()` |
| Get         | `GET .../users/{id}`           | `GET /api/v2/users/{id}`    | `GET /api/v1/users/{id}`       | `GET /management/v1/users/{id}`   | `GET /admin/identities/{id}`    | `auth.api.getSession()`  |
| Update      | `PUT .../users/{id}`           | `PATCH /api/v2/users/{id}`  | `PUT /api/v1/users/{id}`       | `PUT /management/v1/users/{id}`   | `PUT /admin/identities/{id}`    | `auth.api.updateUser()`  |
| Delete      | `DELETE .../users/{id}`        | `DELETE /api/v2/users/{id}` | `DELETE /api/v1/users/{id}`    | `DELETE .../users/{id}`           | `DELETE /admin/identities/{id}` | N/A (via adapter)        |
| List/Search | `GET .../users?search=...`     | `GET /api/v2/users`         | `GET /api/v1/users?search=...` | `POST .../users/_search`          | `GET /admin/identities`         | N/A (via adapter)        |

**Universal Principal Object** (union of all providers):

```
Principal {
  id: string                    // Globally unique, immutable
  type: "human" | "service" | "device" | "agent"  // Future-proof

  // Identity claims (schema-driven, extensible)
  traits: {
    email?: string
    phone?: string
    username?: string
    name?: { given: string, family: string }
    [custom: string]: any       // Ory calls this "traits", Keycloak "attributes", Auth0 "user_metadata"
  }

  // Platform metadata (not user-editable)
  metadata: {
    admin: Record<string, any>  // Auth0 "app_metadata", Ory "metadata_admin"
    public: Record<string, any> // Visible to user, Ory "metadata_public"
  }

  // Lifecycle
  state: "active" | "inactive" | "locked" | "pending_verification"
  created_at: ISO8601
  updated_at: ISO8601

  // Linked credentials (opaque list)
  credentials: CredentialRef[]

  // Organization memberships (denormalized for query)
  memberships: OrgMembership[]
}
```

**Key Insight:** Ory Kratos is the most first-principles here — it uses a JSON Schema for `traits`, making the identity model entirely configurable. Auth0 splits metadata into `user_metadata` (user-editable) and `app_metadata` (admin-only). ZITADEL and Keycloak use fixed-ish schemas with extension attributes. Your abstraction should follow Ory's pattern: **schema-driven traits with admin/public metadata split**.

#### 2b. Self-Service Flows (Authentication Ceremonies)

This is the most architecturally divergent area, and the one most worth abstracting.

**The Universal Pattern:**

Every provider models authentication as a **stateful flow** (not a single request). The shapes differ dramatically but the semantic is identical:

```
Flow Lifecycle:
  1. INIT   → Create a flow (registration, login, recovery, verification, settings)
  2. RENDER → Get the flow state + UI hints (what fields/methods to show)
  3. SUBMIT → Submit a step (password, OTP, social redirect, passkey challenge)
  4. REPEAT → If multi-step (MFA), loop back to RENDER
  5. COMPLETE → Flow resolves to a session/token
```

| Concept          | Keycloak                     | Auth0                                | Okta                            | ZITADEL                         | Ory Kratos                              | Better Auth               |
| ---------------- | ---------------------------- | ------------------------------------ | ------------------------------- | ------------------------------- | --------------------------------------- | ------------------------- |
| Login flow       | Authentication Flow          | Universal Login                      | Authn API (state machine)       | Session Service (create/update) | `POST /self-service/login/flows`        | `POST /sign-in/email`     |
| Registration     | Required Actions             | POST /dbconnections/signup           | POST /api/v1/users + activate   | User Service (AddHumanUser)     | `POST /self-service/registration/flows` | `POST /sign-up/email`     |
| Recovery         | Reset Credential Flow        | POST /dbconnections/change_password  | POST /api/authn/recovery        | Password Reset                  | `POST /self-service/recovery/flows`     | `POST /forget-password`   |
| Verification     | Verify Email Action          | POST /api/v2/jobs/verification-email | Factor enrollment               | Email Verification              | `POST /self-service/verification/flows` | `POST /verify-email`      |
| Settings/Profile | Account Management           | PATCH /api/v2/users/{id}             | PUT /api/v1/users/{id}          | UpdateHumanUser                 | `POST /self-service/settings/flows`     | `POST /update-user`       |
| MFA enrollment   | Required Action + Factor API | POST /api/v2/guardian/enrollments    | POST /api/v1/users/{id}/factors | MFA Setup APIs                  | Second factor in login flow             | `POST /two-factor/enable` |

**The Ory Kratos flow model is the most universal abstraction.** It separates:

- **Flow type** (login, registration, recovery, verification, settings)
- **Flow state** (UI nodes describing what to render)
- **Method** (password, oidc, totp, webauthn, code, passkey)

Your universal API should model flows the same way:

```
// Universal Flow API
POST   /flows/{type}           → Initialize flow (returns flow_id + UI state)
GET    /flows/{flow_id}        → Get current state (what to render)
POST   /flows/{flow_id}        → Submit a step (method + payload)
DELETE /flows/{flow_id}        → Abort flow

// Where type ∈ {login, registration, recovery, verification, settings, link}
// And the response always contains:
{
  id: string,
  type: FlowType,
  state: "choose_method" | "sent_email" | "passed_challenge" | "show_form" | "success",
  methods: AvailableMethod[],   // What the UI can render
  ui: {                          // Framework-agnostic UI hints
    action: string,              // Form action URL
    method: "POST",
    nodes: UINode[]              // Input fields, buttons, messages
  },
  session?: Session              // Present on completion
}
```

#### 2c. Session Management

Universal across all providers:

```
// Universal Session API
GET    /sessions/whoami          → Get current session (from cookie/token)
GET    /sessions                 → List user's active sessions
DELETE /sessions/{id}            → Revoke specific session
DELETE /sessions                 → Revoke all sessions
POST   /sessions/{id}/extend     → Refresh/extend session

Session {
  id: string
  principal_id: string
  authenticator_assurance_level: "aal1" | "aal2" | "aal3"
  authentication_methods: AuthMethod[]   // What was used to authenticate
  active: boolean
  expires_at: ISO8601
  authenticated_at: ISO8601
  issued_at: ISO8601
  device: {
    ip: string
    user_agent: string
    geo?: GeoInfo
  }
}
```

**Key Insight:** Ory Kratos models Authenticator Assurance Level (AAL) as a first-class concept on the session, which the others handle implicitly. ZITADEL's new Session Service allows creating/updating sessions incrementally (add checks one at a time). Okta's session model is cookie-based with a separate API. **AAL as a session property is the correct 10-year abstraction** — it maps to NIST 800-63 levels and is what you'll need when regulators ask.

#### 2d. Organization/Tenant Management

| Operation          | Keycloak           | Auth0                      | Okta                    | ZITADEL                | Better Auth                   |
| ------------------ | ------------------ | -------------------------- | ----------------------- | ---------------------- | ----------------------------- |
| Tenant model       | Realm              | Organization               | Org (separate instance) | Organization           | Organization (plugin)         |
| Create org         | Create Realm       | POST /api/v2/organizations | OIN / multi-org         | POST .../orgs          | `organization.create()`       |
| Invite member      | N/A (direct add)   | POST /api/v2/invitations   | Group membership        | Org grants             | `organization.inviteMember()` |
| Roles in org       | Realm roles        | Organization roles         | Group-based             | Org grants + roles     | owner/admin/member + custom   |
| Active org context | N/A (realm in URL) | org_id parameter           | Via login hint          | x-zitadel-orgid header | `organization.setActive()`    |

**Universal Organization API:**

```
// Organization CRUD
POST   /organizations                    → Create
GET    /organizations/{id}               → Get
PATCH  /organizations/{id}               → Update
DELETE /organizations/{id}               → Delete
GET    /organizations                    → List (for principal)

// Membership
POST   /organizations/{id}/members       → Add/invite member
GET    /organizations/{id}/members       → List members
PATCH  /organizations/{id}/members/{mid} → Update role
DELETE /organizations/{id}/members/{mid} → Remove member

// Invitations
POST   /organizations/{id}/invitations   → Create invitation
GET    /organizations/{id}/invitations   → List pending
POST   /invitations/{token}/accept       → Accept invitation
DELETE /organizations/{id}/invitations/{iid} → Revoke

Organization {
  id: string
  slug: string
  name: string
  metadata: Record<string, any>
  created_at: ISO8601
}

Membership {
  id: string
  principal_id: string
  organization_id: string
  roles: string[]              // ["owner", "admin", "billing", ...]
  teams?: string[]             // Sub-grouping within org
  joined_at: ISO8601
}
```

### Layer 3: Provider-Specific Admin APIs (Proprietary — Never Depend On)

These are the APIs for managing the IdP itself: configuring login flows, branding, email templates, webhooks, connection settings, etc. Examples:

- Keycloak: Authentication flow configuration, realm settings, identity broker setup
- Auth0: Rules/Actions management, Universal Login customization, log streams
- Okta: Inline hooks, policy configuration, app integration settings
- ZITADEL: Admin API (instance config), System API (multi-instance)
- Ory Kratos: Configuration YAML (not an API at all!)

**The 10-year principle: Never let your application code touch these.** These are infrastructure-as-code concerns. Manage them via Terraform/Pulumi, not via your runtime.

---

## 2. The Universal Provisioning Layer: SCIM

Separate from the authn/authz API, every enterprise deployment needs SCIM 2.0 endpoints for lifecycle management from upstream HR/directory systems:

```
// SCIM 2.0 Standard Endpoints (RFC 7644)
GET    /scim/v2/ServiceProviderConfig    → Discovery
GET    /scim/v2/ResourceTypes            → Resource type discovery
GET    /scim/v2/Schemas                  → Schema discovery

POST   /scim/v2/Users                    → Provision user
GET    /scim/v2/Users/{id}               → Get user
PUT    /scim/v2/Users/{id}               → Replace user
PATCH  /scim/v2/Users/{id}               → Partial update
DELETE /scim/v2/Users/{id}               → Deprovision

POST   /scim/v2/Groups                   → Create group
GET    /scim/v2/Groups/{id}              → Get group
PATCH  /scim/v2/Groups/{id}              → Update membership
DELETE /scim/v2/Groups/{id}              → Delete group

GET    /scim/v2/Users?filter=...         → Search (RFC 7644 §3.4.2)
POST   /scim/v2/Bulk                     → Batch operations
```

**Provider Support:** Okta has native SCIM. Auth0 has SCIM as an add-on. ZITADEL added SCIM support recently. Better Auth has a SCIM plugin. Keycloak has community extensions. Ory Kratos does not natively support SCIM.

**The Insight:** Your platform should implement SCIM as a **consumer** (exposing `/scim/v2/*` endpoints that upstream IdPs push to), translating SCIM events into your internal principal CRUD. This makes Trafficure "enterprise-connectable" regardless of which IdP your customers use.

---

## 3. The Authorization Decision API (Orthogonal to AuthN)

None of these providers do fine-grained authorization well at the API level. This is why you chose SpiceDB separately. But the **decision point API** is universal:

```
// Universal AuthZ Check (what SpiceDB/OPA/Cedar all converge on)
POST /authz/check
{
  subject:    { type: "user", id: "..." }   // or "service", "team", etc.
  action:     "edit"                         // or "read", "delete", "admin"
  resource:   { type: "project", id: "..." }
  context?:   { ip: "...", time: "...", ... } // For ABAC
}
→ { allowed: boolean, debug?: ... }

// Batch check
POST /authz/check/batch
{
  checks: Check[]
}
→ { results: { allowed: boolean }[] }

// List accessible resources
POST /authz/list
{
  subject: { type: "user", id: "..." }
  action: "read"
  resource_type: "project"
}
→ { resource_ids: string[] }

// List who has access
POST /authz/subjects
{
  resource: { type: "project", id: "..." }
  action: "edit"
}
→ { subjects: Subject[] }
```

This API shape is what Google Zanzibar, SpiceDB, OpenFGA, Ory Keto, and AWS Cedar all converge on. **This is the correct 10-year abstraction for authorization.**

---

## 4. Architectural Synthesis: The Trafficure IAM Runtime API

Bringing it all together, your **Platform IAM Runtime** should expose exactly these API groups:

```
┌─────────────────────────────────────────────────┐
│             TRAFFICURE IAM RUNTIME API           │
├─────────────────────────────────────────────────┤
│                                                  │
│  PROTOCOL (delegate to Ory Hydra)                │
│  /.well-known/openid-configuration               │
│  /oauth2/authorize                               │
│  /oauth2/token                                   │
│  /oauth2/introspect                              │
│  /oauth2/revoke                                  │
│  /oauth2/userinfo                                │
│  /.well-known/jwks.json                          │
│                                                  │
│  IDENTITY (your runtime, backed by Ory Kratos)   │
│  /v1/principals                     CRUD         │
│  /v1/principals/{id}/credentials    Manage creds │
│  /v1/principals/search              Query        │
│                                                  │
│  FLOWS (your runtime, backed by Ory Kratos)      │
│  /v1/flows/{type}                   Init flow    │
│  /v1/flows/{id}                     Get/Submit   │
│                                                  │
│  SESSIONS (your runtime)                         │
│  /v1/sessions/whoami                             │
│  /v1/sessions                       List/Revoke  │
│                                                  │
│  ORGANIZATIONS (your runtime + SpiceDB)          │
│  /v1/organizations                  CRUD         │
│  /v1/organizations/{id}/members     Membership   │
│  /v1/organizations/{id}/invitations Invites      │
│                                                  │
│  AUTHORIZATION (your runtime + SpiceDB)          │
│  /v1/authz/check                    Point check  │
│  /v1/authz/check/batch              Batch check  │
│  /v1/authz/list                     List objects  │
│  /v1/authz/subjects                 List subjects │
│                                                  │
│  PROVISIONING (your runtime, consumed by         │
│                upstream customer IdPs)            │
│  /scim/v2/Users                                  │
│  /scim/v2/Groups                                 │
│  /scim/v2/ServiceProviderConfig                  │
│                                                  │
│  ADMIN (infrastructure, not application code)    │
│  Terraform/Pulumi → Ory config, SpiceDB schema   │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 5. First Principles That Survive 10 Years

### Principle 1: "Principals, Not Users"

Every provider is converging on this. Ory Kratos calls them "identities" with a configurable schema. ZITADEL distinguishes "human" vs "machine" users. Auth0 has "users" plus "client credentials." Your abstraction must model ALL principal types uniformly: humans, service accounts, API keys, AI agents, devices. The `type` field on the principal is the switch.

### Principle 2: "Flows, Not Endpoints"

Authentication is a **state machine**, not a request-response. Ory Kratos and ZITADEL's new Session Service both model this correctly. Okta's Authn API has always been a state machine (returning `status: "MFA_REQUIRED"` etc.). Even Better Auth's simple `signInEmail` internally manages flow state. Your API should expose flows as first-class resources.

### Principle 3: "Tokens Are the Only Interface Contract"

Your services should NEVER call the IdP directly. They receive a token (JWT or opaque), validate it (via JWKS or introspection), and extract claims. The token **is** the interface. Everything above (flows, principals, sessions) is management plane. This is the single most important architectural decision for swappability.

### Principle 4: "AuthZ Is Not AuthN"

All six providers conflate these to varying degrees. Keycloak bundles authorization services. Okta pushes everything into scopes/claims. Auth0 uses Rules/Actions. The clean separation is: **AuthN gives you a principal identity. AuthZ decides what that principal can do.** Keep them on separate API paths, separate data stores, separate scaling profiles.

### Principle 5: "Schema-Driven Identity"

Ory Kratos uses JSON Schema for identity traits. Better Auth uses a plugin system to extend the user model. ZITADEL uses metadata key-value pairs. The pattern that survives is: **a core identity schema that is extensible per-tenant**. For Trafficure's multi-tenant vendor model, each vendor-org should be able to define custom principal attributes without platform code changes.

### Principle 6: "SCIM Is the Enterprise Handshake"

If you want to sell to enterprises, they will ask: "Do you support SCIM?" before they ask about your features. Implementing SCIM as a consumer (accepting pushes from their Okta/Entra/OneLogin) is the gateway to enterprise deals. It's also how you avoid ever building an "import users" CSV tool.

### Principle 7: "AAL as a Session Property"

Authenticator Assurance Level (NIST SP 800-63) is becoming a regulatory requirement. Ory Kratos already models this. Your sessions should carry `aal1/aal2/aal3` and your authz checks should be able to gate on it: "this action requires aal2." This is how step-up authentication works at the protocol level.

---

## 6. What Changes in 10 Years (Bets)

| Trend                                       | Impact on Your Abstraction                                                |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| **Passkeys become default**                 | Just another `method` in your flow model. No API change needed.           |
| **Verifiable Credentials (W3C)**            | New credential type on principals. Your schema-driven model handles this. |
| **GNAP replaces OAuth for M2M**             | Protocol layer change. Your identity/authz APIs are unaffected.           |
| **Continuous Access Evaluation (CAEP/SSF)** | New endpoint: `POST /v1/signals/evaluate`. Feeds into authz decisions.    |
| **AI agents as principals**                 | Already handled: `type: "agent"` in your principal model.                 |
| **Decentralized identity (DID)**            | New identifier scheme. Your principal `id` is already opaque.             |
| **Zero-standing-privilege**                 | Your authz model already supports just-in-time grants via SpiceDB.        |
| **FedCM (browser-native federated login)**  | Protocol layer change. Flow model still works.                            |
| **SCIM 3.0 / SCIM Events**                  | Extension to your `/scim` endpoints. No architectural change.             |

---

## 7. Summary: The Universal API Surface

**You need exactly 7 API groups:**

1. **Protocol** (OIDC/OAuth2) — delegate entirely to Ory Hydra
2. **Principals** — CRUD on identity objects (schema-driven)
3. **Flows** — stateful authn ceremonies (login, registration, recovery, verification, settings)
4. **Sessions** — create, validate, list, revoke (with AAL)
5. **Organizations** — multi-tenancy, membership, roles
6. **AuthZ** — check, batch-check, list-objects, list-subjects (via SpiceDB)
7. **SCIM** — enterprise provisioning inbound

Everything else is **infrastructure config** (Terraform) or **client SDK convenience** (generated from OpenAPI spec of the above).

The implementation (Ory Kratos, SpiceDB, Ory Hydra) sits behind these interfaces. In 10 years, if you need to swap Kratos for something else, you rewrite the adapter — not the API contract, not the application code.
