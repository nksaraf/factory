# trafficure.core

Core module for the TraffiCure platform. Provides real-time traffic alerts, map layers, and alert management.

## What This Module Does

- Fetches and displays real-time traffic alerts (congestion, rapid deterioration)
- Renders traffic/alert/road layers on the map via deck.gl
- Manages alert lifecycle: active → suppressed → resolved
- Provides alert inbox with filtering, sorting, and search
- Handles user feedback on alerts (dismiss, confirm)

## Key Files

### Data Layer (`data/`)
| File | Purpose |
|------|---------|
| `alerts.ts` | `useAlertsQuery()` — fetches active alerts, merges metadata, filters dismissed |
| `historical-alerts.ts` | `useHistoricalAlertsQuery()` — fetches resolved alerts with time range |
| `realtime-alerts.ts` | Real-time alert streaming |
| `road-alerts.ts` | Road-specific alert queries |
| `use-alert-focus.ts` | Map focus effect — zooms/pans to selected alert geometry |
| `use-alert-mutations.ts` | Alert feedback mutations (dismiss, confirm) |
| `use-organization-bounds.ts` | Fetches org-level map bounds |
| `use-traffic-metrics.ts` | Traffic metric aggregations |
| `use-map-snap-resize.ts` | Responsive drawer/map resize handling |

### Types (`types/`)
| File | Purpose |
|------|---------|
| `alert.ts` | `Alert` interface — domain model with all fields documented |
| `alert-api.ts` | `AlertApiItem`, `AlertApiResponse` — raw API response types |
| `alert-query.ts` | Sort keys, filter types, time range types for query context |
| `index.ts` | Barrel export for all types |

### Components (`components/`)
| File | Purpose |
|------|---------|
| `alerts-query-context.tsx` | React Context provider for alert filters, sort, selected alert |
| `alert-narrative.tsx` | AI-generated narrative text for alerts |

### Utilities (`utils/`)
| File | Purpose |
|------|---------|
| `alert-timestamps.ts` | Timestamp normalization — maps API `alert_event_time`/`timestamp` to domain model |
| `alert-duration.ts` | Duration calculation and formatting for active/resolved alerts |
| `alert-narrative.ts` | Narrative text generation utilities |
| `expand-bounds.ts` | Map bounds expansion for focusing on narrow geometries |
| `format-number.ts` | Number formatting (decimals, integers, delays) |
| `format-time.ts` | Time/date formatting (12h, smart dates, time ranges) |

### Map Layers (root level)
| File | Purpose |
|------|---------|
| `traffic-layer.tsx` | deck.gl traffic speed visualization layer |
| `alerts-layer.tsx` | deck.gl alert marker/cluster layer |
| `roads-layer.tsx` | deck.gl road geometry layer |
| `alert-cluster-layer.tsx` | Alert clustering for zoomed-out views |
| `traffic-road-highlight-layer.ts` | Highlight effect for selected roads |
| `traffic-utils.ts` | Traffic color ramp and speed-to-color mapping |

### UI Components (root level)
| File | Purpose |
|------|---------|
| `alert-card.tsx` | Individual alert card in the inbox |
| `alert-card-skeleton.tsx` | Loading skeleton for alert cards |
| `alert-detail-view.tsx` | Full alert detail panel |
| `alert-sidebar-detail.tsx` | Sidebar detail view for selected alert |
| `alert-sidebar-detail-skeleton.tsx` | Loading skeleton for sidebar detail |
| `alert-focus.tsx` | Alert focus indicator on map |
| `alerts-inbox.tsx` | Main alert inbox (desktop) |
| `alerts-inbox-mobile.tsx` | Mobile-optimized alert inbox |
| `alerts-legend.tsx` | Map legend for alert types |
| `alerts-map-view-state.tsx` | Map view state management for alerts page |
| `alerts-project-provider.tsx` | Project-level provider for alerts |
| `map-search-bar.tsx` | Map search input |
| `map-switcher.tsx` | Toggle between map providers |
| `map-tool-button-group.tsx` | Map toolbar buttons |
| `road-health-tooltip.tsx` | Road health tooltip on hover |
| `road-health-tooltip-card.tsx` | Road health detail card |
| `road-tooltip.tsx` | Basic road tooltip |
| `status-bar.tsx` | Status bar showing alert counts |

### Configuration
| File | Purpose |
|------|---------|
| `alert-type-config.ts` | Alert type constants — labels, colors, icons, severity order, tooltips |
| `manifest.json` | Rio.js extension manifest — sidebar items, layer renderers |
| `index.ts` | Module entry — exports extension with feature-flag filtering |
| `extension.ts` | Extension lifecycle hooks |

## Data Flow

```
Platform API (snake_case)
    ↓
useAlertsQuery() — fetch + merge metadata from PostgREST
    ↓
mapApiTimestampsToAlertTimestamps() — normalize timestamps
    ↓
transformApiAlertToAlert() — snake_case → camelCase, compute derived fields
    ↓
matchSorter() — client-side search filtering
    ↓
sort + slice — apply sort key and count limit
    ↓
Alert[] — consumed by UI components via AlertsQueryContext
```

## Timestamp Convention (IMPORTANT)

The API has two timestamp fields with different semantics:
- `alert_event_time` → mapped to `Alert.startedAt` — always the alert start time
- `timestamp` → mapped to `Alert.lastUpdatedAt` — last update; for resolved alerts, this is the resolution time
- `Alert.timestamp` is a **deprecated legacy alias** for `startedAt`

See `utils/alert-timestamps.ts` for the authoritative mapping logic.

## Feature Flags

This module respects these environment variables (set in `app.settings.ts`):
- `PUBLIC_ENABLE_ANALYTICS` — shows/hides Analytics sidebar item
- `PUBLIC_ENABLE_REPORTS` — shows/hides Reports sidebar item
