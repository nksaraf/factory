import { useEffect } from "react"

import { RouteErrorMessage } from "@rio.js/app-ui/components/route-error-message"
import { RioClient } from "@rio.js/client"
import { DatasetsExplorerLayout } from "@rio.js/datalake-ui/components/datasets/datasets-explorer-layout"
import { geojsonUrlDriver } from "@rio.js/gdal/drivers/geojson-url"
import { parquetUrlDriver } from "@rio.js/gdal/drivers/parquet-url"
import { tiffUrlDriver } from "@rio.js/gdal/drivers/tiff-url"
import { WebGDALService } from "@rio.js/gis/lib/gdal-service"
import { WebGISService } from "@rio.js/gis/lib/gis-service"
import { useSidebar } from "@rio.js/ui/components/sidebar"

export async function loader({ params }: { params: { datasetId: string } }) {
  console.log("loader", params)
  const rio = RioClient.instance
  if (!rio.gis) {
    const gisService = new WebGISService(rio)
    const gdalService = new WebGDALService(rio, {
      server: {
        url: rio.env.PUBLIC_SUPABASE_URL,
        key: rio.env.PUBLIC_SUPABASE_ANON_KEY,
      },
    })

    gdalService.gdal.registerDrivers([
      tiffUrlDriver,
      parquetUrlDriver,
      geojsonUrlDriver,
    ])

    rio.services.registerSync("gis", gisService)
    rio.services.registerSync("gdal", gdalService)
  }
}

export default function DatasetsExplorer({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarContext = useSidebar()
  useEffect(() => {
    sidebarContext.setOpen(false)
  }, [])
  return <DatasetsExplorerLayout>{children}</DatasetsExplorerLayout>
}

export function ErrorBoundary() {
  return <RouteErrorMessage />
}
