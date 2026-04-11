import { useSyncExternalStore } from "react"
import { Portkey } from "@rio.js/tunnel"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@rio.js/ui/components/sidebar"
import { Icon } from "@rio.js/ui/icon"

import { useApp } from "@rio.js/app-ui/hooks/use-app"

import { rio } from "@/lib/rio"

interface SidebarItem {
  id: string
  displayName: string
  icon: string
  href: string
  group: string
  order: number
}

interface SidebarGroupDef {
  id: string
  displayName: string
  icon: string
  order: number
}

function usePathname() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("popstate", cb)
      return () => window.removeEventListener("popstate", cb)
    },
    () => window.location.pathname
  )
}

export function FactorySidebar() {
  const app = useApp()
  const pathname = usePathname()

  const groups =
    rio.extensions.getContributions<SidebarGroupDef>("sidebarGroups")
  const items = rio.extensions.getContributions<SidebarItem>("sidebarItems")

  const groupedItems = new Map<string, SidebarItem[]>()
  for (const item of items) {
    const list = groupedItems.get(item.group) ?? []
    list.push(item)
    groupedItems.set(item.group, list)
  }

  return (
    <Portkey id={`${app.id}/sidebar`}>
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-2 px-1">
          {app.logo && (
            <img src={app.logo} alt={app.name} className="h-6 w-6" />
          )}
          <span className="text-base font-semibold">{app.name}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const groupItems = groupedItems.get(group.id) ?? []
          if (groupItems.length === 0) return null
          return (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.displayName}</SidebarGroupLabel>
              <SidebarMenu>
                {groupItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.displayName}
                      isActive={pathname.startsWith(item.href)}
                    >
                      <a href={item.href}>
                        <Icon icon={item.icon} className="text-icon-lg" />
                        <span className="text-base">{item.displayName}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </Portkey>
  )
}
