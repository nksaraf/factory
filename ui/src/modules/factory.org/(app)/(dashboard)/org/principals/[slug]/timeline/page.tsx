import { useMemo } from "react"
import { useParams, Link } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { EmptyState, StatusBadge } from "@/components/factory"
import { usePrincipal } from "../../../../../../data/use-org"
import { PrincipalLayout } from "../principal-layout"
import { useQuery } from "@tanstack/react-query"
import { rio } from "@/lib/rio"

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

async function fetchPrincipalThreads(principalId: string) {
  const base =
    rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000/api/v1/factory"
  const token = getAuthToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(
    `${base}/threads/threads?principalId=${encodeURIComponent(principalId)}&limit=50`,
    { headers }
  )
  if (!res.ok) return []
  const body = await res.json()
  return body.data ?? body ?? []
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

const SOURCE_ICON: Record<string, string> = {
  "claude-code": "icon-[simple-icons--claude]",
  cursor: "icon-[simple-icons--cursor]",
  conductor: "icon-[ph--music-notes-duotone]",
  slack: "icon-[simple-icons--slack]",
  terminal: "icon-[ph--terminal-window-duotone]",
  web: "icon-[ph--globe-duotone]",
}

export default function PrincipalTimelineTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: principal } = usePrincipal(slug)

  const { data: threads, isLoading } = useQuery({
    queryKey: ["principal-threads", principal?.id],
    queryFn: () => fetchPrincipalThreads(principal!.id),
    enabled: !!principal?.id,
    refetchInterval: 30_000,
  })

  const allThreads = useMemo(() => {
    const list = threads ?? []
    return [...list].sort((a: any, b: any) => {
      const aTime = new Date(
        a.endedAt ?? a.updatedAt ?? a.startedAt ?? 0
      ).getTime()
      const bTime = new Date(
        b.endedAt ?? b.updatedAt ?? b.startedAt ?? 0
      ).getTime()
      return bTime - aTime
    })
  }, [threads])

  return (
    <PrincipalLayout>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
        <p className="text-sm text-muted-foreground">
          Agent sessions and conversations, most recently active first.
        </p>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading threads...</p>
        )}
        {!isLoading && allThreads.length === 0 && (
          <EmptyState
            icon="icon-[ph--clock-counter-clockwise-duotone]"
            title="No threads found"
            description="No agent sessions associated with this principal yet."
          />
        )}

        <div className="space-y-2">
          {allThreads.map((t: any) => {
            const title =
              t.spec?.generatedTopic ??
              t.spec?.title ??
              t.spec?.firstPrompt ??
              `${t.source} session`
            const truncTitle =
              typeof title === "string"
                ? title.split("\n")[0]?.slice(0, 120)
                : "Session"
            return (
              <Link
                key={t.id}
                to={`/threads?channel=${t.channelId ?? ""}&thread=${t.id}`}
                className="flex items-start gap-3 rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
              >
                <span
                  className={`${SOURCE_ICON[t.source] ?? "icon-[ph--chat-circle-duotone]"} text-xl text-muted-foreground mt-0.5 shrink-0`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-base truncate">
                      {truncTitle}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(t.endedAt ?? t.updatedAt ?? t.startedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{t.source}</span>
                    <StatusBadge status={t.status ?? "unknown"} />
                    {t.branch && <span className="font-mono">{t.branch}</span>}
                    {t.spec?.model && (
                      <span className="font-mono">{t.spec.model}</span>
                    )}
                    {t.spec?.turnCount != null && (
                      <span>{t.spec.turnCount} turns</span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </PrincipalLayout>
  )
}
