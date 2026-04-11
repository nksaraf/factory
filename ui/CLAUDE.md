# TraffiCure – AI Agent Guide

> This file is the primary reference for AI agents (Claude Code, Cursor, etc.) working on this codebase.

## Tech Stack

- **Framework**: Vinxi (Vite + Nitro) with React 19 and React Router
- **Extension System**: Rio.js (`@rio.js/client`) — features are loaded as extensions with manifests
- **UI Library**: `@rio.js/ui` (shadcn-style components), `@rio.js/app-ui` (app shell)
- **Styling**: Tailwind CSS 3
- **State Management**: Rio.js Atoms (persistent global state) + React Context (feature state) + TanStack React Query (server state)
- **Maps/GIS**: `@rio.js/gis`, Mapbox GL, Google Maps, deck.gl
- **Auth**: Better Auth via `@rio.js/enterprise`
- **API Routes**: H3/Nitro (file-based in `src/routes/api/`)
- **Testing**: Vitest (unit), Playwright (E2E)
- **Language**: TypeScript 5.8

## Path Aliases

```
@/          → ./src/
~/          → ./  (project root)
@/components/ui → @rio.js/ui/components
```

## App Initialization Sequence

1. `entry.client.tsx` → imports `bootstrap.ts`, creates Rio client
2. `bootstrap.ts` → registers core services (commands, panels, UI/theme, logging)
3. `entry.client.tsx` → registers extensions (`trafficure.core`, `gis.core`, `agents.core`, `enterprise.core`)
4. Extensions load their `manifest.json` and register refs (map layers, sidebar items)
5. Router is created from extension-contributed routes via `rio.extensions.getContributions("routes")`

## Project Structure

```
src/
├── entry.client.tsx     # Client bootstrap (extension registration, providers, router)
├── entry.server.tsx     # SSR entry
├── bootstrap.ts         # Rio service registration (commands, panels, UI)
├── middleware.ts         # Server middleware (CSP headers, auth)
├── globals.css          # Tailwind imports and global styles
├── lib/                 # Shared server/client utilities (see below)
├── modules/             # Feature modules (self-contained, each has manifest.json)
│   ├── trafficure.core/       # Alerts, traffic layers, map interactions
│   ├── trafficure.analytics/  # Road analytics, speed data, compare tool
│   ├── trafficure.reports/    # PDF report generation (daily, weekly, monthly)
│   └── trafficure.common/     # Shared components across modules
├── routes/              # File-based routing (Vinxi convention)
│   ├── (app)/(dashboard)/     # Authenticated dashboard routes
│   ├── (auth)/                # Sign-in/sign-up
│   ├── (marketing)/           # Public landing pages
│   ├── api/                   # API endpoints (H3 handlers)
│   └── reports/print/         # Print-specific routes for PDF generation
├── components/          # App-level shared components
├── mocks/               # MSW mock handlers
└── types/               # Global type declarations
```

## Module Structure Convention

Every module under `src/modules/` follows this structure:

```
module-name/
├── index.ts          # Module manifest export (required)
├── manifest.json     # Rio.js extension manifest (sidebar items, layers, etc.)
├── components/       # UI components specific to this module
├── data/             # React Query hooks and data fetching logic
├── types/            # TypeScript interfaces with index.ts barrel export
├── utils/            # Pure utility functions
├── constants/        # Static config values
├── mocks/            # Mock data for testing/development
└── README.md         # Module documentation
```

## Typography

The app uses **Quicksand**, a rounded geometric sans-serif that renders visually thinner than other sans-serifs at the same weight. This is handled at the **config level** — not per-component.

### Font weight remapping (in `src/tailwind.v3.cjs`)

The **entire** `fontWeight` scale in `src/tailwind.v3.cjs` is shifted up by +100 for Quicksand. Every weight class outputs one step heavier than standard Tailwind:

| Class            | Standard | Quicksand (current) |
| ---------------- | -------- | ------------------- |
| `font-light`     | 300      | 400                 |
| `font-normal`    | 400      | 500                 |
| `font-medium`    | 500      | 600                 |
| `font-semibold`  | 600      | 700                 |
| `font-bold`      | 700      | 800                 |
| `font-extrabold` | 800      | 900                 |

**If you switch to Inter or another font**, revert the `fontWeight` map in the Tailwind config to standard values — no component changes needed.

- **Do not** sprinkle `font-medium` everywhere to compensate for thin rendering — the config handles it.
- Use the same weight classes you'd use with any font (`font-medium`, `font-semibold`, `font-bold`) for emphasis hierarchy — they just output heavier values under the hood.

### Font size rules

- **Never use `text-2xs` or arbitrary sizes like `text-[11px]`** — only standard Tailwind classes (`text-xs`, `text-sm`, `text-base`, `text-lg`, etc.).
- **Default to `text-base`** for all readable text — body copy, descriptions, sidebar items, table cells, form labels. It is the baseline legible size.
- **Use `text-sm` only to de-emphasize** something next to a `text-base` element (e.g., secondary metadata, helper text below a label, timestamps next to a title). Never use `text-sm` as the default body size.
- Metadata/captions: `text-xs`
- Page headings: `text-2xl`+
- Section headings: `text-lg` or `text-xl`

## Icons

Always use **Iconify** icons (preferably Phosphor duotone style). Never use lucide-react or other icon libraries directly.

Two ways to use icons:

### 1. CSS class name (for Tailwind / manifest / config)

```
className="icon-[ph--gear-duotone]"
```

