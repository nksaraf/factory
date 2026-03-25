// import { useMemo } from "react"
// import { useParams } from "react-router"
// import { AppMenubar } from "@rio.js/app-ui/components/app-menubar"
// import { useRio } from "@rio.js/client"
// import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"
// import { Panel } from "@rio.js/ui/panel/panel"
// import { WorkflowSessionProvider } from "@rio.js/workflows-ui/components/context"
// import { WorkflowCanvas } from "@rio.js/workflows-ui/components/workflow-canvas"
// import { WorkflowToolbar } from "@rio.js/workflows-ui/components/workflow-toolbar"
// import { useWorkflow } from "@rio.js/workflows-ui/data/workflows/queries"
// import { WorkflowSession } from "@rio.js/workflows-ui/lib/workflow-session"
// export default function WorkflowPage() {
//   const { "workflow-id": workflowId } = useParams()
//   const workflow = useWorkflow(workflowId).data
//   const rio = useRio()
//   const session = useMemo(() => {
//     return new WorkflowSession(rio, {
//       id: workflowId,
//       flow: workflow.config,
//       title: workflow.name,
//     })
//   }, [workflowId, workflow])
//   return (
//     <>
//       <WorkflowSessionProvider value={session}>
//         <AppMenubar />
//         <WorkspaceLayout>
//           <Panel group="left-sidebar" id="workflow" order={0} defaultSize={100}>
//             <WorkflowToolbar />
//           </Panel>
//           <Panel group="main-canvas" id="workflow2" order={1} defaultSize={100}>
//             <WorkflowCanvas />
//           </Panel>
//         </WorkspaceLayout>
//       </WorkflowSessionProvider>
//     </>
//   )
// }
import { use, useEffect, useMemo } from "react"
import { useParams } from "react-router"
import { PresenceProvider, generateUserId } from "~/src/components/presence"

import { AppMenubar } from "@rio.js/app-ui/components/app-menubar"
import { Panel } from "@rio.js/app-ui/components/workspace/panel"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"
import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { useObserver, useRio } from "@rio.js/client"
import { useSidebar } from "@rio.js/ui/components/sidebar"
import { WorkflowCanvas } from "@rio.js/workflows-ui/components/workflow-canvas"
import { WorkflowProvider } from "@rio.js/workflows-ui/components/workflow-provider"
import { WorkflowToolbar } from "@rio.js/workflows-ui/components/workflow-toolbar"
import { useWorkflow } from "@rio.js/workflows-ui/data/workflows/queries"
import { WorkflowSession } from "@rio.js/workflows-ui/lib/workflow-session"

import { WorkflowCanvasWithPresence } from "./workflow-canvas-with-presence"

export default function WorkflowPage() {
  using _ = useObserver()
  const { toggleSidebar, open } = useSidebar()
  useEffect(() => {
    if (open) {
      toggleSidebar()
    }
  }, [])
  const { "workflow-id": workflowId } = useParams()
  const workflow = useWorkflow(workflowId).data
  const rio = useRio()
  const nodesRegistry = rio.extensions.getContributions("nodes")

  const {
    hooks: { useSession },
  } = use(AuthUIContext)
  // Generate or use user ID for presence
  const { data } = useSession()
  const userId = data?.user.id

  // const session = useMemo(() => {
  //   return new WorkflowSession(rio, {
  //     id: workflowId,
  //     flow: workflow.config,
  //     title: workflow.name,
  //   })
  // }, [workflowId, workflow])

  return (
    <PresenceProvider workspaceId={workflowId ?? ""} userId={userId}>
      <WorkflowProvider
        nodesRegistry={nodesRegistry}
        flow={workflow.config}
        title={workflow.name}
        id={workflowId}
        klass={WorkflowSession}
        version={workflow.version}
        // onFlowChange={() => {}}
        // config={{}}
        // lastSaved={workflow.updated_at ?? null}
        // lastRun={workflow.last_run ?? null}
      >
        <AppMenubar />
        <WorkspaceLayout floatingPanelSizes={[20, 55, 25]}>
          <Panel group="left-sidebar" id="workflow" order={0} defaultSize={100}>
            <WorkflowToolbar />
          </Panel>
          <Panel group="main" id="workflow" order={1} defaultSize={100}>
            <div className="relative h-full w-full">
              <WorkflowCanvas />
              <WorkflowCanvasWithPresence />
            </div>
          </Panel>
        </WorkspaceLayout>
      </WorkflowProvider>
    </PresenceProvider>
  )
}
