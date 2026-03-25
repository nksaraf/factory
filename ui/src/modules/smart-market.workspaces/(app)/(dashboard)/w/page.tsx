import { Navigate } from "react-router"

import { useWorkspaces } from "../../../data/use-workspaces"

export default function WorkspacesRedirectPage() {
  const { data: workspaces } = useWorkspaces()
  const lastWsId = localStorage.getItem("workspace:lastId")

  if (lastWsId) {
    return <Navigate to={`/w/${lastWsId}/`} replace />
  }

  if (workspaces?.length) {
    return <Navigate to={`/w/${workspaces[0].id}/`} replace />
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading workspaces...
    </div>
  )
}
