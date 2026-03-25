import { Navigate, redirect, useParams } from "react-router"

export async function loader({ params }: { params: { datasetId: string } }) {
  throw redirect(`/datasets/explorer/${params.datasetId}/overview`)
}

export default function DatasetExplorerPage() {
  return null
}
