import { useParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"

import { EmptyState } from "@/components/factory"
import { usePrincipalLinks } from "../../../../../../data/use-org"
import { PrincipalLayout } from "../principal-layout"

const PROVIDER_ICON: Record<string, string> = {
  github: "icon-[simple-icons--github]",
  slack: "icon-[simple-icons--slack]",
  jira: "icon-[simple-icons--jira]",
  google: "icon-[simple-icons--google]",
}

export default function PrincipalIdentitiesTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: links, isLoading } = usePrincipalLinks(slug)
  const identityLinks = links ?? []

  return (
    <PrincipalLayout>
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && identityLinks.length === 0 && (
        <EmptyState
          icon="icon-[ph--fingerprint-duotone]"
          title="No linked identities"
        />
      )}

      <div className="space-y-3">
        {identityLinks.map((link: any) => {
          const provider = link.type ?? link.provider ?? "unknown"
          const linkSpec = (link.spec ?? {}) as Record<string, unknown>
          const profileData = (linkSpec.profileData ?? {}) as Record<
            string,
            unknown
          >
          const displayName =
            (linkSpec.externalUsername as string) ??
            (profileData.displayName as string) ??
            (profileData.login as string) ??
            link.externalId
          const linkEmail =
            (linkSpec.email as string) ?? (profileData.email as string) ?? null
          const avatarUrl = profileData.avatarUrl as string | undefined
          return (
            <div key={link.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className={cn(
                        PROVIDER_ICON[provider] ?? "icon-[ph--link-duotone]",
                        "text-2xl text-muted-foreground"
                      )}
                    />
                  )}
                  <div>
                    <div className="font-medium text-base">{displayName}</div>
                    <div className="text-sm text-muted-foreground">
                      {provider}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-0.5">
                  {linkEmail && <div>{linkEmail}</div>}
                  <div className="font-mono">{link.externalId}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </PrincipalLayout>
  )
}
