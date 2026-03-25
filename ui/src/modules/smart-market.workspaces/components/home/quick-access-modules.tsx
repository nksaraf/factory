import { Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { useWorkspace } from "../workspace-context"

const MODULES = [
  {
    label: "Projects",
    href: "/my-projects",
    icon: "icon-[ph--map-trifold-duotone]",
    iconClass: "text-blue-500",
    bgClass: "bg-blue-50",
  },
  {
    label: "Datasets",
    href: "/datasets/explorer",
    icon: "icon-[ph--database-duotone]",
    iconClass: "text-violet-500",
    bgClass: "bg-violet-50",
  },
  {
    label: "Reports",
    href: "/my-reports",
    icon: "icon-[ph--file-text-duotone]",
    iconClass: "text-emerald-500",
    bgClass: "bg-emerald-50",
  },
  {
    label: "Pipelines",
    href: "/my-workflows",
    icon: "icon-[ph--git-branch-duotone]",
    iconClass: "text-pink-500",
    bgClass: "bg-pink-50",
  },
] as const

export function QuickAccessModules() {
  const { workspaceId } = useWorkspace()

  const modules = [
    ...MODULES,
    {
      label: "Explore",
      href: `/scouts/${workspaceId}/`,
      icon: "icon-[ph--robot-duotone]",
      iconClass: "text-teal-500",
      bgClass: "bg-teal-50",
    },
  ]

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Jump to
      </h3>
      <div className="flex flex-col gap-0.5">
        {modules.map((mod) => (
          <Link
            key={mod.label}
            to={mod.href}
            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
          >
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${mod.bgClass}`}
            >
              <Icon
                icon={mod.icon}
                className={`h-3.5 w-3.5 ${mod.iconClass}`}
              />
            </div>
            <span>{mod.label}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
