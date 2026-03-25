import { ExtensionManifest } from "@rio.js/client"
import { env } from "@rio.js/env"

import AlertsLayer from "./alerts-layer"
import manifest from "./manifest.json"
import TrafficLayer from "./traffic-layer"
import RoadsLayer from "./roads-layer"

// Check if analytics feature flag is enabled
const isAnalyticsEnabled = env.PUBLIC_ENABLE_ANALYTICS === "true"

// Check if reports feature flag is enabled
const isReportsEnabled = env.PUBLIC_ENABLE_REPORTS === "true"

// Filter sidebar items based on feature flags
const sidebarItems = manifest.contributes.sidebarItems.filter((item) => {
  if (item.id === "trafficure.core.sidebar.item.analytics") {
    return isAnalyticsEnabled
  }

  if (item.id === "trafficure.core.sidebar.item.reports") {
    return isReportsEnabled
  }

  return true
})

export const extension = {
  ...manifest,
  contributes: {
    ...manifest.contributes,
    sidebarItems: manifest.contributes.sidebarItems.filter((item) => {
      if (item.id === "trafficure.core.sidebar.item.analytics") {
        return isAnalyticsEnabled
      }
      if (item.id === "trafficure.core.sidebar.item.reports") {
        return isReportsEnabled
      }
      return true
    }),
  },
  refs: {
    "trafficure.core.layerRenderers.traffic": TrafficLayer,
    "trafficure.core.layerRenderers.alerts": AlertsLayer,
    "trafficure.core.layerRenderers.roads": RoadsLayer,
  },
} satisfies ExtensionManifest
