import { useNavigate } from "react-router"
import { AgentSessionsPanel } from "~/src/modules/smart-market.workspaces/components/agent-sessions-panel"

import { Panel } from "@rio.js/app-ui/components/workspace/panel"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"

import { ExploreSessionView } from "../explore-session-view"

export function ExploreSessionPage({
  sessionId,
  workspaceId,
  onBack,
}: {
  sessionId: string
  workspaceId: string
  onBack: () => void
}) {
  const navigate = useNavigate()

  return (
    <WorkspaceLayout id="explore">
      <Panel group="left-sidebar" id="tree" order={0} defaultSize={100}>
        <AgentSessionsPanel
          workspaceId={workspaceId}
          activeSessionId={sessionId}
          onSessionSelect={(id) => navigate(`/w/${workspaceId}/explore/${id}`)}
        />
      </Panel>

      <Panel group="main" id="session-chat" order={0} defaultSize={100}>
        <ExploreSessionView sessionId={sessionId} onBack={onBack} />
      </Panel>
    </WorkspaceLayout>
  )
}
