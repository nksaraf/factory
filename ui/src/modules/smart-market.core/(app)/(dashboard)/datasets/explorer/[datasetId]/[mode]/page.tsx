import { useParams } from "react-router"

import { RioClient } from "@rio.js/client"
import { DatasetView } from "@rio.js/datalake-ui/components/datasets/dataset-view"

export async function loader({
  params,
}: {
  params: { datasetId: string; mode: string }
}) {
  if (params.mode === "map") {
    const rio = RioClient.instance
    await rio.extensions.enable("gis.core", "agents.core", "gis.raster")
  }
}

export default function DatasetViewPage() {
  const { mode, datasetId } = useParams()
  return <DatasetView datasetId={datasetId} mode={mode} />
}