### 2. React `<Icon>` component

```tsx
import { Icon } from "@rio.js/ui/icon"

;<Icon icon="icon-[ph--gear-duotone]" className="h-5 w-5" />
```

### Naming convention

- Format: `icon-[{collection}--{icon-name}]`
- Prefer Phosphor duotone: `icon-[ph--folder-duotone]`, `icon-[ph--database-duotone]`
- Browse available icons at https://icon-sets.iconify.design/ph/

## File Naming Conventions

- **Files**: `kebab-case.tsx` / `kebab-case.ts` (e.g., `alert-card.tsx`, `use-alert-focus.ts`)
- **React hook files**: Always prefix with `use-` (e.g., `use-road-data-query.ts`)
- **Components**: Named exports preferred (e.g., `export function AlertCard()`)
- **Types**: API response types get `Api` prefix (e.g., `AlertApiItem`), domain types are unprefixed (e.g., `Alert`)
- **Barrel exports**: `index.ts` in component/type directories re-exporting everything

## Routing Conventions

- **File-based routing**: `src/routes/(group)/path/page.tsx`
- **Route groups**: `(app)`, `(auth)`, `(marketing)` — parentheses mean no URL segment
- **Dynamic params**: `[paramName]/page.tsx` → `:paramName`
- **Catch-all**: `[...page].tsx` → for API routes handling multiple methods
- **Layouts**: `layout.tsx` in route directory wraps child routes
- **Loaders**: Export `async function loader()` for server-side data loading

## State Management Patterns

### 1. Rio.js Atoms (persistent global state)

Used for: theme, UI preferences, anything that persists across sessions.

```typescript
// In a RioMolecule class (see bootstrap.ts)
_mode = this.atom("light", { name: "mode", persist: true })
```

### 2. React Context (feature-scoped state)

Used for: query filters, sort order, selected items within a feature.

```typescript
// Create in components/ dir, e.g., alerts-query-context.tsx
export const AlertsQueryContext = createContext<AlertsQueryContextType>(...)
```

### 3. React Query (server state)

Used for: all API data fetching. Hooks live in `data/` directories.

```typescript
// In data/use-*.ts
export function useAlertsQuery(filters, sort) {
  return useQuery({
    queryKey: [orgId, "alerts", ...dependencies],
    queryFn: async () => {
      /* fetch + transform */
    },
    refetchInterval: 60000,
  })
}
```

### 4. App State (workspace/layout state)

Used for: drawer positions, snap points, panel sizes.

```typescript
const [state] = useAppState<T>("key", defaultValue)
```

## Data Fetching Pattern

1. **API calls** go in `modules/<module>/data/` as React Query hooks
2. **Query keys** must include all filter/sort dependencies for correct cache invalidation
3. **API → Domain transformation**: Use `transformApiXToX()` functions to map API snake_case to domain camelCase
4. **Conditional fetching**: Use `enabled: !!dependency` to prevent queries without required data

## Feature Flags

Feature flags are environment variables defined in `app.settings.ts` with Zod schemas:

```typescript
env.PUBLIC_ENABLE_ANALYTICS === "true"
env.PUBLIC_ENABLE_REPORTS === "true"
env.PUBLIC_ENABLE_COMPARE_TOOL === "true"
```

Modules filter their sidebar items based on these flags in their `index.ts`.

## Environment Configuration

- **Schema**: `app.settings.ts` — all env vars validated with Zod
- **PUBLIC vars**: Available client-side, prefixed with `PUBLIC_`
- **PRIVATE vars**: Server-only (database URLs, API keys, secrets)
- **Access**: `import { env } from "@rio.js/env"`

## How To: Common Tasks

### Add a new page

1. Create `src/routes/(app)/(dashboard)/your-page/page.tsx`
2. Export a default React component
3. Optionally export `async function loader()` for server data

### Add a new API endpoint

1. Create `src/routes/api/your-endpoint/[...page].tsx`
2. Export handler: `export async function GET(event) { ... }`

### Add a new data hook

1. Create `src/modules/<module>/data/use-your-data.ts`
2. Use `useQuery()` with proper query key dependencies
3. Transform API response to domain types

### Add a new component to a module

1. Create `src/modules/<module>/components/your-component.tsx`
2. Add named export to barrel `index.ts` if one exists

### Add a new module

1. Create `src/modules/your-module/` with `manifest.json` and `index.ts`
2. Register in `entry.client.tsx`: `rio.extensions.register({ "your-module": () => import("./modules/your-module") })`
3. Enable: `await rio.extensions.enable("your-module")`

## Important: Timestamp Convention (Alerts)

The alerts system has legacy and modern timestamp fields:

- `startedAt` — **Use this.** When the alert was first triggered (from API `alert_event_time`)
- `lastUpdatedAt` — When the alert data was last refreshed
- `timestamp` — **Deprecated.** Legacy alias for `startedAt`, kept for backward compatibility

## Dependencies Between Modules

```
trafficure.common  ← shared utilities used by all modules
trafficure.core    ← alerts, traffic layers, map interactions (main module)
trafficure.analytics ← road analytics, depends on core for map context
trafficure.reports ← PDF reports, largely independent
```

## Testing

- **Unit tests**: `vitest` — run with `pnpm test`
- **E2E tests**: `playwright` — run with `npx playwright test`
- **Test files**: Colocated next to source as `*.test.ts` / `*.test.tsx`
- **Mocks**: MSW handlers in `src/mocks/`, module-specific mocks in `modules/<module>/mocks/`
