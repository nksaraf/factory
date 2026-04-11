# @rio.js/ui-next Design System Spec

## Context

The current `@rio.js/ui` package started as a shadcn/ui fork but has heavily drifted: three overlapping color token systems, 4 competing toast implementations, heavily rewritten components with dead code, inconsistent z-index values (2000-40000), and hardcoded colors bypassing tokens. A comprehensive audit cataloged all drift across ~80 component files.

This redesign creates a **new package** (`@rio.js/ui-next`) that:

- Keeps shadcn/ui API compatibility so AI-generated code works out of the box
- Owns the styling through a clean Radix Colors-based token system
- Extends components with rich, smart props for developer and agent ergonomics
- Provides live documentation via Fumadocs with MDX
- Includes unit tests and visual regression testing
- Supports runtime theming (dark/light + brand customization)

---

## 1. Package Structure

```
packages/npm/ui-next/
├── package.json                  # @rio.js/ui-next
├── tsconfig.json
├── tailwind.config.ts            # Tailwind v3 config with custom tokens
├── src/
│   ├── components/               # All UI components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── ...
│   │   └── composed/             # Higher-order composed components
│   │       ├── menu.tsx           # Unified menu abstraction
│   │       ├── multi-select.tsx
│   │       ├── combobox.tsx
│   │       ├── date-picker.tsx
│   │       ├── date-range-picker.tsx
│   │       ├── time-picker.tsx
│   │       ├── data-table.tsx
│   │       ├── auto-form.tsx
│   │       ├── input-group.tsx
│   │       └── panel.tsx          # Resizable panels
│   ├── lib/
│   │   ├── utils.ts              # cn(), cva() (hand-rolled)
│   │   ├── rich-props.tsx        # withRichProps shared logic
│   │   ├── icons.tsx             # Iconify integration
│   │   └── fromnow.ts
│   ├── hooks/
│   │   ├── use-is-mobile.ts
│   │   ├── use-media-query.ts
│   │   └── ...
│   ├── providers/
│   │   ├── theme-provider.tsx    # Runtime theme switching
│   │   └── tooltip-provider.tsx
│   ├── styles/
│   │   ├── tokens.css            # All CSS custom properties
│   │   ├── themes/
│   │   │   ├── light.css         # Light theme variable set
│   │   │   ├── dark.css          # Dark theme variable set
│   │   │   └── [brand].css       # Brand theme overrides
│   │   └── globals.css           # Base styles, font imports
│   └── index.ts                  # Barrel export
├── docs/                         # Fumadocs MDX documentation
│   ├── components/
│   │   ├── button.mdx
│   │   ├── dialog.mdx
│   │   └── ...
│   └── getting-started.mdx
├── tests/
│   ├── components/               # Vitest + Testing Library
│   │   ├── button.test.tsx
│   │   └── ...
│   └── visual/                   # Playwright visual regression
│       └── snapshots/
├── archive/                      # Extracted domain-specific components
│   ├── map-toolbar.tsx
│   ├── timeline-picker.tsx
│   ├── bottom-panel.tsx
│   ├── dynamic-island.tsx
│   └── map-control-button.tsx
└── fumadocs.config.ts
```

