import { useEffect, useRef, useState } from "react"
import { useServiceLogs } from "@/lib/use-workbench"
import { TileShell } from "../tile-shell"

interface LogsTileProps {
  serviceName: string
}

export function LogsTile({ serviceName }: LogsTileProps) {
  const { lines } = useServiceLogs(serviceName)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines.length, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  return (
    <TileShell
      title={`Logs — ${serviceName}`}
      icon="icon-[ph--terminal-window-duotone]"
      actions={
        <span className="text-xs text-zinc-400">{lines.length} lines</span>
      }
    >
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-80 overflow-auto font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <span className="text-zinc-400">Waiting for logs...</span>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap break-all text-zinc-700 dark:text-zinc-300"
            >
              {line}
            </div>
          ))
        )}
      </div>
    </TileShell>
  )
}
