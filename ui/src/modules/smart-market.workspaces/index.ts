import { lazy } from "react"

import { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    // Route refs
    "smart-market.workspaces.route.list.page": {
      Component: lazy(() => import("./(app)/(dashboard)/w/page")),
    },
    "smart-market.workspaces.route.workspace.layout": {
      Component: lazy(
        () => import("./(app)/(dashboard)/w/[workspaceId]/layout")
      ),
    },
    "smart-market.workspaces.route.workspace.page": {
      Component: lazy(() => import("./(app)/(dashboard)/w/[workspaceId]/page")),
    },
    "smart-market.workspaces.route.files.layout": {
      Component: lazy(
        () => import("./(app)/(dashboard)/w/[workspaceId]/files/layout")
      ),
    },
    "smart-market.workspaces.route.files.page": {
      Component: lazy(
        () => import("./(app)/(dashboard)/w/[workspaceId]/files/page")
      ),
    },
    "smart-market.workspaces.route.files.resource.page": {
      Component: lazy(
        () =>
          import("./(app)/(dashboard)/w/[workspaceId]/files/[resourceId]/page")
      ),
    },
    // View refs — resource type views registered for ExtensionView resolution
    "smart-market.workspaces.views.folder": lazy(
      () => import("./components/resource-views/folder-view")
    ),
    "smart-market.workspaces.views.dataset": lazy(
      () =>
        import("./components/resource-views/dataset-view/dataset-detail-view")
    ),
    "smart-market.workspaces.views.map": lazy(
      () => import("./components/resource-views/map-view")
    ),
    "smart-market.workspaces.views.dashboard": lazy(
      () => import("./components/resource-views/dashboard-view")
    ),
    "smart-market.workspaces.views.pipeline": lazy(
      () => import("./components/resource-views/pipeline-view")
    ),
    "smart-market.workspaces.views.ontology": lazy(
      () => import("./components/resource-views/ontology-view")
    ),
    "smart-market.workspaces.views.process": lazy(
      () => import("./components/resource-views/process-view")
    ),
    "smart-market.workspaces.views.report": lazy(
      () => import("./components/resource-views/report-view")
    ),
    "smart-market.workspaces.views.agent_session": lazy(
      () =>
        import("./components/resource-views/agent-session-view/agent-session-detail-view")
    ),
  },
} satisfies ExtensionManifest