### Export Strategy

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./components/*": "./src/components/*.tsx",
    "./composed/*": "./src/components/composed/*.tsx",
    "./hooks/*": "./src/hooks/*.ts",
    "./lib/*": "./src/lib/*.ts",
    "./providers/*": "./src/providers/*.tsx",
    "./styles/*": "./src/styles/*.css"
  }
}
```

### Migration Path

Both `@rio.js/ui` (frozen) and `@rio.js/ui-next` coexist. Consumers migrate imports file-by-file. Same Radix primitives underneath — no conflicts.

**Breaking change note:** Button default variant changes from `"primary"` (current) to `"default"` (shadcn standard). Every `<Button>` without an explicit `variant` prop will change appearance after migration. The migration guide should flag this with a search pattern: grep for `<Button` without `variant=`.

---

## 2. Token Foundation

### Color System

**Three color categories:**

1. **Scale** (`scale-50` through `scale-950` + `scale-850`) — 12 steps mapped 1:1 from Radix Colors gray palette (default: Radix Mauve). Used for backgrounds, foregrounds, borders, surfaces.

2. **Accent** (`accent-50` through `accent-950` + `accent-850`) — 12 steps mapped 1:1 from Radix Colors chromatic palette (default: Radix Indigo). Used for brand, primary actions, focus rings, active states.

3. **Status colors** — Radix Red, Amber, Green, Blue mapped to Tailwind naming (`red-50..950`, `amber-50..950`, etc.). Used for destructive, warning, success states.

### CSS Variable Format

All color variables store **raw HSL triplets** (no `hsl()` wrapper) for Tailwind v3 opacity utility compatibility:

```css
--scale-50: 300 20% 99%; /* Radix Mauve 1 as HSL */
--accent-800: 226 70% 55.5%; /* Radix Indigo 9 as HSL */
```

Usage in Tailwind: `bg-[hsl(var(--scale-50))]` or via the configured theme colors `bg-scale-50`.
Usage with opacity: `bg-scale-50/50` works because Tailwind injects the alpha into the HSL function.

**v4 migration note:** When moving to Tailwind v4 + OKLCH, convert the HSL triplets to OKLCH. The variable names and alias structure stay the same.

### Radix → Tailwind Scale Mapping

| Tailwind Step | Radix Step | Semantic Purpose              |
| ------------- | ---------- | ----------------------------- |
| 50            | 1          | App background                |
| 100           | 2          | Subtle background             |
| 200           | 3          | UI element background         |
| 300           | 4          | Hovered UI element bg         |
| 400           | 5          | Active / selected bg          |
| 500           | 6          | Subtle borders                |
| 600           | 7          | Border, focus rings           |
| 700           | 8          | Hovered border                |
| 800           | 9          | Solid bg (the "brand" swatch) |
| 850           | 10         | Hovered solid bg              |
| 900           | 11         | Low-contrast text             |
| 950           | 12         | High-contrast text            |

### shadcn Token Aliases

These map to the scale/accent system so AI-generated shadcn code works:

```css
:root {
  /* Backgrounds */
  --background: var(--scale-50);
  --foreground: var(--scale-950);
  --card: var(--scale-50);
  --card-foreground: var(--scale-950);

  /* Primary = accent */
  --primary: var(--accent-800);
  --primary-foreground: white;

  /* Secondary / muted = scale */
  --secondary: var(--scale-100);
  --secondary-foreground: var(--scale-900);
  --muted: var(--scale-100);
  --muted-foreground: var(--scale-500);

  /* Accent highlight */
  --accent: var(--accent-100);
  --accent-foreground: var(--accent-900);

  /* Destructive */
  --destructive: var(--red-800);
  --destructive-foreground: white;

  /* Borders */
  --border: var(--scale-200);
  --input: var(--scale-200);
  --ring: var(--accent-500);

  /* Popover / Sidebar */
  --popover: var(--scale-50);
  --popover-foreground: var(--scale-950);
  --sidebar-background: var(--scale-50);
  --sidebar-foreground: var(--scale-950);
  --sidebar-border: var(--scale-200);
  --sidebar-accent: var(--accent-100);
  --sidebar-accent-foreground: var(--accent-900);

  /* Radius */
  --radius: 0.5rem;
}
```

### Dark Mode

Dark mode inverts the scale mapping:

```css
.dark {
  --background: var(--scale-950);
  --foreground: var(--scale-50);
  --card: var(--scale-900);
  --card-foreground: var(--scale-50);
  --primary: var(--accent-800);
  --primary-foreground: white;
  --secondary: var(--scale-800);
  --muted: var(--scale-800);
  --muted-foreground: var(--scale-400);
  --accent: var(--accent-200);
  --accent-foreground: var(--accent-50);
  --border: var(--scale-700);
  --input: var(--scale-700);
  --ring: var(--accent-400);

  /* Popover / Sidebar */
  --popover: var(--scale-900);
  --popover-foreground: var(--scale-50);
  --sidebar-background: var(--scale-900);
  --sidebar-foreground: var(--scale-50);
  --sidebar-border: var(--scale-700);
  --sidebar-accent: var(--accent-200);
  --sidebar-accent-foreground: var(--accent-50);
}
```

The Radix dark scale values are used (Radix provides separate light/dark palettes with proper contrast).

### Runtime Theming

`ThemeProvider` swaps CSS variable sets at runtime:

```tsx
<ThemeProvider
  defaultTheme="light"
  neutral="mauve" // Radix gray palette: mauve | slate | gray | sand | olive
  accent="indigo" // Radix chromatic: indigo | blue | violet | cyan | teal | ...
