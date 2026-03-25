import { Folder } from "lucide-react"

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Folder className="h-12 w-12 opacity-20" />
      <p className="text-sm">Select a resource from the sidebar to view it</p>
    </div>
  )
}
