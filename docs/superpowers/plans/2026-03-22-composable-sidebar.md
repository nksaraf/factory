# Composable Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the monolithic enterprise.core sidebar into composable, named components that apps assemble via wrapper components with internal Portkey registration.

**Architecture:** Atomic sidebar components (SidebarOrgSwitcher, SidebarAppLogo, etc.) each handle their own SidebarMenuItem wrapping. Wrapper components (AppSidebarHeader/Content/Footer) handle Portkey registration + styling containers using useApp() for app ID. The existing AppSidebar renderer stays unchanged — it uses PortkeyOut with fallback defaults that now compose from the new atomics.

**Tech Stack:** React, @rio.js/tunnel (Portkey/PortkeyOut), @rio.js/ui (shadcn-based sidebar), @rio.js/enterprise-ui, @rio.js/app-ui, @rio.js/client, react-router

**Spec:** `docs/superpowers/specs/2026-03-22-composable-sidebar-design.md`

---

## File Map

All paths relative to `packages/npm/enterprise.core/src/`.

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `sidebar/sidebar-org-switcher.tsx` | OrganizationSwitcher with sidebar state for popover side |
| Create | `sidebar/sidebar-app-logo.tsx` | App logo + name in SidebarMenuItem |
| Create | `sidebar/sidebar-home.tsx` | Home button in SidebarMenuItem |
| Create | `sidebar/sidebar-search.tsx` | Search button in SidebarMenuItem |
| Create | `sidebar/sidebar-extensions.tsx` | Dynamic manifest-contributed groups |
| Create | `sidebar/sidebar-notifications.tsx` | Notifications button in SidebarMenuItem |
| Create | `sidebar/sidebar-support.tsx` | Support button in SidebarMenuItem (renamed from Help) |
| Create | `sidebar/sidebar-user.tsx` | UserButton wrapped in Suspense |
| Create | `sidebar/app-sidebar-header.tsx` | Portkey wrapper for header section |
| Create | `sidebar/app-sidebar-content.tsx` | Portkey wrapper for content section |
| Create | `sidebar/app-sidebar-footer.tsx` | Portkey wrapper for footer section |
| Create | `sidebar/index.ts` | Re-exports all components |
| Modify | `routes/(app)/(dashboard)/sidebar.tsx` | Rewrite defaults to compose from atomics |

---

### Task 1: Create atomic sidebar components

**Files:**
- Create: `sidebar/sidebar-org-switcher.tsx`
- Create: `sidebar/sidebar-app-logo.tsx`
- Create: `sidebar/sidebar-home.tsx`
- Create: `sidebar/sidebar-search.tsx`
- Create: `sidebar/sidebar-extensions.tsx`
- Create: `sidebar/sidebar-notifications.tsx`
- Create: `sidebar/sidebar-support.tsx`
- Create: `sidebar/sidebar-user.tsx`

- [ ] **Step 1: Create `sidebar/sidebar-org-switcher.tsx`**

```tsx
import { OrganizationSwitcher } from "@rio.js/enterprise-ui/components/organization/organization-switcher";
import { useSidebar } from "@rio.js/ui/components/sidebar";
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile";

export function SidebarOrgSwitcher() {
  const { open } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <OrganizationSwitcher
      classNames={{}}
      side={isMobile ? "bottom" : open ? "bottom" : "right"}
    />
  );
}
```

- [ ] **Step 2: Create `sidebar/sidebar-app-logo.tsx`**

