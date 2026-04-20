# Step 20 — Lepton Admin: Alert Rule Builder

**Phase:** 3A
**Depends on:** 16, 17
**Blocks:** 22
**Owner:** Frontend
**Estimated effort:** 5 days

---

## 1. Goal

A visual, no-JSON builder that lets Super Admins and Customer Admins compose valid `AlertRule` definitions (Step 10 DSL) through form controls, with live preview against the last 24h of observations.

## 2. Why now

Step 10 defines the DSL. Editing raw JSON is a support-ticket factory. This builder is the primary way rules get created post-launch.

## 3. Scope

### In scope

- Rule create/edit screen at `/orgs/:id/alert-rules/new` and `/alert-rules/:id`.
- Template picker (6 seeds from Step 10).
- Target selector: road_type, segments (search), zones.
- Condition builder with AND/OR/NOT nesting.
- Window, dedup, escalation, auto-resolve panels.
- Working-hours override.
- Live preview: run rule against last 24h → list of alerts it _would_ have fired.
- Save as draft, Enable, Disable, Clone.

### Out of scope

- Time-series preview chart (show speed vs. threshold over time) — Phase 2.
- Rule versioning history beyond audit log — Phase 2.

## 4. Deliverables

1. Rule builder page + shared `<ConditionEditor>`, `<TargetPicker>`, `<EscalationEditor>` components.
2. Backend endpoint `POST /admin/alert-rules/:id/preview` — returns synthetic alert list.
3. Rule JSON schema doc auto-generated as a "advanced mode" fallback for power users.

## 5. Design

### 5.1 Page layout

Two-column:

- Left (60%): form sections.
- Right (40%): sticky live preview panel with summary stats, "Would have fired N times on M segments in last 24h".

Sections (accordion, all expanded by default):

