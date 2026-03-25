import { Navigate } from "react-router"
import { useWorkspaces } from "~/src/modules/smart-market.workspaces/data/use-workspaces"

export default function ScoutsRedirectPage() {
  console.log("ScoutsRedirectPage")
  const { data: workspaces } = useWorkspaces()
  const lastWsId = localStorage.getItem("workspace:lastId")

  if (lastWsId) {
    return <Navigate to={`/scouts/${lastWsId}/`} replace />
  }

  if (workspaces?.length) {
    return <Navigate to={`/scouts/${workspaces[0].id}/`} replace />
  }

  return null
}
