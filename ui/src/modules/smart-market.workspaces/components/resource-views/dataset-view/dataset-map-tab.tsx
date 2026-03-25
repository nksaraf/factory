import { Map } from "lucide-react"

import type { ResourceDetail } from "../../../types"

function extractDatasetMeta(resource: ResourceDetail) {
  const metaBlock = resource.blocks.find((b) => b.blockType === "dataset_meta")
  return metaBlock?.data as {
    kind?: string
    bounds?: [number, number, number, number]
    source?: { type: string }
  } | null
}

export function DatasetMapTab({ resource }: { resource: ResourceDetail }) {
  const meta = extractDatasetMeta(resource)
  const hasGeometry = meta?.kind === "vector" || meta?.kind === "raster"

  if (!hasGeometry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Map className="h-12 w-12 opacity-30" />
        <p className="text-sm">No spatial data</p>
        <p className="text-xs opacity-60">
          This dataset has no geometry columns. Set kind to &quot;vector&quot;
          or &quot;raster&quot; to enable the map view.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Map className="h-12 w-12 opacity-30" />
      <p className="text-sm">Map preview</p>
      {meta?.bounds && (
        <p className="text-xs font-mono opacity-60">
          Bounds: [{meta.bounds.map((b) => b.toFixed(4)).join(", ")}]
        </p>
      )}
      <p className="text-xs opacity-40">Full map rendering coming soon</p>
    </div>
  )
}