1. **Basics** — name, severity (radio: info/low/medium/high/critical), description.
2. **Target** — scope radio:
   - road_type (multi-select chips): motorway, trunk, primary, secondary, tertiary, residential.
   - specific_segments (search + multi-select, shows segment names from `road_segment`).
   - zones (multi-select from org's zones).
3. **Condition** — tree editor:
   - Root operator AND/OR/NOT.
   - [+] add clause: metric dropdown (speed_kmh, jam_factor, duration_minutes, observation_age_minutes, confidence), comparator (<, >, <=, >=, ==, !=), value (literal or `use config: <key>` picker).
   - Nest via [Group] button.
4. **Window** — kind (rolling / calendar), minutes.
5. **Dedup** — key fields (segment_id / zone_id / road_type), window minutes (config-ref by default).
6. **Escalation** — ladder rows: after_minutes + channels checkboxes + roles multiselect. Add/remove rows. Start_after_minutes.
7. **Auto-resolve** — metric/cmp/value + sustain_minutes.
8. **Working hours** — "inherit from org", "custom", "always-on" radio; custom shows tz/days/start/end.

### 5.2 Form → JSON & versioning

Live, on every keystroke, generate the rule JSON and show validation errors inline. Pass JSON to preview endpoint on a 1s debounce.

Alert rule JSON includes a `version` field (default 1) to support future schema evolution. When loading a saved rule:

- If `version > current`, show deprecation warning and block edit; offer migrate button.
- If `version == current`, proceed normally.
- Losslessness guarantee (advanced-mode JSON edit → form → JSON round-trip) only within the same version.

Advanced mode toggle exposes the raw JSON in a Monaco editor with schema validation; edits there sync back to the form where lossless.

### 5.2a Version handling

DSL versioning ensures backward compatibility and graceful degradation on breaking changes:

- **Current version:** 1 (defined in Step 10 DSL spec).
- **Storage:** `version` field in alert rule JSON. If omitted from legacy rules, assume version 1 on load.
- **Migration flow:** When loading a rule with `version > current_version`:
  1. UI shows banner: "This rule was created with a newer version of the DSL; editing may lose information."
  2. Save button disabled.
  3. "Migrate to current version" button offered; on click, schema translator applies best-effort conversion, logs any lossy transformations, flags rule for manual review.
- **Acceptance:** Only rules with `version <= current_version` and passing validation can be enabled.

### 5.3 Preview endpoint

```
POST /admin/alert-rules/preview
body: { orgId, definition }

→ runs evaluator against last 24h (cached obs) with NO side effects (no dedup, no writes)
→ returns { simulatedAlerts: [{segmentId, firstFiredAt, peakSeverity, sampleEvidence}], totals }
```

Cap preview output at 200 alerts. If more, return count + top-N.

### 5.4 Save & enable

- [Save draft] → `enabled=false`.
- [Save & enable] → `enabled=true`; shows toast "Rule will start evaluating within 1 min".
- [Disable] / [Clone] / [Delete] on existing rule.

### 5.5 Template picker (new rule)

Modal shows 6 cards:

- Sustained Congestion
- Slow Corridor (travel time > X)
- Stale Data (no observation for N min)
- Jam Persistence (jam_factor > X for Y min)
- Holiday Spike (compare to baseline, only on holidays)
- Planned Closure Violation (vehicles on a closed segment)

Pick → pre-fills form.

### 5.6 Config-key reference picker

Every numeric input has a "🔗 Use config key" toggle. Opens a searchable list of config keys in scope `org` or `customer` with current resolved value. Picking stores `{ref: '<key>'}` in JSON.

### 5.7 Validation

- JSON Schema validates on every edit; invalid rule → Save disabled.
- Semantic warnings: "Threshold 90 km/h seems high for congestion — did you mean <12?"; "Escalation step 4 has no recipients" etc. Non-blocking.

## 6. Enforcement / Runtime

- Edits require `alerts.configure` permission (scoped to org).
- Rule writes validated server-side with the same JSON Schema.

## 7. Configuration surface

The builder consumes the config keys registry. When user picks "use config key", the UI filters by `allowed_scopes` compatible with the current org.

## 8. Migration plan

1. Ship builder read-only first (view existing rules).
2. Add create/edit behind `flags.alert_rule_builder`.
3. Migrate the 14 legacy alert scripts into rule rows via a one-off importer (mapping documented in Step 10 §8).

## 9. Acceptance criteria

1. Any rule saved via the builder validates against the JSON Schema in CI.
2. Preview returns within 3s p95 for last-24h window.
3. Disabled rule stops firing within 1 evaluation cycle.
4. Advanced-mode JSON edit → form → JSON round-trip is lossless.
5. A user without `alerts.configure` sees the rule in read-only mode; no save button.

## 10. Test plan

- Playwright: build a "sustained congestion" rule from scratch → preview shows expected alerts → save → alert fires on next eval cycle in staging.
- Fuzz invalid conditions; server rejects; form shows field-level errors.
- Template pick → save unchanged → rule equals template seed.

## 11. Edge cases

| Case                                               | Behavior                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Rule targets segments not in org                   | Save rejected 422 with invalid segment list.                                   |
| Config key referenced doesn't resolve for org      | Soft-warn; rule can still save; runtime will mark `errored`.                   |
| User toggles advanced mode with breaking JSON edit | Warn "leaving advanced mode will reset the form to match valid JSON"; confirm. |
| Preview timeout                                    | Show skeleton + "Preview unavailable — rule will still save if valid".         |

## 12. Observability

- `alert_rule_preview_duration_ms`.
- `alert_rule_save_total{result}`.
- `alert_rule_advanced_mode_usage_total`.

## 13. Audit events

- `alert_rule.created / updated / enabled / disabled / deleted / cloned` — diff payload.

## 14. Open questions

- Q1. Do Customer Admins get the same builder or a simpler one? Recommendation: same builder, scoped to their org; super_admin-only keys hidden.
- Q2. Should preview run against a _baseline_ (historical same-day-of-week) too? Recommendation: Phase 2 after baselines land.