>
  {children}
</ThemeProvider>
```

Changing `neutral` or `accent` swaps the `--scale-*` and `--accent-*` variable sets. All components re-theme automatically because they reference these variables.

**Mechanism:** ThemeProvider ships a lookup table of pre-computed HSL triplets for each Radix palette (5 neutrals × ~15 accents). On mount and on prop change, it sets the 12 `--scale-*` and 12 `--accent-*` CSS variables as inline styles on `document.documentElement`. This is ~24 style properties — negligible perf cost.

**SSR/FOUC prevention:** Carry forward the `ThemeScript` pattern from existing `theme.tsx` — inject an inline `<script>` in `<head>` that reads `localStorage` and sets `class="dark"` + initial CSS variables before first paint. The ThemeProvider hydrates and takes over on the client.

**Persistence:** `localStorage` stores `{ theme: "dark", neutral: "mauve", accent: "indigo" }`. System preference detection via `prefers-color-scheme` media query as fallback when no stored preference.

### Z-Index Layers

```css
:root {
  --z-base: 0;
  --z-sticky: 5;
  --z-dropdown: 10;
  --z-popover: 20;
  --z-modal: 30;
  --z-toast: 40;
  --z-tooltip: 50;
}
```

Exposed as Tailwind utilities: `z-sticky`, `z-dropdown`, `z-popover`, `z-modal`, `z-toast`, `z-tooltip`.

### Typography

- **Body + Display:** Inter (all weights via variable font)
- **Monospace:** Roboto Mono
- **Base size:** 0.8125rem (13px) — intentional for data-heavy app
- **Hierarchy via weight:** 400 (body), 500 (emphasis), 600 (headings), 700 (display)
- **Drop:** Cera Pro, Jakarta, Caveat

### Spacing & Sizing

Use **Tailwind defaults** for spacing and sizing. Drop the custom `--spacing-*` and `--sizing-*` tokens from the existing codebase — they add no value over Tailwind's built-in scale.

### Shadows

Use **Tailwind defaults** (`shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`, `shadow-xl`). Drop the existing hardcoded box-shadow values in popover.tsx etc. If a custom shadow is needed for elevation, define it in the Tailwind config `boxShadow` extend.

### Animation Tokens

Standard durations and easings to replace the framer-motion dependency:

```css
:root {
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
}
```

Use with `tailwindcss-animate` plugin for enter/exit animations. No framer-motion in the UI library.

### CVA (Class Variance Authority)

Keep the **hand-rolled CVA** from `lib/utils.ts` (supports compound variants). Drop the `class-variance-authority` npm package dependency. The hand-rolled version is lighter and already proven in the existing codebase.

### Tailwind v3/v4 Compatibility

- Primary target: **Tailwind v3** with `tailwind.config.ts`
- CSS custom properties defined in `tokens.css` — works in both v3 and v4
- No v4-only features used (no `@theme` directive, no `@layer theme`)
- When migrating to v4: convert `tailwind.config.ts` colors to `@theme` block, tokens.css stays as-is

### What Gets Killed

All three legacy token systems are replaced:

| Killed                             | Replaced By                    |
| ---------------------------------- | ------------------------------ |
| `scale-100..1200` (Supabase-style) | `scale-50..950` (Radix values) |
| `--colors-gray-dark-*`             | `scale-*` in dark theme        |
| `--colors-slate-light-*`           | `scale-*` in light theme       |
| `--foreground-default` (semantic)  | `--foreground` (shadcn alias)  |
| `--background-surface-300`         | `--card` or `scale-*` directly |
| `brand-*` tokens                   | `accent-*`                     |
| `scaleA-*` (alpha tokens)          | `scale-*/opacity` via Tailwind |
| RGB `--accent` (format bug)        | HSL-based `--accent` alias     |

---

## 3. Component Architecture

### React 19 Patterns

All components use React 19 idioms:

- **No `forwardRef`** — use `ref` as a regular prop
- **`use()` hook** for context consumption (not `useContext`)
- **`data-slot` attributes** on all component parts for CSS targeting
- **Server component compatible** where possible (mark client components with `"use client"`)

### Provider Pattern for Complex Components

Complex components expose a Provider + `use[Component]()` hook pattern:

```tsx
// Provider sets variant at root, children inherit
;<DialogProvider variant="loud">
  <Dialog>
    <DialogContent>
      {" "}
      {/* inherits "loud" styling */}
      <DialogHeader /> {/* inherits "loud" styling */}
    </DialogContent>
  </Dialog>
