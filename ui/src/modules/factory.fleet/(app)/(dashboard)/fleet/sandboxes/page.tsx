import { useSandboxes } from "@/lib/fleet"
import { useState } from "react"

import { Icon } from "@rio.js/ui/icon"
import { Input } from "@rio.js/ui/input"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"

export default function SandboxesPage() {
  const { data: sandboxes, isLoading } = useSandboxes()
  const [ownerFilter, setOwnerFilter] = useState("")

  const filtered = (sandboxes ?? []).filter(
    (s) => !ownerFilter || s.ownerType === ownerFilter
  )

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Sandbox Manager"
        description="Ephemeral development environments"
      />

      <div className="flex gap-3">
        <Input placeholder="Search..." className="max-w-sm" />
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All owners</option>
          <option value="user">User</option>
          <option value="agent">Agent</option>
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--terminal-window-duotone]"
          title="No sandboxes"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => (
          <div key={s.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Icon
                  icon={
                    s.ownerType === "agent"
                      ? "icon-[ph--robot-duotone]"
                      : "icon-[ph--user-duotone]"
                  }
                  className="h-4 w-4 text-muted-foreground"
                />
                <h3 className="font-medium">{s.name}</h3>
              </div>
              <StatusBadge status={s.statusMessage ?? "running"} />
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>Realm: {s.realmType}</p>
              <p>
                Owner: {s.ownerId} ({s.ownerType})
              </p>
              {s.cpu && (
                <p>
                  CPU: {s.cpu} · Mem: {s.memory}
                </p>
              )}
              <p>Storage: {s.storageGb} GB</p>
            </div>
            {s.webTerminalUrl && (
              <a
                href={s.webTerminalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-teal-400 hover:underline"
              >
                Open Terminal
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
