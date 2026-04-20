# TraffiCure Multi-Tenancy — Implementation Index

**Version:** 1.0
**Date:** 2026-04-15
**Owner:** Umang Saraf (PM) → Engineering
**Source PRD:** [Architecture_PRD.md](./Architecture_PRD.md)
**How to read this folder:** [00_README.md](./00_README.md) — start here if you've never seen this folder before

---

## How to read this folder

The master PRD (`Architecture_PRD.md`) is the **north star** — it describes the target architecture, decisions, and rationale. It is NOT an implementation guide.

The numbered step PRDs in this folder are **sequenced implementation tickets**. Each one is self-contained. An engineer (or pair) can pick up step N, execute it, ship it, and move to N+1. Steps that are independent and can run in parallel are marked.

Every step PRD follows the same template:

1. **Goal** — measurable outcome
2. **Depends on / Blocks** — dependency graph
3. **Scope** — what's in, what's out
4. **Deliverables** — concrete artifacts
5. **Design** — data model, API, behavior, UI if any
6. **Enforcement / Runtime** — how the system uses it
7. **Configuration surface** — where in Lepton Admin it gets edited
8. **Migration plan** — dev → staging → prod, backfill, rollback
9. **Acceptance criteria** — testable requirements
10. **Test plan** — unit, integration, manual
11. **Edge cases & errors** — named scenarios
12. **Observability** — metrics, logs, traces
13. **Audit events** — `platform.audit_log` entries emitted
14. **Open questions** — things that need PM answer before build

## Do not start coding before reading

1. Master PRD, Sections 1–6 (Context through DB Isolation) — the "why"
2. Step 01 (DB foundations) — the "where things live"
3. Step 03 (Configuration Registry) — the "master list of every knob"
4. Step 15' (Auth: Impersonation & Internal MFA) — internal auth required for Lepton Admin

After that, steps 04–22 can be read on demand as you pick them up.

---

## Dependency graph

```
                                    ┌──────────────┐
                                    │ 01 DB Found. │
                                    └──────┬───────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        ▼                  ▼                  ▼
                 ┌────────────┐     ┌────────────┐     ┌────────────┐
                 │02 Extend   │     │03 Config   │     │04 Entitlmt │
                 │  Existing  │     │  Registry  │     │   Engine   │
                 └─────┬──────┘     └─────┬──────┘     └─────┬──────┘
                       │                  │                  │
                       └────────┬─────────┴──────────────────┘
                                ▼
                        ┌────────────────┐
                        │ 05 RBAC + Scope│
                        └────────┬───────┘
                                 ▼
                     ┌─────────────────────────┐
                     │ 06 Permissions Matrix   │
                     └──────────┬──────────────┘
                                ▼
                     ┌─────────────────────────┐
                     │ 07 State Machines       │
                     └──────────┬──────────────┘
                                ▼
        ┌───────────────────────┼──────────────────────────┐
        ▼                       ▼                          ▼
┌──────────────┐       ┌─────────────────┐        ┌───────────────┐
│ 08 DB        │       │ 09 Data Source  │        │ 10 Alert      │
│  Isolation   │       │    & Ingestion  │        │   Engine      │
└──────┬───────┘       └────────┬────────┘        └───────┬───────┘
       │                        │                         │
       └────────────┬───────────┴─────────────────────────┘
                    ▼
          ┌────────────────────┐
          │ 11 Notifications   │
          └─────────┬──────────┘
                    ▼
          ┌────────────────────┐
          │ 13 Feature Flags   │
          └─────────┬──────────┘
                    ▼
          ┌────────────────────┐
          │ 15' Auth Imperson. │
          └─────────┬──────────┘
                    ▼
          ┌────────────────────┐
          │ 16 API Surface     │
          └─────────┬──────────┘
                    ▼
        ┌───────────┴────────────┐
        ▼                        ▼
┌──────────────────┐   ┌────────────────────┐
│ 17 Admin Shell   │   │ 22 Product Wiring  │
└─────────┬────────┘   └──────────┬─────────┘
          ▼                       │
┌─────────────────┐                │
│ 18–21 Admin UIs │                │
└─────────┬───────┘                │
          └──────────┬─────────────┘
                     ▼
          [End of MVP Scope]
```

---

## Step index