</DialogProvider>

// Hook for children to read variant
const { variant } = useDialog()
```

Components that get providers:

- **Dialog** — variant: "default" | "loud"
- **Select** — size: "sm" | "default" | "lg"
- **Tabs** — variant: "default" | "outline" | "pills"
- **Table** — variant: "default" | "grid" | "compact"
- **ToggleGroup** — already has this pattern, keep it
- **Menu** (unified) — type: "dropdown" | "context" | "menubar"

Default behavior: if no provider wraps the component, it uses default variant. The provider is optional — zero friction for simple use.

### Universal Rich Props

Available on all interactive components (Button, MenuItem, Tab, Select items, etc.):

```tsx
interface RichProps {
  icon?: string // Iconify icon name, renders before children
  iconRight?: string // Iconify icon name, renders after children
  loading?: boolean // Shows spinner, disables interaction
  tooltip?: string | ReactNode // Wraps in Tooltip. Defaults to `description` if set
  shortcut?: string // Keyboard shortcut display (e.g. "⌘K")
  allowed?: boolean // Permission-based enable/disable
  reason?: string // Displayed in tooltip when disabled or !allowed
  description?: string // Secondary text below the label
}
```

**Smart defaults:**

- If `tooltip` is not set but `description` is, tooltip auto-shows `description` on hover
- If `allowed === false`, component renders disabled + shows `reason` in a tooltip
- If `loading === true`, content is replaced with spinner + component becomes non-interactive
- If `icon` is set without children, component renders icon-only with proper sizing
- `shortcut` renders right-aligned in menus, as a `<Kbd>` element in buttons/tooltips

**Implementation:** A shared `useRichProps()` hook + `<RichWrapper>` component in `src/lib/rich-props.tsx`. Each component calls the hook and renders the wrapper — not a HOC, so it's tree-shakeable and debuggable.

```tsx
// Example: how Button uses rich props internally
function Button({
  icon,
  iconRight,
  loading,
  tooltip,
  shortcut,
  allowed,
  reason,
  description,
  children,
  ...props
}) {
  const rich = useRichProps({
    icon,
    iconRight,
    loading,
    tooltip,
    shortcut,
    allowed,
    reason,
    description,
  })

  const button = (
    <button disabled={rich.disabled} {...props}>
      {rich.leftSlot} {/* icon or spinner */}
      {rich.children(children)} {/* children or loading placeholder */}
      {rich.rightSlot} {/* iconRight or shortcut */}
    </button>
  )

  return rich.wrap(button) // wraps in Tooltip if needed
}
```

### Icon System

Standardized on **Iconify** via `@iconify/react`:

```tsx
import { Icon } from "@rio.js/ui-next/lib/icons"

