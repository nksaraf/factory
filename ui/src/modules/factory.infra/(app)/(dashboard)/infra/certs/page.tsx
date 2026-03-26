import { PlaneHeader, EmptyState } from "@/components/factory"

export default function CertsPage() {
  return (
    <div className="space-y-6 p-6">
      <PlaneHeader plane="infra" title="Certificates & Secrets" description="TLS certificates and secret management" />
      <EmptyState
        icon="icon-[ph--lock-key-duotone]"
        title="Coming soon"
        description="Certificate and secret management will be available in a future release."
      />
    </div>
  )
}
