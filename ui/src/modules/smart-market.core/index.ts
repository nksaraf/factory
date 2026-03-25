import { lazy } from "react"

import { ExtensionManifest } from "@rio.js/client"

import { loader as datasetExplorerDatasetIdModePageLoader } from "./(app)/(dashboard)/datasets/explorer/[datasetId]/[mode]/page?pick=loader"
import { loader as datasetExplorerDatasetIdPageLoader } from "./(app)/(dashboard)/datasets/explorer/[datasetId]/page?pick=loader"
import { loader as datasetExplorerLayoutLoader } from "./(app)/(dashboard)/datasets/explorer/layout?pick=loader"
// import { loader as projectLayoutLoader } from "./(app)/(dashboard)/project/[projectId]/layout?pick=loader"
import { loader as workflowLayoutLoader } from "./(app)/(dashboard)/workflow/layout?pick=loader"
import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "smart-market.core.route.my-workflows.page": lazy(
      () => import("./(app)/(dashboard)/my-workflows/page")
    ),
    "smart-market.core.route.my-projects.page": lazy(
      () => import("./(app)/(dashboard)/my-projects/page")
    ),
    "smart-market.core.route.datasets.explorer.layout": {
      Component: lazy(
        () => import("./(app)/(dashboard)/datasets/explorer/layout")
      ),
      loader: datasetExplorerLayoutLoader,
    },
    "smart-market.core.route.datasets.explorer.page": {
      Component: lazy(
        () => import("./(app)/(dashboard)/datasets/explorer/page")
      ),
    },
    "smart-market.core.route.datasets.explorer.dataset.page": {
      Component: lazy(
        () => import("./(app)/(dashboard)/datasets/explorer/[datasetId]/page")
      ),
      loader: datasetExplorerDatasetIdPageLoader,
    },
    "smart-market.core.route.datasets.explorer.dataset-view.layout": lazy(
      () =>
        import("./(app)/(dashboard)/datasets/explorer/[datasetId]/[mode]/layout")
    ),
    "smart-market.core.route.datasets.explorer.dataset-view.page": {
      Component: lazy(
        () =>
          import("./(app)/(dashboard)/datasets/explorer/[datasetId]/[mode]/page")
      ),
      loader: datasetExplorerDatasetIdModePageLoader,
    },
    "smart-market.core.route.workflow.layout": {
      Component: lazy(() => import("./(app)/(dashboard)/workflow/layout")),
      loader: workflowLayoutLoader,
    },
    "smart-market.core.route.workflow.page": lazy(
      () => import("./(app)/(dashboard)/workflow/[workflow-id]/page")
    ),
    // "smart-market.core.route.project.projectId.layout": {
    //   Component: lazy(
    //     () => import("./(app)/(dashboard)/project/[projectId]/layout")
    //   ),
    //   loader: projectLayoutLoader,
    // },
    // "smart-market.core.route.project.projectId.page": {
    //   Component: lazy(
    //     () => import("./(app)/(dashboard)/project/[projectId]/page")
    //   ),
    // },

    // "smart-market.core.route.my-reports.page": lazy(
    //   () => import("./(app)/(dashboard)/my-reports/page"),
    // ),
  },
} satisfies ExtensionManifest
