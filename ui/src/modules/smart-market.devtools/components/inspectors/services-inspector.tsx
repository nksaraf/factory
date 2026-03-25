import { ChevronDown, ChevronRight, Server } from "lucide-react"
import { useState } from "react"

import { useDevtools } from "../../devtools-context"
import { JsonTree } from "../json-tree"

export function ServicesInspector() {
  const { rio } = useDevtools()
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const servicesAtom = (rio.services as any)._services
  const servicesObj = servicesAtom?.value ?? {}
  const serviceKeys = Object.keys(servicesObj).sort()

  function getService(key: string): any {
    try {
      return rio.services.get(key as any)
    } catch {
      return null
    }
  }

  function describeService(svc: any): Record<string, unknown> {
    if (!svc) return {}
    const desc: Record<string, unknown> = {
      type: svc.constructor?.name || typeof svc,
    }

    if (svc._persistedAtoms) {
      desc.atoms = Object.fromEntries(
        (svc._persistedAtoms as Map<string, any>).entries?.() ?? []
      )
    }

    for (const [k, v] of Object.entries(svc)) {
      if (k.startsWith("_")) continue
      if (typeof v === "function") continue
      desc[k] = v
    }

    return desc
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
          Services
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded">
          {serviceKeys.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {serviceKeys.map((key) => {
          const svc = getService(key)
          const isExpanded = expandedKey === key

          return (
            <div
              key={key}
              className="rounded-lg border border-[#1c2433] bg-[#0a0e14] overflow-hidden"
            >
              <button
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#161b22] transition-colors"
              >
                <span className="text-zinc-600">
                  {isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <Server size={12} className="text-zinc-600" />
                <span className="font-mono text-[11px] font-medium text-zinc-300">
                  {key}
                </span>
                <span className="text-[10px] font-mono text-zinc-600">
                  {svc?.constructor?.name || typeof svc}
                </span>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-[#1c2433] pt-2.5">
                  <JsonTree data={describeService(svc)} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Rio client introspection */}
      <div className="border-t border-[#1c2433] pt-4 mt-2">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-2">
          Rio Client
        </h3>
        <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] p-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] font-mono">
            {["atoms", "reactor", "events", "state", "extensions", "query"].map(
              (prop) => (
                <div key={prop} className="flex items-center gap-2 py-0.5">
                  <span className="text-zinc-500">{prop}</span>
                  <span className="text-zinc-400">
                    {(rio as any)[prop]?.constructor?.name ||
                      typeof (rio as any)[prop]}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
