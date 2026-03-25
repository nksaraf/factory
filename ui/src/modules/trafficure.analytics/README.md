# trafficure.analytics

Road analytics module for the TraffiCure platform. Provides detailed per-road traffic analysis, speed metrics, heatmaps, trend data, and a road comparison tool.

## What This Module Does

- Displays a searchable list of monitored roads with health indicators
- Shows per-road detail panels with speed metrics, heatmaps, trend charts, and alert history
- Provides a "Compare Tool" to compare two roads side-by-side
- Includes an AI-powered road chat for natural language traffic queries

## Key Files

### Data Layer (`data/`)
| File | Purpose |
|------|---------|
| `roads.ts` | Road list data utilities |
| `use-roads-query.ts` | `useRoadsQuery()` — fetches all monitored roads |
| `use-road-data-query.ts` | `useRoadDataQuery()` — full road data for detail panel |
| `use-road-header-data-query.ts` | Road header metadata (name, area, metrics) |
| `use-road-speed-metrics-query.ts` | Speed statistics (current, typical, peak) |
| `use-road-heatmap-query.ts` | Speed heatmap data (time-of-day × day-of-week) |
| `use-road-trend-query.ts` | Historical speed trend data |
| `use-road-alert-statistics-query.ts` | Alert counts and patterns for a road |
| `use-road-geometry.ts` | Road geometry for map rendering |
| `use-road-focus.ts` | Map focus effect for selected road |
| `test.ts` | Data layer testing utilities |

### Components (`components/`)
| File | Purpose |
|------|---------|
| `roads-inbox.tsx` | Main road list (searchable, scrollable) |
| `roads-inbox-header.tsx` | Header with search and filters |
| `roads-inbox-filters.tsx` | Filter controls |
| `roads-query-context.tsx` | React Context for road list state (search, sort, selected) |
| `road-card.tsx` | Individual road card in the list |
| `road-detail-panel.tsx` | Full detail panel for selected road |
| `road-detail-header.tsx` | Detail panel header |
| `road-speed-card.tsx` | Speed metrics visualization |
| `road-heatmap-card.tsx` | Time-of-day speed heatmap |
| `road-trend-card.tsx` | Historical trend chart |
| `road-alerts-card.tsx` | Alert history for a road |
| `road-chat-card.tsx` | AI chat interface for road queries |
| `analytics-panel.tsx` | Main analytics layout panel |
| `analytics-project-provider.tsx` | Project-level provider |
| `compare-tool/` | Road comparison modal (see below) |

### Compare Tool (`components/compare-tool/`)
| File | Purpose |
|------|---------|
| `compare-tool-button.tsx` | Button to open compare modal |
| `compare-tool-modal.tsx` | Main comparison modal |
| `components/road-selection-step.tsx` | Step 1: select two roads |
| `components/date-selection-step.tsx` | Step 2: select date range |
| `components/results-step.tsx` | Step 3: comparison results |
| `components/comparison-heatmaps.tsx` | Side-by-side heatmaps |
| `components/verdict-scorecard.tsx` | AI-generated comparison verdict |
| `components/insights-summary.tsx` | Key insights summary |
| `hooks/use-compare-data.ts` | Data fetching for comparison |
| `hooks/use-compare-calculations.ts` | Metric calculations |

### Utilities (`utils/`)
| File | Purpose |
|------|---------|
| `date-utils.ts` | Date formatting and range utilities |
| `heatmap-utils.ts` | Heatmap data transformation |
| `roads-mock.ts` | Mock road data for development |

### Library (`lib/`)
| File | Purpose |
|------|---------|
| `road-chat-tools.ts` | AI tool definitions for road chat |

## Data Flow

```
Platform API → use-roads-query.ts → Road list
                                      ↓ (select road)
                               use-road-data-query.ts
                               use-road-speed-metrics-query.ts
                               use-road-heatmap-query.ts
                               use-road-trend-query.ts
                                      ↓
                               Road Detail Panel (speed cards, heatmaps, trends)
```
