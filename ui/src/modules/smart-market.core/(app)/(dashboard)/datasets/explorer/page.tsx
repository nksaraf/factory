import { Icon, Icons } from "@rio.js/ui/icon"

export default function DatasetsExplorerPage() {
  return (
    <div className="flex items-center justify-center h-full bg-scale-200 text-scale-1100 rounded-r-lg">
      <div className="text-center">
        <Icon
          icon={Icons.database}
          className="w-12 h-12 mx-auto mb-4 opacity-50"
        />
        <p className="text-lg font-medium">Select a dataset to explore</p>
        <p className="text-sm text-scale-1000 mt-2">
          Choose a dataset from the sidebar to view its data
        </p>
      </div>
    </div>
  )
}