### Foundations (Phase 1A)

| #   | Title                                                                              | Owner      | Days | Depends | Parallel-safe |
| --- | ---------------------------------------------------------------------------------- | ---------- | ---- | ------- | ------------- |
| 01  | [Platform Schema & Tenant/Customer Tables](./01_Platform_Schema_Foundations.md)    | Backend    | 3    | —       | —             |
| 02  | [Extend enterprise.organization & enterprise.user](./02_Extend_Existing_Tables.md) | Backend    | 2    | 01      | w/ 03         |
| 03  | [Configuration Registry](./03_Configuration_Registry.md)                           | Backend+PM | 3    | 01      | w/ 02, 04     |
| 04  | [Entitlement Engine](./04_Entitlement_Engine.md)                                   | Backend    | 5    | 01, 03  | w/ 02, 05     |

### RBAC & Access (Phase 1B)

| #   | Title                                                             | Owner      | Days | Depends | Parallel-safe |
| --- | ----------------------------------------------------------------- | ---------- | ---- | ------- | ------------- |
| 05  | [RBAC with Scope](./05_RBAC_With_Scope.md)                        | Backend    | 5    | 02, 04  | —             |
| 06  | [Permissions Matrix & Role Templates](./06_Permissions_Matrix.md) | Backend+PM | 2    | 05      | w/ 07         |
| 07  | [State Machines (Customer/Org/User/POC)](./07_State_Machines.md)  | Backend    | 2    | 02      | w/ 06         |

### Data & Platform Services (Phase 1C)

| #   | Title                                                                                   | Owner       | Days | Depends    | Parallel-safe |
| --- | --------------------------------------------------------------------------------------- | ----------- | ---- | ---------- | ------------- |
| 08  | [Database Isolation Migration (public → customer_slug)](./08_DB_Isolation_Migration.md) | Backend+Ops | 8    | 01, 05     | —             |
| 09  | [Data Source & Ingestion Framework](./09_Data_Source_Framework.md)                      | Backend     | 5    | 03, 08     | w/ 10         |
| 10  | [Alert Engine & Rule DSL](./10_Alert_Engine.md)                                         | Backend     | 6    | 03, 08     | w/ 09         |
| 11  | [Notification Engine](./11_Notification_Engine.md)                                      | Backend     | 4    | 10         | —             |
| 13  | [Feature Flag System](./13_Feature_Flags.md)                                            | Backend     | 3    | 03         | —             |
| 15' | [Auth: Impersonation & Internal MFA (Minimal)](./15_Auth_Impersonation_Minimal.md)      | Backend+Sec | 4    | 01, 02, 06 | —             |

### APIs & Admin Console (Phase 2)

| #   | Title                                                                                                  | Owner    | Days | Depends                 | Parallel-safe |
| --- | ------------------------------------------------------------------------------------------------------ | -------- | ---- | ----------------------- | ------------- |
| 16  | [API Surface (REST)](./16_API_Surface.md)                                                              | Backend  | 6    | 04, 09, 10, 11, 13, 15' | —             |
| 17  | [Lepton Admin — Shell & Auth](./17_Admin_Shell_Auth.md)                                                | Frontend | 3    | 16, 15'                 | —             |
| 18  | [Lepton Admin — Customer CRUD + Detail](./18_Customer_CRUD_Detail.md)                                  | Frontend | 6    | 17                      | w/ 19–21      |
| 19  | [Lepton Admin — Org & city_config Editor](./19_Org_CityConfig_Editor.md)                               | Frontend | 5    | 17                      | w/ 18, 20, 21 |
| 20  | [Lepton Admin — Alert Rule Builder](./20_Alert_Rule_Builder.md)                                        | Frontend | 5    | 17                      | w/ 18, 19, 21 |
| 21  | [Lepton Admin — Global Dashboard / Entitlements / Audit](./21_Entitlements_Users_Audit_Flags_Demos.md) | Frontend | 9    | 17, 15'                 | w/ 18, 19, 20 |

### Integration & Ops (Phase 3)

| #   | Title                                                                             | Owner            | Days | Depends | Parallel-safe |
| --- | --------------------------------------------------------------------------------- | ---------------- | ---- | ------- | ------------- |
| 22  | [Product Integration & Middleware Wiring](./22_Product_Integration_Middleware.md) | Backend+Frontend | 5    | 16, 21  | —             |

