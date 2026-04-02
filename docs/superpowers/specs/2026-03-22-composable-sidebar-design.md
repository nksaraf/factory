# Composable Sidebar Components

## Problem

The enterprise.core sidebar is a set of monolithic components (`DefaultSidebarHeader`, `DefaultSidebarContent`, `DefaultSidebarFooter`). Apps that want to customize the sidebar (e.g., adding Search or Home) must replace entire sections via Portkey, duplicating all the default content. There's no way to compose a sidebar from reusable parts.

## Design

Decompose the sidebar into atomic components and wrapper components. Each atomic component is self-contained (handles its own `SidebarMenuItem`/`SidebarMenuButton`). Each wrapper component handles Portkey registration and styling containers internally, using `useApp()` to derive the app ID.

Note: The tunnel API uses `Portkey` as the producer component and `PortkeyOut` as the consumer. The wrapper components use `Portkey` (producer) to send content to the existing `PortkeyOut` slots in `AppSidebar`.

### Wrapper Components

These go in `src/sidebar/` and are used by apps to compose sidebar sections. Each accepts an optional `className` prop for style overrides.

**`AppSidebarHeader`** — wraps children in `Portkey(${app.id}/sidebar/header)` + `SidebarHeader` + `SidebarMenu`.

**`AppSidebarContent`** — wraps children in `Portkey(${app.id}/sidebar/content)` + `SidebarContent`. No `SidebarMenu` wrapper (content uses `SidebarGroup` internally).

**`AppSidebarFooter`** — wraps children in `Portkey(${app.id}/sidebar/footer)` + `SidebarFooter` + `SidebarMenu`.

### Atomic Components

Each lives in its own file in `src/sidebar/`.

| Component | Source | Wraps in SidebarMenuItem? | Notes |
|---|---|---|---|
| `SidebarOrgSwitcher` | Extracted from `DefaultSidebarHeader` | No (OrganizationSwitcher handles its own) | Uses sidebar state for popover side |
| `SidebarAppLogo` | Extracted from `DefaultSidebarHeader` | Yes | Renders app logo + name from `useApp()`. Contains "Smart" brand logic (kept as-is for now). |
| `SidebarHome` | New, opt-in | Yes | Button with home icon, active when pathname is `/` |
| `SidebarSearch` | New, opt-in | Yes | Button with search icon, active when pathname starts with `/search` |
| `SidebarExtensions` | Extracted from `DefaultSidebarContent` | No (renders full groups) | Dynamic manifest-contributed `sidebarGroups`/`sidebarItems` |
| `SidebarNotifications` | Extracted from `DefaultSidebarFooter` | Yes | Button (non-navigating, matching current behavior), active when pathname is `/notifications` |
| `SidebarSupport` | Renamed from Help | Yes | Button (non-navigating), active when pathname is `/support`. Icon: `icon-[ph--lifebuoy-duotone]`. This is a label/icon change from the current "Help" button. |
| `SidebarUser` | Extracted from `DefaultSidebarFooter` | No (UserButton handles its own) | Wraps `UserButton` in `Suspense`. Forwards `classNames` prop. |

### File Structure

```
packages/npm/enterprise.core/src/
  sidebar/
    index.ts                    # re-exports all components
    app-sidebar-header.tsx
    app-sidebar-content.tsx
    app-sidebar-footer.tsx
    sidebar-org-switcher.tsx
    sidebar-app-logo.tsx
    sidebar-home.tsx
    sidebar-search.tsx
    sidebar-extensions.tsx
    sidebar-notifications.tsx
    sidebar-support.tsx
    sidebar-user.tsx
  routes/(app)/(dashboard)/
    sidebar.tsx                 # AppSidebar unchanged — uses PortkeyOut + defaults
```

Note: An identical sidebar exists in `packages/npm/app.core/src/routes/(root)/(app)/sidebar.tsx`. Both files should be updated to compose from the new atomic components. The atomic components live in `enterprise.core`; `app.core`'s sidebar imports and uses them.

### Default Behavior (Backward Compat)

`AppSidebar` in `sidebar.tsx` continues to use `PortkeyOut` with fallback defaults. The defaults are updated to compose from the new atomic components, so the rendered output is identical. Apps that don't customize via Portkey see no change.

Updated defaults:
- `DefaultSidebarHeader` → `SidebarOrgSwitcher` + `SidebarAppLogo`
- `DefaultSidebarContent` → `SidebarExtensions`
- `DefaultSidebarFooter` → `SidebarNotifications` + `SidebarSupport` + `SidebarUser`

`SidebarHome` and `SidebarSearch` are **opt-in only** — they are not included in the defaults. Apps must compose their own sidebar via the wrapper components to include them.

The empty `ExtensionSidebarContent` function in the current sidebar is dead code and will be removed.

### Portkey Behavior Notes

- Each sidebar section (header, content, footer) is independently gated by `usePortkeyHasElements`. An app can customize just the content section while keeping default header and footer.
- If a `Portkey` producer renders without a matching `PortkeyOut` in the tree (e.g., `AppSidebar` is unmounted), the content silently goes nowhere. This is expected tunnel behavior.

### App-Side Usage

Apps compose their sidebar by importing atomic components and wrappers:

```tsx
import {
  AppSidebarHeader,
  AppSidebarContent,
  AppSidebarFooter,
  SidebarOrgSwitcher,
  SidebarAppLogo,
  SidebarHome,
  SidebarSearch,
  SidebarExtensions,
  SidebarNotifications,
  SidebarSupport,
  SidebarUser,
} from "@rio.js/enterprise.core/sidebar";

// In the app's layout or sidebar setup:
<AppSidebarHeader>
  <SidebarOrgSwitcher />
  <SidebarAppLogo />
</AppSidebarHeader>

<AppSidebarContent>
  <SidebarHome />
  <SidebarSearch />
  <Separator />
  <SidebarExtensions />
</AppSidebarContent>

<AppSidebarFooter>
  <SidebarNotifications />
  <SidebarSupport />
  <SidebarUser />
</AppSidebarFooter>
```