```tsx
import { useApp } from "@rio.js/app-ui/hooks/use-app";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar";

export function SidebarAppLogo() {
  const app = useApp();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground h-10 group-data-[collapsible=icon]:!p-0">
        <div className="flex w-full items-center gap-2.5 border-t border-scale-500 pt-1.5">
          <div className="flex aspect-square items-center justify-center rounded-lg pl-1.5 relative left-0">
            <img
              src={app.logo}
              className="w-6 [view-transition-name:app-logo]"
            />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium text-md relative text-black dark:text-white">
              <span className="font-heading">
                {app.name.includes("Smart") ? (
                  <span className="font-sans">Smart</span>
                ) : null}
                {app.name.replace(/^Smart/, "")}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 3: Create `sidebar/sidebar-home.tsx`**

```tsx
import { useLocation } from "react-router";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar";
import { Icon } from "@rio.js/ui/icon";

export function SidebarHome() {
  const location = useLocation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Home"
        isActive={location.pathname === "/"}
      >
        <div className="relative inline-block">
          <Icon icon="icon-[ph--house-duotone]" className="text-icon-lg" />
        </div>
        <span className="text-base flex-grow">Home</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 4: Create `sidebar/sidebar-search.tsx`**

```tsx
import { useLocation } from "react-router";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar";
import { Icon } from "@rio.js/ui/icon";

export function SidebarSearch() {
  const location = useLocation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Search"
        isActive={location.pathname.startsWith("/search")}
      >
        <div className="relative inline-block">
          <Icon icon="icon-[ph--magnifying-glass-duotone]" className="text-icon-lg" />
        </div>
        <span className="text-base flex-grow">Search</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 5: Create `sidebar/sidebar-extensions.tsx`**

```tsx
import * as React from "react";
import { useLocation } from "react-router";
import { AppSidebarGroup } from "@rio.js/app-ui/components/app-sidebar";
import { useObserver, useRio } from "@rio.js/client";
import { useCurrentOrganization } from "@rio.js/enterprise-ui/hooks/use-current-organization";
import { Separator } from "@rio.js/ui/separator";

export function SidebarExtensions() {
  using _ = useObserver();
  const rio = useRio();
  const location = useLocation();
  const { data: activeOrganization } = useCurrentOrganization();
  const sidebarGroups = rio.extensions.getContributions("sidebarGroups");
  const sidebarItems = rio.extensions.getContributions("sidebarItems");

  const groups: Record<string, any> = {};
  sidebarGroups.forEach((sidebarGroup: any) => {
    if (!groups[sidebarGroup.id]) {
      groups[sidebarGroup.id] = {
        ...sidebarGroup,
        sidebarItems: [],
      };
    }
  });

  sidebarItems.forEach((sidebarItem: any) => {
    if (!groups[sidebarItem.group]) {
      return;
    }
    groups[sidebarItem.group].sidebarItems.push(sidebarItem);
  });

  if (!activeOrganization) return null;

  return (
    <>
      {Object.entries(groups).map(
        ([groupName, group]: [string, any], index) => (
          <React.Fragment key={groupName}>
            <AppSidebarGroup
              items={group.sidebarItems.map((sidebarItem: any) => ({
                title: sidebarItem.displayName,
                icon: sidebarItem.icon,
                url: sidebarItem.href,
                isActive: location.pathname.startsWith(sidebarItem.href),
              }))}
              label={group.displayName}
            />
            {index < Object.entries(groups).length - 1 && <Separator />}
          </React.Fragment>
        ),
      )}
      <Separator />
    </>
  );
}
```

- [ ] **Step 6: Create `sidebar/sidebar-notifications.tsx`**

```tsx
import { useLocation } from "react-router";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar";
import { Icon, Icons } from "@rio.js/ui/icon";

export function SidebarNotifications() {
  const location = useLocation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Notifications"
        isActive={location.pathname === "/notifications"}
      >
        <div className="relative inline-block">
          <Icon icon={Icons.notification} className="text-icon-lg" />
        </div>
        <span className="text-base flex-grow">Notifications</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 7: Create `sidebar/sidebar-support.tsx`**

```tsx
import { useLocation } from "react-router";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar";
import { Icon } from "@rio.js/ui/icon";

export function SidebarSupport() {
  const location = useLocation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Support"
        isActive={location.pathname === "/support"}
      >
        <div className="relative inline-block">
          <Icon icon="icon-[ph--lifebuoy-duotone]" className="text-icon-lg" />
        </div>
        <span className="text-base flex-grow">Support</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 8: Create `sidebar/sidebar-user.tsx`**

```tsx
import { Suspense } from "react";
import { UserButton } from "@rio.js/enterprise-ui/components/user-button";
import { useSidebar } from "@rio.js/ui/components/sidebar";
import { useIsMobile } from "@rio.js/ui/hooks/use-is-mobile";

export function SidebarUser() {
  const { open } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <Suspense>
      <UserButton
        side={isMobile ? "top" : open ? "bottom" : "right"}
        classNames={{
          trigger: {
            user: {
              avatar: {
                base: "size-7 mr-2 group-data-[collapsible=icon]:size-5",
              },
            },
          },
        }}
      />
    </Suspense>
  );
}
```

- [ ] **Step 9: Commit atomic components**

```bash
git add packages/npm/enterprise.core/src/sidebar/sidebar-*.tsx
git commit -m "feat(enterprise.core): extract atomic sidebar components"
```

---

### Task 2: Create wrapper components

**Files:**
- Create: `sidebar/app-sidebar-header.tsx`
- Create: `sidebar/app-sidebar-content.tsx`
- Create: `sidebar/app-sidebar-footer.tsx`

- [ ] **Step 1: Create `sidebar/app-sidebar-header.tsx`**

```tsx
import { useApp } from "@rio.js/app-ui/hooks/use-app";
import { Portkey } from "@rio.js/tunnel";
import {
  SidebarHeader,
  SidebarMenu,
} from "@rio.js/ui/components/sidebar";

export function AppSidebarHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const app = useApp();

  return (
    <Portkey id={`${app.id}/sidebar/header`}>
      <SidebarHeader
        className={
          className ??
          "bg-scale-300 border-b border-scale-500 pt-2 pb-1.5 gap-1 px-1 group-data-[collapsible=icon]:!px-2.5"
        }
      >
        <SidebarMenu>{children}</SidebarMenu>
      </SidebarHeader>
    </Portkey>
  );
}
```

- [ ] **Step 2: Create `sidebar/app-sidebar-content.tsx`**

```tsx
import { useApp } from "@rio.js/app-ui/hooks/use-app";
import { Portkey } from "@rio.js/tunnel";
import { SidebarContent } from "@rio.js/ui/components/sidebar";

