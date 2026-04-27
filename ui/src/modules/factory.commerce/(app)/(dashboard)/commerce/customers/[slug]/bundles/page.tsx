import { useCustomerBundles } from "@/lib/commerce"
import { useParams } from "react-router"

import { EmptyState } from "@/components/factory"
import { CustomerLayout } from "../customer-layout"

export default function CustomerBundlesTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: bundles, isLoading } = useCustomerBundles(slug)

  return (
    <CustomerLayout>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (bundles ?? []).length === 0 ? (
        <EmptyState
          icon="icon-[ph--shield-check-duotone]"
          title="No bundles"
          description="This customer has no entitlement bundles yet."
        />
      ) : (
        <div className="space-y-2">
          {(bundles ?? []).map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between rounded-lg border bg-card p-3"
            >
              <div>
                <span className="font-medium text-base">
                  v{b.spec?.bundleVersion ?? "?"}
                </span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {b.spec?.capabilities?.length ?? 0} capabilities
                </span>
                {b.spec?.issuer && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    Issuer: {b.spec.issuer}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {b.spec?.expiresAt
                  ? `Expires ${new Date(b.spec.expiresAt).toLocaleDateString()}`
                  : "No expiration"}
              </span>
            </div>
          ))}
        </div>
      )}
    </CustomerLayout>
  )
}
