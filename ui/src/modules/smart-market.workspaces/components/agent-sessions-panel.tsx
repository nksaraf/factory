import { useMemo, useState } from "react"

import { Button } from "@rio.js/ui/button"
import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import { Icon } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"
import { cn } from "@rio.js/ui/lib/utils"

import {
  type AgentSessionSummary,
  useAgentSessions,
} from "../data/use-agent-sessions"
import { useCreateResource } from "../data/use-create-resource"

function formatRelativeTime(dateStr: string) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function groupSessionsByDate(sessions: AgentSessionSummary[]) {
  const groups: { label: string; sessions: AgentSessionSummary[] }[] = []
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86_400_000)
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000)

  const todayGroup: AgentSessionSummary[] = []
  const yesterdayGroup: AgentSessionSummary[] = []
  const thisWeekGroup: AgentSessionSummary[] = []
  const olderGroup: AgentSessionSummary[] = []

  for (const s of sessions) {
    const d = new Date(s.updatedAt)
    if (d >= today) todayGroup.push(s)
    else if (d >= yesterday) yesterdayGroup.push(s)
    else if (d >= weekAgo) thisWeekGroup.push(s)
    else olderGroup.push(s)
  }

  if (todayGroup.length) groups.push({ label: "Today", sessions: todayGroup })
  if (yesterdayGroup.length)
    groups.push({ label: "Yesterday", sessions: yesterdayGroup })
  if (thisWeekGroup.length)
    groups.push({ label: "This Week", sessions: thisWeekGroup })
  if (olderGroup.length) groups.push({ label: "Older", sessions: olderGroup })

  return groups
}

function SessionItem({
  session,
  isActive,
  onClick,
}: {
  session: AgentSessionSummary
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent",
        isActive && "bg-accent"
      )}
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-base font-medium">
          {session.name}
        </span>
        {session.status === "active" && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-success-600"
            aria-label="Active session"
          />
        )}
      </div>
      {session.lastMessagePreview && (
        <p className="line-clamp-1 text-sm text-muted-foreground">
          {session.lastMessagePreview}
        </p>
      )}
    </button>
  )
}

export function AgentSessionsPanel({
  workspaceId,
  activeSessionId,
  onSessionSelect,
}: {
  workspaceId: string | null
  activeSessionId?: string | null
  onSessionSelect?: (sessionId: string) => void
}) {
  const { data: sessions, isLoading } = useAgentSessions(
    workspaceId ?? undefined
  )
  const createResource = useCreateResource(workspaceId ?? "")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!sessions) return []
    if (!search.trim()) return sessions
    const q = search.toLowerCase()
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.agentName.toLowerCase().includes(q) ||
        s.lastMessagePreview?.toLowerCase().includes(q)
    )
  }, [sessions, search])

  const groups = useMemo(() => groupSessionsByDate(filtered), [filtered])

  if (!workspaceId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-muted-foreground">
        <Icon
          icon="icon-[ph--robot-duotone]"
          className="h-10 w-10 opacity-20"
        />
        <p className="text-xs text-center">
          Select a workspace to view chat sessions
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Icon
          icon="icon-[ph--chat-circle-dots-duotone]"
          className="h-4 w-4 text-muted-foreground"
        />
        <span className="flex-1 text-base font-semibold">AI Sessions</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="New chat session"
          onClick={() =>
            createResource.mutate({
              name: "New Chat",
              resourceType: "agent_session",
            })
          }
        >
          <Icon icon="icon-[ph--plus]" className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="relative">
          <Icon
            icon="icon-[ph--magnifying-glass]"
            className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs"
            aria-label="Search chat sessions"
          />
          {search && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <Icon icon="icon-[ph--x]" className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        <nav className="px-2 pb-2" aria-label="Chat sessions">
          {isLoading ? (
            <div
              className="flex items-center justify-center py-8 text-xs text-muted-foreground"
              role="status"
            >
              Loading sessions...
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Icon
                icon="icon-[ph--robot-duotone]"
                className="h-10 w-10 opacity-20"
              />
              <p className="text-xs">
                {search ? "No matching sessions" : "No chat sessions yet"}
              </p>
              {!search && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    createResource.mutate({
                      name: "New Chat",
                      resourceType: "agent_session",
                    })
                  }
                >
                  <Icon icon="icon-[ph--plus]" className="mr-1.5 h-3 w-3" />
                  Start a chat
                </Button>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <div
                key={group.label}
                className="mb-1"
                role="group"
                aria-label={group.label}
              >
                <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
                  {group.label}
                </div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onClick={() => onSessionSelect?.(session.id)}
                  />
                ))}
              </div>
            ))
          )}
        </nav>
      </ScrollArea>
    </div>
  )
}
