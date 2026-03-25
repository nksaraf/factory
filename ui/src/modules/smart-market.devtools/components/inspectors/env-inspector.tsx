import { Check, Pencil, RefreshCw, RotateCcw, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import { useDevtools } from "../../devtools-context"
import {
  clearAllEnvOverrides,
  getEnvOverrides,
  getOriginalEnvValues,
  removeEnvOverride,
  setEnvOverride,
} from "../../env-overrides"

export function EnvInspector() {
  const { rio } = useDevtools()
  const [filter, setFilter] = useState("")
  const [dirty, setDirty] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")

  const overrides = getEnvOverrides()
  const originals = getOriginalEnvValues()
  const overrideCount = Object.keys(overrides).length

  const envKeys = useMemo(() => {
    const keys = Object.keys(rio.env).filter(
      (k) => typeof (rio.env as any)[k] !== "function"
    )
    keys.sort()
    return keys
  }, [rio.env])

  const filtered = filter
    ? envKeys.filter((k) => k.toLowerCase().includes(filter.toLowerCase()))
    : envKeys

  function handleSave(key: string, value: string) {
    setEnvOverride(key, value)
    setEditingKey(null)
    setDirty(true)
  }

  function handleRemoveOverride(key: string) {
    removeEnvOverride(key)
    setDirty(true)
  }

  function handleResetAll() {
    clearAllEnvOverrides()
    setDirty(true)
  }

  return (
    <div className="space-y-3">
      {/* Reload banner */}
      {dirty && (
        <div className="flex items-center gap-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] text-amber-300 flex-1">
            Environment overrides changed — reload to apply
          </span>
          <button
            onClick={() => window.location.reload()}
            className="text-[11px] px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-md hover:bg-amber-500/30 font-medium flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={11} />
            Reload
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
          Environment
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded">
          {envKeys.length} vars
        </span>
        {overrideCount > 0 && (
          <>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {overrideCount} overridden
            </span>
            <button
              onClick={handleResetAll}
              className="text-[10px] px-2 py-0.5 text-red-400 hover:bg-red-500/10 rounded transition-colors flex items-center gap-1"
            >
              <RotateCcw size={10} />
              Reset All
            </button>
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
        />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter variables..."
          className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg border border-[#1c2433] bg-[#0a0e14] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-all"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#1c2433] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#0a0e14] border-b border-[#1c2433]">
              <th className="text-left px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase">
                Key
              </th>
              <th className="text-left px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase">
                Value
              </th>
              <th className="px-3 py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((key) => {
              const currentVal = String((rio.env as any)[key] ?? "")
              const originalVal =
                key in originals ? String(originals[key]) : currentVal
              const isOverridden = key in overrides
              const isEditing = editingKey === key

              return (
                <tr
                  key={key}
                  className="border-b border-[#1c2433] last:border-0 hover:bg-[#161b22]/50 transition-colors"
                >
                  <td className="px-3 py-2 font-mono align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-300">{key}</span>
                      {isOverridden && (
                        <span className="text-[8px] font-semibold tracking-wider uppercase px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded ring-1 ring-amber-500/20">
                          modified
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono align-top max-w-sm">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSave(key, editValue)
                        }}
                        className="flex gap-1.5"
                      >
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-cyan-500/30 rounded-md bg-[#0a0e14] text-[11px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                          title="Save"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-[#161b22] rounded transition-colors"
                          title="Cancel"
                        >
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <span
                        className={`break-all ${
                          isOverridden ? "text-amber-300" : "text-zinc-400"
                        }`}
                      >
                        {currentVal || (
                          <span className="text-zinc-600 italic">(empty)</span>
                        )}
                      </span>
                    )}
                    {isOverridden &&
                      !isEditing &&
                      originalVal !== currentVal && (
                        <div className="text-[10px] text-zinc-600 mt-0.5 flex items-center gap-1">
                          <span>was:</span>
                          <span className="text-zinc-500">{originalVal}</span>
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    {!isEditing && (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingKey(key)
                            setEditValue(currentVal)
                          }}
                          className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-[#161b22] rounded transition-colors"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        {isOverridden && (
                          <button
                            onClick={() => handleRemoveOverride(key)}
                            className="p-1 text-red-500/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Reset to original"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