// Usage — string-based, massive icon coverage
<Button icon="mdi:check" />
<Button icon="lucide:settings" />
<Button icon="heroicons:arrow-right" />
```

The `Icon` component wraps `@iconify/react`'s `Icon` with consistent sizing that adapts to the parent component's size variant.

**Bundling strategy:** Use `@iconify/react` with **bundled icon data** (not API fetches). Install icon sets as npm packages (`@iconify-json/mdi`, `@iconify-json/lucide`, etc.) and import them. This makes icons SSR-safe, offline-capable, and tree-shakeable. The existing CSS class approach (`icon-[mdi--check]` via `@iconify/tailwind`) can coexist for static icons in CSS-only contexts, but the React component is the primary API.

**Migration from existing Icon component:** The existing 300+ icon registry in `icon.tsx` maps custom string names to React elements. Create a compatibility layer that maps old names to Iconify identifiers, then deprecate. New code uses Iconify names directly.

### Component Tiers

#### Tier 1: Reset to shadcn defaults + restyle (~25 components)

Start from latest shadcn/ui source code. Apply new tokens. Add universal rich props. Add `data-slot` attributes. Use React 19 patterns.

Components: Alert, AlertDialog, AspectRatio, Avatar, Badge, Breadcrumb, Calendar, Card, Checkbox, Collapsible, Drawer, HoverCard, InputOTP, Label, Pagination, Progress, RadioGroup, ScrollArea, Separator, Skeleton, Switch, Textarea, Toggle, ToggleGroup, Carousel (new), Resizable (new).

#### Tier 2: Rebuild with kept enhancements (~15 components)

Start from shadcn, add back good customizations, clean up bad drift:

| Component          | Keep                                                       | Cut                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**         | icon, loading, iconRight, size variants                    | 13→7 variants: default, secondary, outline, ghost, link, danger, success. Kill alternativeScale, dashed, primary-light, text. Kill MapControlButton. Kill window.createStories. |
| **Input**          | size variants (sm/default/lg), icon variant                | Remove duplicate TextArea, unreachable code, commented handleChange, duplicate border classes.                                                                                  |
| **Dialog**         | loud variant (via provider), DialogBody                    | Clean commented code. Use `--radius` token not hardcoded `rounded-[16px]`.                                                                                                      |
| **Select**         | size variants via provider                                 | Extract FancyMultiSelect to composed/multi-select.tsx. Use z-popover.                                                                                                           |
| **Tabs**           | icon support, variant provider                             | Remove forced `text-white`. Use tokens for active state.                                                                                                                        |
| **Table**          | sticky headers, variant provider (default/grid/compact)    | Kill `bg-sky-100` hardcode. Use z-sticky.                                                                                                                                       |
| **Popover**        | portal prop                                                | Deduplicate portal/non-portal branches. Use shadow token. Use `border-border`.                                                                                                  |
| **Sheet**          | data-slot, icon header                                     | Remove 140 lines of commented-out old version.                                                                                                                                  |
| **Tooltip**        | color variants (popover/accent), arrow prop                | Use z-tooltip instead of z-[40000].                                                                                                                                             |
| **Accordion**      | hidden chevron, contentClassName                           | Restyle with tokens.                                                                                                                                                            |
| **Command**        | custom input wrapper                                       | Restyle with tokens.                                                                                                                                                            |
| **Form**           | SubmitButton, `use()` hook, data-slot, zod/form re-exports | Keep as-is, restyle.                                                                                                                                                            |
| **Slider**         | RangeSlider, SingleSlider                                  | Remove nprogress import. Don't hardcode two thumbs on base Slider.                                                                                                              |
| **DropdownMenu**   | icon, info tooltip, allowed props                          | Great UX pattern. Restyle.                                                                                                                                                      |
| **ContextMenu**    | tooltip, permission UX                                     | Fix z-index to named layers.                                                                                                                                                    |
| **Menubar**        | core functionality                                         | Remove framer-motion. Use CSS transitions.                                                                                                                                      |
| **Sonner**         | theme integration                                          | Single toast implementation.                                                                                                                                                    |
| **Sidebar**        | custom width constants, ~600 lines                         | Restyle with tokens. Complex — gets provider pattern.                                                                                                                           |
| **NavigationMenu** | core structure                                             | Un-comment viewport. Fix commented-out chevron. Restyle.                                                                                                                        |

#### Tier 3: Composed components (~12)

Higher-order components that compose Tier 1/2 primitives:

- **Menu** — unified menu factory (dropdown/context/menubar). Keep existing abstraction, restyle.
- **MultiSelect** — based on multi-select-search.tsx approach (simpler). Kill 32KB multi-select.tsx.
- **Combobox** — searchable select using Command.
- **DatePicker** — consolidate from date-picker.tsx.
- **DateRangePicker** — consolidate from date-range-picker.tsx.
- **TimePicker** — consolidate from time-picker.tsx. Kill month-picker, week-picker, date-time-picker.
- **DataTable** — TanStack Table wrapper with standard column/filter patterns.
- **AutoForm** — Zod-schema form generation. Keep existing, restyle.
- **Panel** — resizable panels. Keep existing, restyle.
- **InputGroup** — input with addons. Keep existing data-slot/data-align pattern.
- **Kbd** — keyboard shortcut display.
- **StatusChip** — status indicator badge variant.

#### Tier 4: Archive

Moved to `archive/` folder — not in package exports, preserved for reference:

- map-toolbar.tsx
- timeline-picker.tsx (22KB)
- bottom-panel.tsx
- dynamic-island.tsx
- MapControlButton (from button.tsx)

#### Tier 5: Kill (not carried over)

- `toast.tsx` (Radix-based) — Sonner only
- `use-toast.tsx` (reducer pattern) — Sonner only
- `toaster.tsx` (Sonner wrapper with custom positioning) — simplified into sonner.tsx
- `image.tsx` — just wraps `<img/>`
- `error-boundary.tsx` — just re-exports `react-error-boundary`
- `color-picker.tsx` — mostly commented-out, incomplete
- `multi-select.tsx` (32KB) — replaced by composed/multi-select.tsx
- `portal.tsx` — use Radix Portal directly
- `drop-down-search.tsx` — replaced by Combobox
- `month-picker.tsx`, `week-picker.tsx` — consolidated into DatePicker
- `date-range-picker.tsx`, `date-time-picker.tsx` — superseded by composed/date-range-picker.tsx and composed/time-picker.tsx
- `window.createStories` global — removed entirely
- `link.tsx`, `navlink.tsx`, `nav-indicator.tsx` — routing-specific, move to `@rio.js/app-ui`
- `number.tsx`, `search.tsx`, `search-param-link.tsx` — app-specific utilities, move to `@rio.js/app-ui`

---

## 4. Documentation (Fumadocs)

### Setup

Fumadocs runs as a separate app at `apps/ui-docs/` that imports `@rio.js/ui-next`. Separate from the package to keep the library dependency-free from documentation tooling.

Each component gets an MDX page:

```mdx
---
title: Button
description: Displays a button or a component that looks like a button.
---

