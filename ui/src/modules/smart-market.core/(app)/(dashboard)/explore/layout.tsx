import { Navigate } from "react-router"
import { useWorkspaces } from "~/src/modules/smart-market.workspaces/data/use-workspaces"

export default function ExploreRedirectLayout() {
  const { data: workspaces } = useWorkspaces()
  const lastWsId = localStorage.getItem("workspace:lastId")

  if (lastWsId) {
    return <Navigate to={`/w/${lastWsId}/explore/`} replace />
  }

  if (workspaces?.length) {
    return <Navigate to={`/w/${workspaces[0].id}/explore/`} replace />
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  )
}
