import { ChevronDown, ChevronRight, Power, PowerOff } from "lucide-react"
import { useState } from "react"

import { useDevtools } from "../../devtools-context"
import { JsonTree } from "../json-tree"

export function ExtensionsInspector() {
  const { rio } = useDevtools()
  const extensions = rio.extensions
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const registeredIds = Array.from(extensions._registry.keys())
  const enabledIds = extensions._enabledExtensions
  const loadedExtensions = extensions._loadedExtensions

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
          Extensions
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded">
          {registeredIds.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {registeredIds.map((id) => {
          const isEnabled = enabledIds.has(id)
          const manifest = loadedExtensions.get(id)
          const isExpanded = expandedId === id

          return (
            <div
              key={id}
              className="rounded-lg border border-[#1c2433] bg-[#0a0e14] overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#161b22] transition-colors"
              >
                <span className="text-zinc-600">
                  {isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <span className="font-mono text-[11px] font-medium text-zinc-300">
                  {id}
                </span>
                <StatusPill active={isEnabled} />
                {manifest?.version && (
                  <span className="text-[10px] font-mono text-zinc-600">
                    v{manifest.version}
                  </span>
                )}
              </button>

              {isExpanded && manifest && (
                <div className="px-3 pb-3 border-t border-[#1c2433] space-y-3">
                  {/* Metadata */}
                  <div className="pt-2.5 space-y-1.5 text-[11px]">
                    {manifest.displayName && (
                      <MetaRow label="Name" value={manifest.displayName} />
                    )}
                    {manifest.description && (
                      <MetaRow
                        label="Description"
                        value={manifest.description}
                      />
                    )}
                    {manifest.publisher && (
                      <MetaRow label="Publisher" value={manifest.publisher} />
                    )}
                    {manifest.categories?.length > 0 && (
                      <div className="flex gap-2">
                        <span className="text-zinc-600 w-20 shrink-0">
                          Categories
                        </span>
                        <div className="flex gap-1 flex-wrap">
                          {manifest.categories.map((cat: string) => (
                            <span
                              key={cat}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#161b22] text-zinc-400 border border-[#1c2433]"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Contributions */}
                  {manifest.contributes && (
                    <div>
                      <h4 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-1.5">
                        Contributions
                      </h4>
                      <div className="space-y-0.5">
                        {Object.entries(manifest.contributes).map(
                          ([type, items]) => (
                            <ContributionSection
                              key={type}
                              type={type}
                              items={items as any[]}
                            />
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Enable/Disable */}
                  <button
                    onClick={async () => {
                      if (isEnabled) {
                        await rio.extensions.disable(id)
                      } else {
                        await rio.extensions.enable(id)
                      }
                    }}
                    className={`text-[11px] px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
                      isEnabled
                        ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                        : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20"
                    }`}
                  >
                    {isEnabled ? (
                      <>
                        <PowerOff size={12} /> Disable
                      </>
                    ) : (
                      <>
                        <Power size={12} /> Enable
                      </>
                    )}
                  </button>
                </div>
              )}

              {isExpanded && !manifest && (
                <div className="px-3 pb-3 border-t border-[#1c2433] pt-2.5 text-[11px] text-zinc-500 italic">
                  Not loaded — registered but never enabled
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full ${
        active
          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
          : "bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700"
      }`}
    >
      {active ? "enabled" : "registered"}
    </span>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-600 w-20 shrink-0">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  )
}

function ContributionSection({ type, items }: { type: string; items: any[] }) {
  const [expanded, setExpanded] = useState(false)

  if (!items?.length) return null

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] py-1 hover:text-zinc-300 text-zinc-400 transition-colors w-full"
      >
        <span className="text-zinc-600">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span>{type}</span>
        <span className="text-[9px] font-mono bg-[#161b22] text-zinc-500 px-1.5 rounded border border-[#1c2433]">
          {items.length}
        </span>
      </button>
      {expanded && (
        <div className="ml-5 mt-1">
          <JsonTree data={items} />
        </div>
      )}
    </div>
  )
}