import { Button } from "@rio.js/ui-next/components/button"

## Usage

<ComponentPreview>
  <Button>Click me</Button>
</ComponentPreview>

## Variants

<ComponentPreview>
  <Button variant="default">Default</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="link">Link</Button>
  <Button variant="danger">Danger</Button>
  <Button variant="success">Success</Button>
</ComponentPreview>

## Rich Props

<ComponentPreview>
  <Button icon="mdi:check">With Icon</Button>
  <Button loading>Loading</Button>
  <Button shortcut="⌘S">Save</Button>
  <Button allowed={false} reason="No permission">
    Restricted
  </Button>
</ComponentPreview>

## Props

<PropsTable component="Button" />
```

### ComponentPreview

A custom Fumadocs component that renders live examples with:

- Source code toggle
- Dark/light mode toggle
- Copy code button
- Responsive viewport toggle

### PropsTable

Auto-generated from TypeScript types using `fumadocs-typescript` plugin.

---

## 5. Testing Strategy

### Unit Tests (Vitest + @testing-library/react)

Every component gets tests covering:

- **Rendering:** all variants, sizes, and states
- **Interaction:** click, keyboard, focus management
- **Accessibility:** ARIA attributes, roles, labels
- **Rich props:** icon rendering, loading state, tooltip, allowed/reason, shortcut
- **Provider pattern:** variant inheritance from parent provider

```tsx
// Example: button.test.tsx
describe('Button', () => {
  it('renders all variants', () => { ... })
  it('shows spinner when loading', () => { ... })
  it('renders icon from Iconify name', () => { ... })
  it('disables and shows reason tooltip when allowed=false', () => { ... })
  it('renders shortcut as Kbd', () => { ... })
  it('tooltip defaults to description when tooltip prop not set', () => { ... })
})
```

### Visual Regression (Playwright)

Screenshot tests for each component:

- All variants × dark/light mode
- Responsive breakpoints
- Interactive states (hover, focus, active, disabled)
- Run on PR via CI

### Accessibility (axe-core)

Integrated into unit tests:

```tsx
import { axe } from "vitest-axe"
it("has no a11y violations", async () => {
  const { container } = render(<Button>Test</Button>)
  expect(await axe(container)).toHaveNoViolations()
})
```

### Browser Testing (agent-browser)

Use agent-browser skill during development to:

- Visually verify component rendering in real browser
- Test interactive behavior (hover states, animations, transitions)
- Verify theme switching works visually
- Test responsive behavior

---

## 6. Implementation Phases

### Phase 1: Foundation

1. Create `packages/npm/ui-next/` package with structure
2. Set up `tokens.css` with Radix Colors mapped to scale-50..950 + accent-50..950
3. Set up shadcn alias layer (--background, --primary, etc.)
4. Set up light.css and dark.css themes
5. Set up Tailwind v3 config with custom tokens and z-index utilities
6. Implement `ThemeProvider` with runtime neutral/accent palette switching
7. Set up `lib/utils.ts` (cn, cva)
8. Set up `lib/rich-props.tsx` (useRichProps hook + RichWrapper)
9. Set up `lib/icons.tsx` (Iconify wrapper)
10. Set up Fumadocs with basic config
11. Set up Vitest + Testing Library + Playwright

### Phase 2: Tier 1 Components (reset + restyle)

Build ~25 components from latest shadcn source, applying new tokens and rich props. Each component gets:

- The component file in `src/components/`
- An MDX doc page
- Unit tests
- Visual snapshot

### Phase 3: Tier 2 Components (rebuild with enhancements)

Build ~15 components from shadcn base + good customizations. Key work:

- Button: trim to 7 variants
- Input: clean rewrite
- Dialog: provider pattern for loud variant
- Select: provider pattern for sizes
- Tabs: provider pattern for variants
- Table: provider pattern for variants, kill hardcoded colors
- Toast: Sonner only

### Phase 4: Tier 3 Composed Components

Build ~12 higher-order components:

- Menu (unified), MultiSelect, Combobox
- DatePicker, DateRangePicker, TimePicker (consolidated)
- DataTable, AutoForm, Panel, InputGroup
- Kbd, StatusChip

### Phase 5: Migration Support

- Archive Tier 4 components
- Create migration guide (old import → new import mapping)
- Add `@rio.js/ui-next` to consuming apps alongside `@rio.js/ui`
- Begin file-by-file migration

---

## 7. Key Files to Create/Modify

| File                                                    | Action                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/npm/ui-next/package.json`                     | Create — new package                                       |
| `packages/npm/ui-next/tsconfig.json`                    | Create                                                     |
| `packages/npm/ui-next/tailwind.config.ts`               | Create — tokens, z-index, fonts                            |
| `packages/npm/ui-next/src/styles/tokens.css`            | Create — all CSS custom properties                         |
| `packages/npm/ui-next/src/styles/themes/light.css`      | Create — Radix light palette                               |
| `packages/npm/ui-next/src/styles/themes/dark.css`       | Create — Radix dark palette                                |
| `packages/npm/ui-next/src/styles/globals.css`           | Create — base styles, Inter font                           |
| `packages/npm/ui-next/src/lib/utils.ts`                 | Create — reuse pattern from `packages/npm/ui/lib/utils.ts` |
| `packages/npm/ui-next/src/lib/rich-props.tsx`           | Create — useRichProps + RichWrapper                        |
| `packages/npm/ui-next/src/lib/icons.tsx`                | Create — Iconify wrapper                                   |
| `packages/npm/ui-next/src/providers/theme-provider.tsx` | Create — runtime theming                                   |
| `packages/npm/ui-next/src/components/*.tsx`             | Create — all components                                    |
| `packages/npm/ui-next/docs/**/*.mdx`                    | Create — Fumadocs pages                                    |
| `packages/npm/ui-next/tests/**/*.test.tsx`              | Create — all tests                                         |
| `packages/npm/ui-next/archive/*.tsx`                    | Create — moved domain components                           |

### Existing code to reference/reuse

- `packages/npm/ui/lib/utils.ts` — hand-rolled CVA, keep pattern
- `packages/npm/ui/theme.tsx` — ThemeProvider pattern, extend for neutral/accent switching
- `packages/npm/ui/menu.tsx` — unified menu abstraction, port to new tokens
- `packages/npm/ui/auto-form/` — port as-is, restyle
- `packages/npm/ui/panel/` — port as-is, restyle
- `packages/npm/ui/input-group.tsx` — good data-slot pattern, port
- `packages/npm/ui/hooks/` — port all hooks

---

## 8. Verification

### During Development

- `agent-browser` skill to visually verify each component in real browser
- Fumadocs dev server for live preview of docs and examples
- `vitest --watch` for continuous unit test feedback

### Before Merge

- All unit tests pass: `vitest run`
- Visual snapshots updated: `playwright test`
- No a11y violations: axe-core checks in unit tests
- Fumadocs builds: `fumadocs build`
- TypeScript compiles: `tsc --noEmit`
- Theme switching works: dark/light + at least one accent swap

### Migration Verification

- Import `@rio.js/ui-next` in one consuming app page
- Verify it renders correctly alongside `@rio.js/ui` components
- Verify no CSS conflicts between old and new packages
