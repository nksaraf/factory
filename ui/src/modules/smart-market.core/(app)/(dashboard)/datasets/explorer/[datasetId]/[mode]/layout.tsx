import { useParams } from "react-router"

import { DatasetExplorerLayout } from "@rio.js/datalake-ui/components/datasets/dataset-explorer-layout"

export default function DatasetExplorerLayoutView({
  children,
}: {
  children: React.ReactNode
}) {
  const { datasetId, mode } = useParams()
  return (
    <DatasetExplorerLayout datasetId={datasetId} mode={mode}>
      {children}
    </DatasetExplorerLayout>
  )
}
