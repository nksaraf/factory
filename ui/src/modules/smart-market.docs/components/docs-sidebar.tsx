import { Link, useLocation } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"

interface DocEntry {
  title: string
  slug: string
  icon?: string
}

interface DocSection {
  title: string
  items: DocEntry[]
}

const sections: DocSection[] = [
  {
    title: "Components",
    items: [
      {
        title: "Buttons",
        slug: "components/ui/buttons",
        icon: "icon-[ph--cursor-click-duotone]",
      },
      {
        title: "Inputs",
        slug: "components/ui/inputs",
        icon: "icon-[ph--textbox-duotone]",
      },
      {
        title: "Data Display",
        slug: "components/ui/data-display",
        icon: "icon-[ph--table-duotone]",
      },
      {
        title: "Layout",
        slug: "components/ui/layout",
        icon: "icon-[ph--layout-duotone]",
      },
      {
        title: "Navigation",
        slug: "components/ui/navigation",
        icon: "icon-[ph--compass-duotone]",
      },
      {
        title: "Dialogs",
        slug: "components/ui/dialogs",
        icon: "icon-[ph--chat-centered-text-duotone]",
      },
      {
        title: "Feedback",
        slug: "components/ui/feedback",
        icon: "icon-[ph--bell-ringing-duotone]",
      },
    ],
  },
]

export function DocsSidebar() {
  const location = useLocation()

  return (
    <nav className="flex flex-col gap-1 p-4">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3 px-3 py-1">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary-800 text-white shadow-sm">
          <span className="icon-[ph--cube-duotone] text-lg" />
        </div>
        <div>
          <div className="text-base font-bold text-foreground">Rio UI</div>
          <div className="text-sm font-medium text-scale-800">
            Component Library
          </div>
        </div>
      </div>

      {/* Overview link */}
      <Link
        to="/docs"
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-base transition-colors",
          location.pathname === "/docs"
            ? "bg-primary-800/15 text-primary-900 font-semibold"
            : "text-scale-900 hover:text-foreground hover:bg-accent/60"
        )}
      >
        <span className="icon-[ph--house-duotone] text-base text-scale-700" />
        Overview
      </Link>

      {/* Sections */}
      {sections.map((section) => (
        <div key={section.title} className="mt-5">
          <h4 className="mb-2 px-3 text-xs font-bold uppercase tracking-widest text-scale-800">
            {section.title}
          </h4>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const href = `/docs/${item.slug}`
              const isActive =
                location.pathname === href || location.pathname === href + "/"
              return (
                <Link
                  key={item.slug}
                  to={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-base transition-colors",
                    isActive
                      ? "bg-primary-800/15 text-primary-900 font-semibold"
                      : "text-scale-900 hover:text-foreground hover:bg-accent/60"
                  )}
                >
                  {item.icon && (
                    <span
                      className={cn(
                        item.icon,
                        "text-base",
                        isActive ? "text-primary-800" : "text-scale-700"
                      )}
                    />
                  )}
                  {item.title}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
