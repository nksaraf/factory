import { PanelLeft } from "lucide-react"
import { useEffect } from "react"
import { LoaderFunctionArgs, useParams } from "react-router"
import { WorkspacePicker } from "~/src/modules/smart-market.workspaces/components/workspace-picker"

import { AppErrorBoundary } from "@rio.js/app-ui/components/app-error-boundary"
import { AppMenubar } from "@rio.js/app-ui/components/app-menubar"
import { AppTitle } from "@rio.js/app-ui/components/app-title"
import { RioClient } from "@rio.js/client"
import { geojsonUrlDriver } from "@rio.js/gdal/drivers/geojson-url"
import { parquetUrlDriver } from "@rio.js/gdal/drivers/parquet-url"
import { tiffUrlDriver } from "@rio.js/gdal/drivers/tiff-url"
import { WebGDALService } from "@rio.js/gis/lib/gdal-service"
import { WebGISService } from "@rio.js/gis/lib/gis-service"
import { Button } from "@rio.js/ui/components/button"
import { useSidebar } from "@rio.js/ui/components/sidebar"
import { Loader } from "@rio.js/ui/toast"

import { ExploreProjectProvider } from "./explore-project-provider"

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

export default function ExploreLayout({
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
      <AppMenubar />

      <AppTitle title="Explore" icon={null}>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => sidebarContext.toggleSidebar()}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <WorkspacePicker />
          <span className="text-muted-foreground/30">/</span>
          <span className="text-sm font-medium">Explore</span>
        </div>
      </AppTitle>
      <ExploreProjectProvider name="explore">{children}</ExploreProjectProvider>
    </>
  )
}

export function Loading() {
  return <Loader id="project-loading" message="Loading project..." />
}

export function ErrorBoundary(props: any) {
  return <AppErrorBoundary {...props} />
}