export function AppSidebarContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const app = useApp();

  return (
    <Portkey id={`${app.id}/sidebar/content`}>
      <SidebarContent className={className ?? "bg-scale-200"}>
        {children}
      </SidebarContent>
    </Portkey>
  );
}
```

- [ ] **Step 3: Create `sidebar/app-sidebar-footer.tsx`**

```tsx
import { useApp } from "@rio.js/app-ui/hooks/use-app";
import { Portkey } from "@rio.js/tunnel";
import {
  SidebarFooter,
  SidebarMenu,
} from "@rio.js/ui/components/sidebar";

export function AppSidebarFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const app = useApp();

  return (
    <Portkey id={`${app.id}/sidebar/footer`}>
      <SidebarFooter
        className={
          className ??
          "bg-scale-300 border-t border-scale-500 pb-2 pt-1"
        }
      >
        <SidebarMenu>{children}</SidebarMenu>
      </SidebarFooter>
    </Portkey>
  );
}
```

- [ ] **Step 4: Commit wrapper components**

```bash
git add packages/npm/enterprise.core/src/sidebar/app-sidebar-*.tsx
git commit -m "feat(enterprise.core): add AppSidebarHeader/Content/Footer wrapper components"
```

---

### Task 3: Create barrel export and update sidebar.tsx

**Files:**
- Create: `sidebar/index.ts`
- Modify: `routes/(app)/(dashboard)/sidebar.tsx`

- [ ] **Step 1: Create `sidebar/index.ts`**

```ts
export { AppSidebarHeader } from "./app-sidebar-header";
export { AppSidebarContent } from "./app-sidebar-content";
export { AppSidebarFooter } from "./app-sidebar-footer";
export { SidebarOrgSwitcher } from "./sidebar-org-switcher";
export { SidebarAppLogo } from "./sidebar-app-logo";
export { SidebarHome } from "./sidebar-home";
export { SidebarSearch } from "./sidebar-search";
export { SidebarExtensions } from "./sidebar-extensions";
export { SidebarNotifications } from "./sidebar-notifications";
export { SidebarSupport } from "./sidebar-support";
export { SidebarUser } from "./sidebar-user";
```

- [ ] **Step 2: Rewrite `routes/(app)/(dashboard)/sidebar.tsx` to compose from atomics**

Replace the entire file with:

```tsx
import { Suspense } from "react";

