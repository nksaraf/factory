import { useEffect } from "react"
import { useParams } from "react-router"

import { WorkbenchProvider } from "../../../../components/workbench-context"

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  useEffect(() => {
    if (workspaceId) {
      localStorage.setItem("workspace:lastId", workspaceId)
    }
  }, [workspaceId])

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No workspace selected
      </div>
    )
  }

  return (
    <WorkbenchProvider workspaceId={workspaceId}>{children}</WorkbenchProvider>
  )
}
