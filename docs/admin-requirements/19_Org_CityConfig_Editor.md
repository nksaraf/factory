# Step 19 — Lepton Admin: Org & city_config Editor

**Phase:** 3A
**Depends on:** 16, 17
**Blocks:** 22
**Owner:** Frontend
**Estimated effort:** 4 days

---

## 1. Goal

Ship the Organization Detail page where super_admins (and scoped customer_admins) edit every per-org knob: identity, geography, city_config JSONB (dashboards, tiles, thresholds), data source, health, and members.

## 2. Why now

Org is the unit the product actually operates on. city_config today is edited by hand-editing SQL. That has to end.

## 3. Scope

### In scope

- `/orgs/:id` route (linked from Customer Detail > Orgs).
- Tabs: Overview, City Config, Data Source, Alerts, Members, Zones, Audit.
- City config editor — form-driven, not a raw JSON textarea.
- Geo editor on a Leaflet map (center, bbox, zones).
- Data source config + live health panel.

### Out of scope

- Per-org branding assets — customer-level only.
- Zone CRUD advanced tooling — this step ships basic polygon draw + list; advanced routing tools Phase 2.

## 4. Deliverables

1. Org Detail routes and tabs.
2. `<CityConfigEditor>` typed form component (generated from config key registry).
3. `<GeoEditor>` Leaflet-backed bbox + polygon drawing tool.
4. Data source test & rotate UI.

## 5. Design

### 5.1 Overview tab

- Identity: name, slug, type (city/virtual/personal), timezone, country, city, provisioning_state.
- Stats: segments, active alerts, ingestion rows/hour, last observation age.
- Data-source health badge (from Step 09).
- Quick actions: suspend, reactivate, archive.

### 5.2 City Config tab

`enterprise.organization.city_config` JSONB shape (defined in Step 02):

```json
{
  "dashboards": {
    "city_overview": {
      "default_tiles": ["kpi_strip", "map", "top_jams", "mobility_index"]
    },
    "citypulse": { "enabled": true, "refresh_interval_seconds": 60 }
  },
  "thresholds": {
    "mobility_index_green_min": 65,
    "mobility_index_yellow_min": 45
  },
  "units": { "speed": "kmh", "distance": "km" },
  "labels": { "arterial_display_name": "Arterial road" },
  "working_hours": {
    "tz": "Asia/Kolkata",
    "days": ["mon-sat"],
    "start": "07:00",
    "end": "22:00"
  },
  "peak_hours": [
    { "start": "08:00", "end": "11:00" },
    { "start": "17:00", "end": "21:00" }
  ],
  "holidays": ["2026-08-15", "2026-10-02"]
}
```

UI: accordion with sections for each top-level key. Each field rendered with:

- Label (from config key registry description).
- Tooltip ℹ with "Where this shows up in the product".
- Input appropriate to value_type.
- Inherited-value badge if coming from customer or global (can override here).
- "Reset to inherited" button.

Save: PATCH `/admin/orgs/:id/city-config`. Validation via JSON Schema in Config Registry (Step 03). Changes take effect on next product-page load for that org's users (cache TTL 60s).

### 5.3 Data Source tab

- Provider picker (here/tomtom/custom_webhook/custom_sftp).
- Credential picker: dropdown of `data_source_credential` for this customer + [New credential] modal.
- Poll interval, bbox, road types, sampling rate, failover provider + credential, stale threshold.
- [Test connection] button → shows result inline (ok/fail, latency, sample row count).
- Live health panel: state badge, last_poll_at, last_success_at, consecutive_failures, rows_last_hour, sparkline (last 24h).
- [Rotate credential] action.

### 5.4 Geo Editor

**Scope:** Geo editor operates at organization scope (org_id). All edits persist to the org's geo data.

Leaflet map with CartoDB Positron tiles (per brand rules from trafficure-ui-mockup skill).

- Current geo_center as pin (editable by drag).
- Current geo_bounds as rectangle (editable by drag handles).
- Zones: list on left, draw/edit polygon on map. Save to `customer_<slug>.zone` table (shared schema, one row per zone).

**Validation rule:** If the customer has geo_bounds defined and the org has a geo_center, the org's geo_center must be contained within the customer's geo_bounds. Exception: if customer has no bounds (NULL), the org can be anywhere in the tenant region.

### 5.5 Alerts tab

Scoped alert-rule list for this org. [Add rule] opens the Rule Builder (Step 20). Also shows org-level alert config: `alerts.working_hours`, `alerts.escalation_ladder`, `alerts.engine_enabled` toggle.

### 5.6 Members tab

Same layout as Customer > Members but filtered to this org's scope. Invite/role actions scoped to org_id.

### 5.7 Zones tab

Polygon list with area, segments-included, mobility_index today. Click row → opens Geo Editor centered on that zone.

### 5.8 Audit tab

Scoped to `org_id = :id`. Same features as Customer Audit.

## 6. Enforcement / Runtime

- Every config field edit goes through Config Registry write (Step 03), which validates value_type, allowed_values, scope. No direct UPDATE on `city_config`.
- Geo edits validated: bbox sane lat/lon ranges; zones within bbox.
- Data source changes require `orgs.data_source.edit` permission.

## 7. Configuration surface

All keys under `ui.*`, `dashboards.*`, `thresholds.*`, `labels.*`, `peak_hours`, `holidays` are scoped `org`. Config Registry drives rendering.

## 8. Migration plan

1. Backfill `city_config` for 6 live orgs from current hardcoded values (mined from product code).
2. Ship editor; internal smoke on staging Dehradun.
3. Hand off to Customer Admins (Pune first); sunset hand-SQL path.

## 9. Acceptance criteria

1. Changing `thresholds.mobility_index_green_min` in UI updates product dashboard colors on next load for that org.
2. Invalid bbox (lon > 180) rejected inline; no save.
3. Test-connection UI returns result within 15s or times out clearly.
4. Rotating credential does NOT restart the poller; next poll uses new secret.
5. Scoped customer_admin sees Data Source tab read-only when they lack `orgs.data_source.edit`.

## 10. Test plan

- Playwright: edit a threshold, reload product staging, verify color changed.
- Zone draw → save → reload → polygon persists.
- Data source test with expired key → error surfaced typed.

## 11. Edge cases

| Case                                | Behavior                                                             |
| ----------------------------------- | -------------------------------------------------------------------- |
| geo_center outside geo_bounds       | Reject save; inline error.                                           |
| Holiday date in past                | Allowed (historical); warn but save.                                 |
| Config key deprecated               | Show deprecation note; mark read-only if `deprecated=true`.          |
| Two admins edit config concurrently | Last-write-wins with `updated_at` header; on conflict 409 with diff. |

## 12. Observability

- `city_config_updates_total{org,key}`.
- `org_health_state{org,state}` gauge.

## 13. Audit events

- `org.city_config.updated` — diff payload.
- `org.geo.updated`.
- `org.data_source.updated / credential_rotated / test_run`.

## 14. Open questions

- Q1. Should Customer Admins see all knobs or just a curated subset? Recommendation: curated — show only `min_role_to_edit <= customer_admin` keys. Super_admin sees all.
- Q2. Do we lock city_config during active incidents? Recommendation: no hard lock; show a warning banner if there are open `critical` alerts.
