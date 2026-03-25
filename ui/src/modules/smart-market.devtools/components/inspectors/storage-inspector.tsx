import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { useCallback, useState, useSyncExternalStore } from "react"

import { JsonTree } from "../json-tree"

function getStorageEntries(): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      entries.push({ key, value: localStorage.getItem(key) ?? "" })
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key))
  return entries
}

let storageVersion = 0
const listeners = new Set<() => void>()
function notifyStorageChange() {
  storageVersion++
  listeners.forEach((fn) => fn())
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", notifyStorageChange)
}

function useStorageEntries() {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, [])
  const getSnapshot = useCallback(() => storageVersion, [])
  useSyncExternalStore(subscribe, getSnapshot)
  return getStorageEntries()
}

function tryParseJSON(value: string): unknown | null {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function StorageInspector() {
  const entries = useStorageEntries()
  const [filter, setFilter] = useState("")
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [showAdd, setShowAdd] = useState(false)

  const filtered = filter
    ? entries.filter((e) => e.key.toLowerCase().includes(filter.toLowerCase()))
    : entries

  const totalSize = entries.reduce(
    (sum, e) => sum + new Blob([e.key + e.value]).size,
    0
  )

  function handleSave(key: string, value: string) {
    localStorage.setItem(key, value)
    setEditingKey(null)
    notifyStorageChange()
  }

  function handleDelete(key: string) {
    localStorage.removeItem(key)
    setExpandedKey(null)
    notifyStorageChange()
  }

  function handleAdd() {
    if (newKey) {
      localStorage.setItem(newKey, newValue)
      setNewKey("")
      setNewValue("")
      setShowAdd(false)
      notifyStorageChange()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
          LocalStorage
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded">
          {entries.length} entries
        </span>
        <span className="text-[10px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded">
          {formatSize(totalSize)}
        </span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className={`ml-auto text-[11px] px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${
            showAdd
              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#161b22]"
          }`}
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {/* Add new entry */}
      {showAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
          className="flex gap-2 p-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5"
        >
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Key"
            autoFocus
            className="flex-1 px-2.5 py-1.5 text-[11px] border border-[#1c2433] rounded-md bg-[#0a0e14] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20"
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value"
            className="flex-1 px-2.5 py-1.5 text-[11px] border border-[#1c2433] rounded-md bg-[#0a0e14] font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-[11px] bg-cyan-500/10 text-cyan-400 rounded-md border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-md hover:bg-[#161b22] transition-colors"
          >
            <X size={13} />
          </button>
        </form>
      )}

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
          placeholder="Filter keys..."
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
              <th className="text-right px-3 py-2 text-zinc-500 font-medium text-[10px] tracking-wider uppercase w-16">
                Size
              </th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ key, value }) => {
              const isExpanded = expandedKey === key
              const isEditing = editingKey === key
              const parsed = tryParseJSON(value)
              const sizeBytes = new Blob([value]).size

              return (
                <tr
                  key={key}
                  className="border-b border-[#1c2433] last:border-0 hover:bg-[#161b22]/50 transition-colors"
                >
                  <td className="px-3 py-2 font-mono align-top">
                    <button
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      className="text-left text-zinc-300 hover:text-cyan-400 transition-colors"
                    >
                      {key}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono align-top max-w-xs">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSave(key, editValue)
                        }}
                        className="flex gap-1.5"
                      >
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-cyan-500/30 rounded-md bg-[#0a0e14] text-[11px] text-zinc-300 min-h-[60px] focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                          autoFocus
                        />
                        <div className="flex flex-col gap-1">
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
                            className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </form>
                    ) : isExpanded ? (
                      parsed ? (
                        <JsonTree data={parsed} />
                      ) : (
                        <span className="break-all text-zinc-400">{value}</span>
                      )
                    ) : (
                      <span className="truncate block max-w-[300px] text-zinc-400">
                        {value.slice(0, 80)}
                        {value.length > 80 && (
                          <span className="text-zinc-600">...</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-600 align-top font-mono">
                    {formatSize(sizeBytes)}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <div className="flex gap-0.5 justify-end">
                      <button
                        onClick={() => {
                          setEditingKey(key)
                          setEditValue(value)
                        }}
                        className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-[#161b22] rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(key)}
                        className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
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
