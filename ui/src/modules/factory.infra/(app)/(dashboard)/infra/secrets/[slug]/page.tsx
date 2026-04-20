import { useSecret } from "@/lib/infra"
import { useParams } from "react-router"

import { MetricCard, PageHeader } from "@/components/factory"

import { InfraActionMenu } from "../../../../../components/infra-action-menu"

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return "\u2014"
  return new Date(dateStr).toLocaleDateString()
}

export default function SecretDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: secret } = useSecret(slug)

  if (!secret) return null

  const spec = secret.spec as Record<string, any>

  return (
    <div className="space-y-6">
      <PageHeader
        pageGroup="infra"
        title={secret.name}
        actions={<InfraActionMenu entityPath="secrets" entityId={secret.id} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Owner Type"
          value={spec.ownerType ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Owner ID"
          value={spec.ownerId ?? "\u2014"}
          plane="infra"
        />
        <MetricCard
          label="Rotation Policy"
          value={spec.rotationPolicy ?? "\u2014"}
          plane="infra"
        />
      </div>

      {spec.description && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h2 className="text-lg font-semibold">Description</h2>
          <p className="text-sm text-muted-foreground">{spec.description}</p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Expiry</h2>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Rotated</span>
            <span>{formatDate(spec.lastRotatedAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expires</span>
            <span>{formatDate(spec.expiresAt)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
