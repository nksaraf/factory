# Lepton Admin — Start Here

This folder contains everything needed to build the TraffiCure multi-tenancy / Lepton Admin system. It is the single source of truth for the Phase 1 MVP.

**If you only read one file, read this one.** It is the map. It tells you what else to read and in what order.

---

## Folder map

```
Lepton Admin/
├── 00_README.md                          ← you are here
├── 00_Implementation_Index.md            ← dependency graph + phase map
├── Architecture_PRD.md                   ← master / north-star architecture doc
├── 01_Platform_Schema_Foundations.md     ┐
├── 02_Extend_Existing_Tables.md          │
├── 03_Configuration_Registry.md          │
├── 04_Entitlement_Engine.md              │
├── 05_RBAC_With_Scope.md                 │
├── 06_Permissions_Matrix.md              │
├── 07_State_Machines.md                  │  20 step PRDs — one per epic in Jira.
├── 08_DB_Isolation_Migration.md          │  Each is self-contained and
├── 09_Data_Source_Framework.md           ├─ implementation-ready.
├── 10_Alert_Engine.md                    │  Numbers 12 and 14 are intentionally
├── 11_Notification_Engine.md             │  skipped (deferred — see _deferred/).
├── 13_Feature_Flag_System.md             │
├── 15_Auth_Impersonation_Minimal.md      │
├── 16_API_Surface.md                     │
├── 17_Admin_Shell_Auth.md                │
├── 18_Customer_CRUD_Detail.md            │
├── 19_Org_CityConfig_Editor.md           │
├── 20_Alert_Rule_Builder.md              │
├── 21_Entitlements_Users_Audit_Flags_Demos.md  │
├── 22_Product_Integration_Middleware.md  ┘
│
├── mockups/                              ← 5 HTML mockups (open in a browser)
│   ├── Global_Dashboard.html
│   ├── Create_Customer_Flow.html
│   ├── Customer_Detail.html
│   ├── City_Config_Editor.html
│   └── Alert_Rule_Builder.html
│
├── _decisions/                           ← audit trail / scope decisions
│   ├── VALIDATION_AUDIT.md               ← PRD-vs-PRD consistency audit
│   ├── BLOCKER_FIXES.md                  ← changelog of fixes applied from the audit
│   └── TRIM_APPLIED.md                   ← what we cut from MVP and why
│
├── _jira/                                ← delivery artifacts
│   ├── JIRA_PREVIEW.md                   ← the drafted ticket set (reference)
│   ├── JIRA_FINAL_REPORT.md              ← summary of what was actually pushed
│   └── stories_to_create.json            ← machine-readable story dump (internal)
│
└── _deferred/                            ← cut-scope PRDs. DO NOT IMPLEMENT.
    ├── 12_Retention_Data_Lifecycle.md
    ├── 14_Billing_Metering.md
    ├── 15_Auth_Hardening.md              ← full SSO/WebAuthn; replaced in MVP by 15_Auth_Impersonation_Minimal.md
    ├── 23_Error_Catalogue_Runbook.md
    └── 24_Observability_Contract.md
```

---

## The one rule

Before anyone writes code: read the **six load-bearing docs** below. Every other doc in the folder references these, and every ticket in Jira is downstream of them. If you understand these, any later feature slots in without rework.

The six:

1. `Architecture_PRD.md` — §1 Context, §3 Entity Model, §6 DB Isolation (the "why" + the hierarchy)
2. `00_Implementation_Index.md` — dependency graph + phase map
3. `01_Platform_Schema_Foundations.md` — where things live (Tenant, Customer)
4. `03_Configuration_Registry.md` — the principle that nothing is hardcoded
5. `04_Entitlement_Engine.md` — the gate that decides who can do what, how much
6. `05_RBAC_With_Scope.md` — the permission model

After those six, every other step PRD is context you can read on demand when you pick up the ticket.

---

## Reading order for Umang (PM / CEO)

You need enough to answer engineering questions, make trade-off calls, and trust that scope is right. You do NOT need the DDL.

**Day 1 (90 min):**

1. `Architecture_PRD.md` — read §1–§7 in full (Context, Current State, Entity Model, Access Control, Configuration, DB Isolation, Admin Console). Skim §8 onwards.
2. `00_Implementation_Index.md` — read the dependency graph and the phase map. This is the skeleton of the plan.
3. `_decisions/TRIM_APPLIED.md` — what we cut and why (Retention, Billing, full Auth Hardening, Error Catalogue, Observability Contract — all deferred). If anyone asks "why isn't billing in this sprint?", this doc answers.
4. `_decisions/VALIDATION_AUDIT.md` + `_decisions/BLOCKER_FIXES.md` — audit results and fixes. Read the summary tables. Skip the line-by-line.

**Day 2 (60 min):**

5. `mockups/Global_Dashboard.html` — open in browser. This is what Lepton ops sees.
6. `mockups/Customer_Detail.html` — what onboarding a new customer feels like.
7. `mockups/City_Config_Editor.html` + `mockups/Alert_Rule_Builder.html` — where customers edit their own settings.
8. `mockups/Create_Customer_Flow.html` — the flow you already approved. Good reference for shape of every other flow.

**Skim-only on demand:**

- `_jira/JIRA_FINAL_REPORT.md` — the current push summary (epic/story counts, split, duplicate notes).
- Individual step PRDs (01–22) — only when a ticket comes up that you need to unblock. They're engineer-facing.
- `_deferred/` folder — only if someone proposes reviving a cut PRD. Default is: don't read these.

**When to push back:**