---

## Total effort (MVP scope)

- **Phase 1 (Foundations):** Steps 01–08 (≈ 35 days backend)
- **Phase 2 (Services & Admin Console):** Steps 09–21 (≈ 48 days backend-heavy + frontend)
- **Phase 3 (Integration):** Step 22 (≈ 5 days)
- **Total:** 15 steps, ≈ 88 days effort
- **With parallelism (2 BE + 2 FE):** ≈ 13 weeks elapsed

**Deferred (post-MVP):**

- Step 12: Retention & Data Lifecycle (~3 days) — moved post-DPDPA compliance work
- Step 14: Billing & Metering (~4 days) — moved to manual invoicing phase
- Step 23: Error Catalogue & Runbook (~3 days) — moved post-traction
- Step 24: Observability Contract (~3 days) — moved post-traction
- Step 21c/d/f/g: Config UI, Users UI, Flags UI substeps — SQL access sufficient for ops

## Deferred / Out of scope

The following work has been cut from the MVP to accelerate shipping (est. 13 weeks → sooner). These will be addressed in post-MVP phases:

| Step      | Title                                | Reason                                                                                                                                    | Est. Effort           |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 12        | Retention & Data Lifecycle           | DPDPA compliance work moves to Phase 2 after customer contracts clarified.                                                                | 3 days                |
| 14        | Billing & Metering                   | Manual invoicing sufficient for GA launch; automated metering added in Phase 2 post-enterprise deals.                                     | 4 days                |
| 15 (full) | Auth Hardening (SSO, WebAuthn, etc.) | Replaced with minimal 15': TOTP + impersonation only. SSO, passkeys, and advanced MFA policies deferred to Phase 2 post-enterprise-deals. | 4 days → 4 days (15') |
| 23        | Error Catalogue & Runbook            | Runbooks built after live traction shows actual common issues; error catalog maintained in code.                                          | 3 days                |
| 24        | Observability Contract               | Full observability instrumentation post-traction; minimal logging sufficient for MVP.                                                     | 3 days                |
| 21c       | Internal Users UI                    | Lepton staff management via SQL for MVP; UI added in Phase 2.                                                                             | 2 days                |
| 21d       | Config Registry Editor               | SQL access sufficient for ops; UI added in Phase 2 when feature flags UI also ready.                                                      | 4 days                |
| 21f       | Feature Flags UI (partial)           | Flags explorer in 21e; full rule editor deferred to Phase 2.                                                                              | 2 days                |
| 21g       | Partner Demos UI (partial)           | Basic demos list in 21e; full demo manager deferred to Phase 2.                                                                           | 1 day                 |

**Total deferred effort:** ≈ 30 days. **New estimated runway:** 13 weeks with 2 BE + 2 FE devs.

---

## Mockups (reference only)

Mockups are illustrative — engineers should treat them as direction, not as pixel-perfect specs. Only the three most important flows are mocked up:

- [mockups/Global_Dashboard.html](./mockups/Global_Dashboard.html)
- [mockups/Create_Customer_Flow.html](./mockups/Create_Customer_Flow.html)
- [mockups/Customer_Detail.html](./mockups/Customer_Detail.html)
- [mockups/Alert_Rule_Builder.html](./mockups/Alert_Rule_Builder.html)
- [mockups/City_Config_Editor.html](./mockups/City_Config_Editor.html)

## Ground rules for engineers

1. **Do not hardcode.** Every value that depends on a customer, org, user, or environment must come from the Configuration Registry (Step 03). If you can't find a config key for something, file a PM ticket to add one _before_ coding.
2. **Every mutation emits an audit event.** No exceptions. Field name, old value, new value, actor, scope. See Step 07.
3. **Every limit is enforced in the entitlement middleware.** Not in business logic, not in UI. See Step 04.
4. **Every error is typed.** Use the error catalog (Step 23) — return structured codes, not free-text.
5. **Every endpoint has an idempotency key** for POSTs that create resources.
6. **Nothing reads across customer schemas.** See Step 08.
7. **If you're about to write a `WHERE organization_id = ...`, use the scope middleware** (Step 05), not a literal.

## Escalation

Open questions in each step PRD go to Umang. Slack them; don't guess.
