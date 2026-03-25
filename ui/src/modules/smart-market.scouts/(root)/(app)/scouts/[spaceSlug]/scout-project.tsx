import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { AgentSessionsPanel } from "~/src/modules/smart-market.workspaces/components/agent-sessions-panel"

import { PromptInputMessage } from "@rio.js/agents-ui/components/ai-elements/prompt-input"
import {
  AppTabs,
  AppTabsList,
  AppTabsTrigger,
} from "@rio.js/app-ui/components/app-tabs"
import { ExtensionView } from "@rio.js/app-ui/components/extension-view"
import { Panel } from "@rio.js/app-ui/components/workspace/panel"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"
import { Portkey } from "@rio.js/tunnel"
import { Icons } from "@rio.js/ui/icon"

import ScoutPromptInput from "./scout-prompt-input"

export function ScoutProject({ spaceSlug }: { spaceSlug: string | null }) {
  const [message, setMessage] = useState<PromptInputMessage | null>(null)
  const navigate = useNavigate()
  const { spaceSlug: slug } = useParams<{ spaceSlug: string }>()

  const handleSubmit = (message: PromptInputMessage) => {
    console.log(message, { spaceSlug })
    setMessage(message)
  }

  return (
    <WorkspaceLayout id="scouts">
      {/* Left sidebar — AI sessions list */}
      <Panel group="left-sidebar" id="tree" order={0} defaultSize={100}>
        <AgentSessionsPanel
          workspaceId={spaceSlug}
          onSessionSelect={(sessionId) =>
            navigate(`/scouts/${slug}/${sessionId}`)
          }
        />
      </Panel>

      {/* Main content — map */}
      {/* <ExtensionView
        container="main"
        src="gis.core.views.map"
        props={{
          mapId: "main",
          className: "with-toolbar",
          contextMenuItems: <></>,
          renderers: {},
          floatingLayoutClassName: "p-0",
        }}
      /> */}
      {!message && (
        <Panel
          id="ai2"
          group="main"
          order={0}
          defaultSize={100}
          minSize={30}
          maxSize={100}
          resizable={false}
          className="w-auto overflow-visible flex flex-row items-center justify-center z-10 [&_[data-panel-group-id='scouts/floating-panels']]:bg-scale-500/75"
        >
          <ScoutPromptInput onSubmit={handleSubmit} />
        </Panel>
      )}
      {message && (
        <>
          <ExtensionView container="right-sidebar" src="rio.ai.views.thread" />
          <Portkey id="smart-market/topbar/tabs">
            <AppTabs value="map" className="h-full">
              <AppTabsList>
                <AppTabsTrigger value="map" icon={Icons.map}>
                  Map
                </AppTabsTrigger>
                <AppTabsTrigger value="workflow" icon={Icons.workflow}>
                  Workflow
                </AppTabsTrigger>
              </AppTabsList>
            </AppTabs>
          </Portkey>
        </>
      )}
    </WorkspaceLayout>
  )
}
