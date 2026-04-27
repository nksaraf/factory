import type {
  ThreadMessage,
  ThreadExchange,
} from "../../../factory.threads/data/types"
import { ExchangeView } from "../../../factory.threads/components/exchange-view"
import { TileShell } from "../tile-shell"

interface AgentTileProps {
  threadId: string
  title?: string
  messages: ThreadMessage[]
  exchanges: ThreadExchange[]
  status?: string
  cwd?: string
}

export function AgentTile({
  threadId,
  title,
  messages,
  exchanges,
  status,
  cwd,
}: AgentTileProps) {
  const label = title ?? `Agent ${threadId.slice(0, 8)}`
  const tileStatus =
    status === "active"
      ? ("degraded" as const)
      : status === "completed"
        ? ("healthy" as const)
        : ("unknown" as const)

  return (
    <TileShell
      title={label}
      icon="icon-[ph--robot-duotone]"
      status={tileStatus}
      actions={
        <span className="text-xs text-zinc-400">
          {messages.length} messages
        </span>
      }
    >
      <div className="flex max-h-96 flex-col overflow-hidden">
        <ExchangeView
          messages={messages}
          exchanges={exchanges}
          threadStatus={status}
          cwd={cwd}
        />
      </div>
    </TileShell>
  )
}
