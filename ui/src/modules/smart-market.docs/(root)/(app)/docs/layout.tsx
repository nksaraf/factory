import { DocsSidebar } from "../../../components/docs-sidebar"

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full">
      <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-border/60 bg-scale-50/50 dark:bg-scale-50/5">
        <DocsSidebar />
      </aside>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-3xl px-10 py-10">{children}</div>
      </main>
    </div>
  )
}
