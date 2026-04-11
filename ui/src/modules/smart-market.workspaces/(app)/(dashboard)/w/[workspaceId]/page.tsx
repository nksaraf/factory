import { ScrollArea } from "@rio.js/ui/scroll-area"

import { ActivityFeed } from "../../../../components/home/activity-feed"
import { QuickAccessModules } from "../../../../components/home/quick-access-modules"
import { RecentResources } from "../../../../components/home/recent-resources"
import { WorkspaceChatInput } from "../../../../components/home/workspace-chat-input"
import { WorkspaceEmptyState } from "../../../../components/home/workspace-empty-state"
import { WorkspaceHomeHeader } from "../../../../components/home/workspace-home-header"
import { useWorkbench } from "../../../../components/workbench-context"

export default function WorkspaceHomePage() {
  const { resources } = useWorkbench()
  const hasResources = resources.some(
    (r) => r.resourceType !== "folder" && !r.deletedAt
  )

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
        <WorkspaceHomeHeader />
        <WorkspaceChatInput />
        {hasResources ? (
          <>
            <RecentResources />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <ActivityFeed />
              </div>
              <div className="lg:col-span-2">
                <QuickAccessModules />
              </div>
            </div>
          </>
        ) : (
          <WorkspaceEmptyState />
        )}
      </div>
    </ScrollArea>
  )
}
