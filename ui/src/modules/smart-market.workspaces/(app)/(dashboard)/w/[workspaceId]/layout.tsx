import { useEffect } from "react"
import { useParams } from "react-router"

import { WorkspaceProvider } from "../../../../components/workspace-context"

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
    <WorkspaceProvider workspaceId={workspaceId}>{children}</WorkspaceProvider>
  )
}
