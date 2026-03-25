export function EmptyState() {
  return (
    <div className="flex items-start justify-center h-full px-4 py-4">
      <div className="text-center p-8 rounded-lg border-2 border-dashed border-scale-700 bg-scale-300 shadow-sm max-w-md w-full">
        <h3 className="mt-4 text-lg font-semibold text-scale-1200">
          No roads found
        </h3>
        <p className="mt-2 text-base text-scale-1100">
          There are currently no roads to display. Roads will appear here when
          they are available for the selected organization.
        </p>
      </div>
    </div>
  )
}

