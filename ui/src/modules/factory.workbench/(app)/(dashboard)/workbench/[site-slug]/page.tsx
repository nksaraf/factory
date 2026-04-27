import { useParams } from "react-router"

export default function SiteWorkbenchPage() {
  const { siteSlug } = useParams<{ siteSlug: string }>()

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Workbench — {siteSlug}</h1>
      <p className="text-sm text-zinc-500">
        Site-specific workbench view coming soon.
      </p>
    </div>
  )
}