import { useApp } from "@rio.js/app-ui/hooks/use-app";
import { PortkeyOut, usePortkeyHasElements } from "@rio.js/tunnel";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@rio.js/ui/components/sidebar";

import { SidebarAppLogo } from "../../../sidebar/sidebar-app-logo";
import { SidebarExtensions } from "../../../sidebar/sidebar-extensions";
import { SidebarNotifications } from "../../../sidebar/sidebar-notifications";
import { SidebarOrgSwitcher } from "../../../sidebar/sidebar-org-switcher";
import { SidebarSupport } from "../../../sidebar/sidebar-support";
import { SidebarUser } from "../../../sidebar/sidebar-user";

function DefaultSidebarHeader() {
  return (
    <SidebarHeader className="bg-scale-300 border-b border-scale-500 pt-2 pb-1.5 gap-1 px-1 group-data-[collapsible=icon]:!px-2.5">
      <SidebarMenu>
        <SidebarOrgSwitcher />
        <SidebarAppLogo />
      </SidebarMenu>
    </SidebarHeader>
  );
}

function DefaultSidebarContent() {
  return (
    <SidebarContent className="bg-scale-200">
      <SidebarExtensions />
    </SidebarContent>
  );
}

function DefaultSidebarFooter() {
  return (
    <SidebarFooter className="bg-scale-300 border-t border-scale-500 pb-2 pt-1">
      <SidebarMenu>
        <SidebarNotifications />
        <SidebarSupport />
      </SidebarMenu>
      <SidebarUser />
    </SidebarFooter>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const app = useApp();
  const hasCustomHeader = usePortkeyHasElements(`${app.id}/sidebar/header`);
  const hasCustomContent = usePortkeyHasElements(`${app.id}/sidebar/content`);
  const hasCustomFooter = usePortkeyHasElements(`${app.id}/sidebar/footer`);

  return (
    <>
      {hasCustomHeader ? (
        <PortkeyOut id={`${app.id}/sidebar/header`} />
      ) : (
        <DefaultSidebarHeader />
      )}
      {hasCustomContent ? (
        <PortkeyOut id={`${app.id}/sidebar/content`} />
      ) : (
        <DefaultSidebarContent />
      )}
      {hasCustomFooter ? (
        <PortkeyOut id={`${app.id}/sidebar/footer`} />
      ) : (
        <DefaultSidebarFooter />
      )}
      <SidebarRail />
    </>
  );
}

export function DashboardSidebar() {
  return (
    <Suspense>
      <AppSidebar />
    </Suspense>
  );
}
```

- [ ] **Step 3: Commit barrel export and sidebar rewrite**

```bash
git add packages/npm/enterprise.core/src/sidebar/index.ts packages/npm/enterprise.core/src/routes/\(app\)/\(dashboard\)/sidebar.tsx
git commit -m "feat(enterprise.core): wire up composable sidebar with barrel export and rewritten defaults"
```
