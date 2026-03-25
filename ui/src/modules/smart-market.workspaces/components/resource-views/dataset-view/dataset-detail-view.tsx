import { useState } from "react"

import { Panel } from "@rio.js/app-ui/components/workspace/panel"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"
import { WorkspaceMenubar } from "@rio.js/app-ui/components/workspace/workspace-menubar"
import {
  WorkspaceTabs,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@rio.js/app-ui/components/workspace/workspace-tabs"
import { WorkspaceTitle } from "@rio.js/app-ui/components/workspace/workspace-title"
import { Icons } from "@rio.js/ui/icon"

import type { ResourceDetail } from "../../../types"
import { DatasetMapTab } from "./dataset-map-tab"
import { DatasetOverviewTab } from "./dataset-overview-tab"
import { DatasetTableTab } from "./dataset-table-tab"
import { DatasetVersionsTab } from "./dataset-versions-tab"

function DatasetTabContent({
  tab,
  resource,
}: {
  tab: string
  resource: ResourceDetail
}) {
  switch (tab) {
    case "overview":
      return <DatasetOverviewTab resource={resource} />
    case "table":
      return <DatasetTableTab resource={resource} />
    case "map":
      return <DatasetMapTab resource={resource} />
    case "versions":
      return <DatasetVersionsTab resource={resource} />
    default:
      return <DatasetOverviewTab resource={resource} />
  }
}

export default function DatasetDetailView({
  resource,
}: {
  resource: ResourceDetail
}) {
  const [activeTab, setActiveTab] = useState("overview")

  return (
    <WorkspaceLayout id={`dataset-${resource.id}`}>
      <WorkspaceMenubar />
      <WorkspaceTitle
        title={resource.name ?? "Dataset"}
        icon="icon-[ph--database-duotone]"
      >
        <span className="text-sm font-medium">
          {resource.name ?? "Dataset"}
        </span>
      </WorkspaceTitle>
      <WorkspaceTabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="border-b border-scale-500"
      >
        <WorkspaceTabsList>
          <WorkspaceTabsTrigger value="overview" icon={Icons.home}>
            Overview
          </WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="table" icon={Icons.table}>
            Table
          </WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="map" icon={Icons.map}>
            Map
          </WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="versions" icon={Icons.transform}>
            Versions
          </WorkspaceTabsTrigger>
        </WorkspaceTabsList>
      </WorkspaceTabs>
      <Panel group="main" id="dataset-content" order={0} defaultSize={100}>
        <DatasetTabContent tab={activeTab} resource={resource} />
      </Panel>
    </WorkspaceLayout>
  )
}