- Any story estimate > M (Medium): the estimate discipline we set is S/M/L only. L means 5+ days. If you see XL behavior on a ticket, ask for it to be split.
- Any scope creep into Retention / Billing / Observability / full Auth Hardening / Error Catalogue — these are explicitly deferred in `_decisions/TRIM_APPLIED.md`.

---

## Reading order for Engineers (Rishabh and Ritvik)

Two passes: an orientation pass (shared, once) and a per-ticket pass (on demand, every ticket).

### Pass 1 — Orientation (one-time, ~4 hours)

Read these in order. Do not skim. Do not start a ticket until this is done.

1. `Architecture_PRD.md` — full §1–§7. Everything after that is useful but §1–§7 is mandatory.
   - §3 Entity Model — the Tenant → Customer → Organization → User hierarchy. This is the spine.
   - §6 DB Isolation — `platform`, `enterprise`, `customer_<slug>`, `admin` schemas and what lives where.
2. `00_Implementation_Index.md` — full read. Know the dependency graph by heart. Understand what's in your epic vs what depends on it.
3. `01_Platform_Schema_Foundations.md` — the tables every other step references.
4. `03_Configuration_Registry.md` — the design principle that nothing is hardcoded. When you're about to add a constant, stop and ask: should this be a config key?
5. `04_Entitlement_Engine.md` — middleware that gates every protected endpoint. You will wire into this on almost every feature.
6. `05_RBAC_With_Scope.md` — permission model and scope chain (platform → customer → org). Same: you will wire into this everywhere.
7. `15_Auth_Impersonation_Minimal.md` — the trimmed auth scope. TOTP MFA + impersonation. Full SSO / WebAuthn is deferred.
8. `16_API_Surface.md` — URL conventions, error code namespacing, pagination. Read before writing any endpoint.

### Pass 2 — Per-ticket (every ticket, ~30 min)

Before opening your editor on a ticket:

1. Read the **step PRD** for the epic the ticket belongs to (e.g. Step 10 = `10_Alert_Engine.md`).
2. Read the step PRD's **"Depends on"** section and skim those upstream docs if you haven't seen them recently.
3. Read the **Jira ticket's** Description, Technical detail, Files to touch, Acceptance criteria. The PRD reference field at the bottom tells you which PRD section to deep-dive.
4. Open the relevant mockup if your ticket touches UI:
   - `mockups/Customer_Detail.html` — Step 18 work
   - `mockups/City_Config_Editor.html` — Step 19 work
   - `mockups/Alert_Rule_Builder.html` — Step 20 work
   - `mockups/Global_Dashboard.html` — Step 17 / 18 / 21 nav and layout
5. If something contradicts the master PRD, the master PRD wins for intent; the step PRD wins for implementation detail. If anything is ambiguous, flag it before coding — don't guess.

### When an engineer should read ahead

- Before merging a schema change — read Step 08 (DB Isolation Migration) so you know the schema-per-customer rules.
- Before adding a new error code — read Step 16 §Error codes.
- Before emitting a new metric — read Step 16 §Metric naming.
- Before building a UI page — open the nearest mockup and match the layout conventions.

### When an engineer should NOT read

- `_deferred/` folder. If you feel a pull to look there, the answer is no. That scope was cut deliberately.
- `_jira/` folder. That's delivery tracking, not spec. Your tickets are in Jira.

---

## High-level architecture overview (so everything built now compounds)

The system has four architectural layers. Every step PRD sits in one of them. Knowing which layer a ticket lives in tells you what it should NOT do.

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 4 — Admin UI & Customer-Facing Editors                     │
│ Steps 17–22. Pure consumer. Never owns business logic.           │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 3 — Product Services & Domain Engines                      │
│ Steps 09 (Data Source), 10 (Alert), 11 (Notification),           │
│ 13 (Flags), 22 (Product Integration).                            │
│ Owns feature logic. Consumes config, entitlements, RBAC.         │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 2 — Platform Primitives (the "nothing is hardcoded" layer) │
│ Steps 03 (Config Registry), 04 (Entitlements), 05 (RBAC),        │
│ 06 (Permission Matrix), 07 (State Machines), 15 (Auth).          │
│ These are libraries/middleware every Layer 3 service imports.    │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 1 — Data Model Foundations                                 │
│ Steps 01 (Platform Schema), 02 (Extend Tables), 08 (Isolation).  │
│ The tables and schemas. Nothing else can exist without these.    │
└──────────────────────────────────────────────────────────────────┘
```

**The rule:** A higher layer can depend on a lower layer. A lower layer must NEVER depend on a higher layer. If you find yourself doing that, you've mis-placed logic.

**The forcing function:** Every feature in Layer 3 must be configurable via Layer 2 (config registry, entitlements, RBAC), administrable via Layer 4 (Admin UI), and stored via Layer 1 (schemas). If any of those four is missing for a feature, the feature isn't done.

This is why the build order is 01 → 02 → 03 → 04 → 05 → ... It's not arbitrary — it's the layer order. Building UI first would be building on air.

---

## Summary cheat-sheet

| Audience         | Time budget   | Doc                                                           |
| ---------------- | ------------- | ------------------------------------------------------------- |
| Umang, Day 1     | 90 min        | Architecture_PRD §1–§7 + Index + \_decisions/TRIM_APPLIED     |
| Umang, Day 2     | 60 min        | 5 mockups                                                     |
| Engineer, Pass 1 | 4 hours       | Architecture_PRD §1–§7 + Index + Steps 01, 03, 04, 05, 15, 16 |
| Engineer, Pass 2 | 30 min/ticket | Step PRD for the epic + upstream deps + Jira ticket + mockup  |

No one reads `_deferred/`. No one reads every step PRD cover-to-cover — they're reference docs, not a book.
