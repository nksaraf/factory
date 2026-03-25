import { useNavigate } from "react-router"
import { AgentSessionsPanel } from "~/src/modules/smart-market.workspaces/components/agent-sessions-panel"

import { Panel } from "@rio.js/app-ui/components/workspace/panel"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"

import { ScoutSessionView } from "../scout-session-view"

export function ScoutSessionPage({
  sessionId,
  spaceSlug,
  onBack,
}: {
  sessionId: string
  spaceSlug: string
  onBack: () => void
}) {
  const navigate = useNavigate()

  return (
    <WorkspaceLayout id="scouts">
      <Panel group="left-sidebar" id="tree" order={0} defaultSize={100}>
        <AgentSessionsPanel
          workspaceId={spaceSlug}
          activeSessionId={sessionId}
          onSessionSelect={(id) => navigate(`/scouts/${spaceSlug}/${id}`)}
        />
      </Panel>

      <Panel group="main" id="session-chat" order={0} defaultSize={100}>
        <ScoutSessionView sessionId={sessionId} onBack={onBack} />
      </Panel>
    </WorkspaceLayout>
  )
}
