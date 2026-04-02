import { EmptyState, PlaneHeader } from "@/components/factory"

export default function RoutesPage() {
  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="fleet" title="Routes & Domains" description="Ingress routes, custom domains, and tunnels" />
      <EmptyState
        icon="icon-[ph--globe-duotone]"
        title="Route management coming soon"
        description="This will include DNS domain management, TLS certificates, ingress routes, preview URLs for PR sandboxes, and tunnel connections."
      />
    </div>
  )
}
