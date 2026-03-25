import { useEffect } from "react"
import { LoaderFunctionArgs, useParams } from "react-router"
import { WorkspacePicker } from "~/src/modules/smart-market.workspaces/components/workspace-picker"

import { AppErrorBoundary } from "@rio.js/app-ui/components/app-error-boundary"
import { ModuleMenubar } from "@rio.js/app-ui/components/module-menubar"
import { ModuleTitle } from "@rio.js/app-ui/components/module-title"
import { RioClient } from "@rio.js/client"
import { geojsonUrlDriver } from "@rio.js/gdal/drivers/geojson-url"
import { parquetUrlDriver } from "@rio.js/gdal/drivers/parquet-url"
import { tiffUrlDriver } from "@rio.js/gdal/drivers/tiff-url"
import { WebGDALService } from "@rio.js/gis/lib/gdal-service"
import { WebGISService } from "@rio.js/gis/lib/gis-service"
import { Button } from "@rio.js/ui/components/button"
import { useSidebar } from "@rio.js/ui/components/sidebar"
import { Icon } from "@rio.js/ui/icon"
import { Loader } from "@rio.js/ui/toast"

import { ScoutProjectProvider } from "./scout-project-provider"

export async function loader({ params }: LoaderFunctionArgs) {
  const rio = RioClient.instance

  const gisService = new WebGISService(rio)
  const gdalService = new WebGDALService(rio, {
    server: {
      url: rio.env.PUBLIC_SUPABASE_URL,
      key: rio.env.PUBLIC_SUPABASE_ANON_KEY,
    },
  })

  rio.services.registerSync("gis", gisService)
  rio.services.registerSync("gdal", gdalService)
  gdalService.gdal.registerDrivers([
    tiffUrlDriver,
    geojsonUrlDriver,
    parquetUrlDriver,
  ])
  await rio.extensions.enable("gis.core", "agents.core")

  return null
}

export default function ScoutsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarContext = useSidebar()

  useEffect(() => {
    if (sidebarContext.open) {
      sidebarContext.toggleSidebar()
    }
  }, [])

  return (
    <>
      <ModuleMenubar />

      <ModuleTitle title="Scouts" icon={null}>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => sidebarContext.toggleSidebar()}
            aria-label="Toggle sidebar"
          >
            <Icon icon="icon-[ph--sidebar-duotone]" className="h-4 w-4" />
          </Button>
          <WorkspacePicker />
          <span className="text-muted-foreground/30">/</span>
          <span className="text-sm font-medium">Scouts</span>
        </div>
      </ModuleTitle>
      <ScoutProjectProvider name="scouts">{children}</ScoutProjectProvider>
    </>
  )
}

export function Loading() {
  return <Loader id="project-loading" message="Loading project..." />
}

export function ErrorBoundary(props: any) {
  return <AppErrorBoundary {...props} />
}
