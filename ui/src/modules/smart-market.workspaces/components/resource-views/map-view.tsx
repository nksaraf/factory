import { ExtensionView } from "@rio.js/app-ui/components/extension-view"
import { WorkspaceLayout } from "@rio.js/app-ui/components/workspace/workspace-layout"
import { WorkspaceMenubar } from "@rio.js/app-ui/components/workspace/workspace-menubar"
import { WorkspaceTitle } from "@rio.js/app-ui/components/workspace/workspace-title"
import { RioClient } from "@rio.js/client"
import { env } from "@rio.js/env"
import { WebGISProvider } from "@rio.js/gis/components/web-gis-provider"
import { WebGISService } from "@rio.js/gis/lib/gis-service"

import type { ResourceDetail } from "../../types"

// Ensure GIS service is registered before rendering the map.
// Safe to call multiple times — only registers once.
function ensureGISService() {
  const rio = RioClient.instance
  if (!rio.services.get("gis")) {
    const gisService = new WebGISService(rio)
    rio.services.registerSync("gis", gisService)
  }
}

export default function MapView({ resource }: { resource: ResourceDetail }) {
  ensureGISService()

  return (
    <WebGISProvider
      key={resource.id}
      id={`workspace-map-${resource.id}`}
      initialProject={{
        maps: {
          main: {
            id: "main",
            provider: "google",
            style: "light-street",
            visible: true,
            settings: {
              apiKey: env.PUBLIC_GOOGLE_MAPS_API_KEY,
            },
          },
        },
      }}
      refreshProject={() => void Promise.resolve()}
      onProjectChange={() => true}
    >
      <WorkspaceLayout id={`workspace-map-${resource.id}`}>
        <WorkspaceMenubar />
        <WorkspaceTitle
          title={resource.name ?? "Map"}
          icon="icon-[ph--map-trifold-duotone]"
        >
          <span className="text-sm font-medium">{resource.name ?? "Map"}</span>
        </WorkspaceTitle>

        <ExtensionView
          container="main"
          src="gis.core.views.map"
          props={{
            mapId: "main",
            className: "with-toolbar",
            contextMenuItems: <></>,
            renderers: {},
          }}
        />
      </WorkspaceLayout>
    </WebGISProvider>
  )
}
