import { useNavigate, useParams } from "react-router"

import { ScoutSessionPage } from "./scout-session-page"

export default function SessionPage() {
  const { sessionId, spaceSlug } = useParams<{
    sessionId: string
    spaceSlug: string
  }>()
  const navigate = useNavigate()

  if (!sessionId || !spaceSlug) return null

  return (
    <ScoutSessionPage
      sessionId={sessionId}
      spaceSlug={spaceSlug}
      onBack={() => navigate(`/scouts/${spaceSlug}/`)}
    />
  )
}
