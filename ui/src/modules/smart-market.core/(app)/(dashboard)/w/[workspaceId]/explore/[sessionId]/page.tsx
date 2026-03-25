import { useNavigate, useParams } from "react-router"

import { ExploreSessionPage } from "./explore-session-page"

export default function SessionPage() {
  const { sessionId, workspaceId } = useParams<{
    sessionId: string
    workspaceId: string
  }>()
  const navigate = useNavigate()

  if (!sessionId || !workspaceId) return null

  return (
    <ExploreSessionPage
      sessionId={sessionId}
      workspaceId={workspaceId}
      onBack={() => navigate(`/w/${workspaceId}/explore/`)}
    />
  )
}
