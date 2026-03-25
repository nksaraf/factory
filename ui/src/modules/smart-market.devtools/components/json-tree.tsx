import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react"
import { useCallback, useState } from "react"

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (value === null) return <span className="text-zinc-500 italic">null</span>
  if (value === undefined)
    return <span className="text-zinc-500 italic">undefined</span>

  if (typeof value === "string")
    return (
      <span className="text-emerald-400">
        "<span className="text-emerald-300">{value}</span>"
      </span>
    )
  if (typeof value === "number")
    return <span className="text-cyan-300">{value}</span>
  if (typeof value === "boolean")
    return <span className="text-violet-400">{String(value)}</span>

  if (typeof value === "function")
    return (
      <span className="text-zinc-500 italic">
        <span className="text-amber-500/70">f</span> {value.name || "anonymous"}
        ()
      </span>
    )

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-[10px] text-zinc-500">
            Array[{value.length}]
          </span>
        </button>
        {expanded && (
          <div className="ml-3 pl-3 border-l border-[#1c2433]">
            {value.map((item, i) => (
              <div key={i} className="flex gap-1.5 py-px">
                <span className="text-zinc-600 shrink-0 select-none">{i}</span>
                <JsonValue value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0)
      return <span className="text-zinc-500">{"{}"}</span>

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-[10px] text-zinc-500">
            {"{"}
            {entries.length}
            {"}"}
          </span>
        </button>
        {expanded && (
          <div className="ml-3 pl-3 border-l border-[#1c2433]">
            {entries.map(([key, val]) => (
              <div key={key} className="flex gap-1.5 py-px">
                <span className="text-sky-400/70 shrink-0">{key}</span>
                <span className="text-zinc-600 shrink-0">:</span>
                <JsonValue value={val} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  return <span className="text-zinc-300">{String(value)}</span>
}

export function JsonTree({ data, label }: { data: unknown; label?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    try {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }, [data])

  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {(label || true) && (
        <div className="flex items-center gap-2 mb-1.5">
          {label && (
            <span className="text-[11px] font-semibold font-sans text-zinc-300">
              {label}
            </span>
          )}
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded border border-[#1c2433] hover:border-[#2a3441] bg-[#0a0e14] transition-colors"
          >
            {copied ? (
              <>
                <Check size={10} className="text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={10} />
                Copy
              </>
            )}
          </button>
        </div>
      )}
      <JsonValue value={data} />
    </div>
  )
}
