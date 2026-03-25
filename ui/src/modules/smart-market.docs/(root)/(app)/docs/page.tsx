import { Link } from "react-router"

const categories = [
  {
    title: "Buttons",
    description: "Primary actions, variants, sizes, and icon buttons",
    slug: "components/ui/buttons",
    icon: "icon-[ph--cursor-click-duotone]",
    count: 9,
  },
  {
    title: "Inputs",
    description: "Text fields, selects, checkboxes, switches, and sliders",
    slug: "components/ui/inputs",
    icon: "icon-[ph--textbox-duotone]",
    count: 8,
  },
  {
    title: "Data Display",
    description: "Tables, badges, avatars, skeletons, and progress indicators",
    slug: "components/ui/data-display",
    icon: "icon-[ph--table-duotone]",
    count: 6,
  },
  {
    title: "Layout",
    description: "Cards, separators, accordions, and scroll areas",
    slug: "components/ui/layout",
    icon: "icon-[ph--layout-duotone]",
    count: 5,
  },
  {
    title: "Navigation",
    description: "Tabs, breadcrumbs, commands, and dropdown menus",
    slug: "components/ui/navigation",
    icon: "icon-[ph--compass-duotone]",
    count: 7,
  },
  {
    title: "Dialogs",
    description: "Modals, alert dialogs, sheets, and drawers",
    slug: "components/ui/dialogs",
    icon: "icon-[ph--chat-centered-text-duotone]",
    count: 4,
  },
  {
    title: "Feedback",
    description: "Alerts, toasts, tooltips, and popovers",
    slug: "components/ui/feedback",
    icon: "icon-[ph--bell-ringing-duotone]",
    count: 4,
  },
]

export default function DocsIndexPage() {
  return (
    <div>
      {/* Hero */}
      <div className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-primary-800/20 bg-primary-800/10 px-2.5 py-0.5 text-xs font-medium text-primary-800">
            v0.0.1
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Rio UI
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          A comprehensive component library built on Radix primitives and
          Tailwind CSS. Designed for the Smart Market Platform with full dark
          mode, accessibility, and design token support.
        </p>
      </div>

      {/* Quick info */}
      <div className="mb-10 grid grid-cols-3 gap-4">
        {[
          {
            label: "Components",
            value: "40+",
            icon: "icon-[ph--cube-duotone]",
          },
          {
            label: "Design Tokens",
            value: "200+",
            icon: "icon-[ph--palette-duotone]",
          },
          {
            label: "Accessibility",
            value: "WCAG 2.1",
            icon: "icon-[ph--eye-duotone]",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border/60 bg-scale-50/50 p-4 dark:bg-scale-50/5"
          >
            <span
              className={`${stat.icon} mb-2 block text-xl text-primary-800/70`}
            />
            <div className="text-lg font-semibold text-foreground">
              {stat.value}
            </div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Component grid */}
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
        Components
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            to={`/docs/${cat.slug}`}
            className="group flex items-start gap-3.5 rounded-xl border border-border/60 bg-background p-4 transition-all hover:border-primary-800/30 hover:bg-primary-800/[0.03] hover:shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-scale-100 text-xl text-muted-foreground transition-colors group-hover:bg-primary-800/10 group-hover:text-primary-800 dark:bg-scale-800">
              <span className={cat.icon} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  {cat.title}
                </h3>
                <span className="rounded-full bg-scale-100 px-1.5 py-0.5 text-xs font-semibold text-muted-foreground dark:bg-scale-800">
                  {cat.count}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {cat.description}
              </p>
            </div>
            <span className="icon-[ph--caret-right-bold] mt-0.5 text-sm text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-800/50" />
          </Link>
        ))}
      </div>
    </div>
  )
}
