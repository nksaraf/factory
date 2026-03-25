import { Maximize2, Minimize2, Terminal, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import type { RioClient } from "@rio.js/client"

import { DevtoolsProvider } from "../devtools-context"
import { hasEnvOverrides } from "../env-overrides"
import { DevtoolsTabs } from "./devtools-tabs"

const MIN_HEIGHT = 200
const MAX_HEIGHT_RATIO = 0.85

export function DevtoolsPanel({
  rio,
  router,
}: {
  rio: RioClient
  router: any
}) {
  const [open, setOpen] = useState(
    () => localStorage.getItem("devtools:open") === "true"
  )
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem("devtools:height")
    return saved ? Math.max(MIN_HEIGHT, parseInt(saved, 10)) : 340
  })
  const [isMaximized, setIsMaximized] = useState(false)
  const isDragging = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem("devtools:open", String(open))
  }, [open])

  useEffect(() => {
    localStorage.setItem("devtools:height", String(height))
  }, [height])

  // Keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "d") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Resize drag handler
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      const startY = e.clientY
      const startH = height

      function onMove(ev: MouseEvent) {
        if (!isDragging.current) return
        const delta = startY - ev.clientY
        const maxH = window.innerHeight * MAX_HEIGHT_RATIO
        setHeight(Math.min(maxH, Math.max(MIN_HEIGHT, startH + delta)))
      }
      function onUp() {
        isDragging.current = false
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [height]
  )

  const envOverridesActive = hasEnvOverrides()

  return (
    <DevtoolsProvider rio={rio} router={router}>
      {/* FAB */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-4 right-4 z-[9999] group"
        title="Toggle Devtools (Ctrl+Shift+D)"
      >
        <div
          className={`
            relative size-10 rounded-xl flex items-center justify-center
            transition-all duration-200 ease-out
            shadow-lg shadow-black/20
            ${
              open
                ? "bg-[#0d1117] ring-1 ring-cyan-500/40 text-cyan-400"
                : "bg-[#0d1117] ring-1 ring-white/10 text-zinc-400 hover:text-cyan-400 hover:ring-cyan-500/30"
            }
          `}
        >
          <Terminal size={16} strokeWidth={2.5} />
          {/* Active indicator */}
          {envOverridesActive && (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-400 ring-2 ring-[#0d1117]" />
          )}
          {open && (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-cyan-400 ring-2 ring-[#0d1117]" />
          )}
        </div>
      </button>

      {/* Panel */}
      <div
        ref={panelRef}
        className={`
          fixed bottom-0 left-0 right-0 z-[9998]
          transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          ${open ? "translate-y-0" : "translate-y-full"}
        `}
        style={{
          height: isMaximized
            ? `${window.innerHeight * MAX_HEIGHT_RATIO}px`
            : `${height}px`,
          // Force dark theme on devtools regardless of app theme
          colorScheme: "dark",
        }}
      >
        {/* The dark-themed container */}
        <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] border-t border-[#1c2433] shadow-[0_-4px_30px_rgba(0,0,0,0.5)]">
          {/* Resize handle */}
          <div
            onMouseDown={onDragStart}
            className="shrink-0 h-1 cursor-row-resize group/resize relative"
          >
            <div className="absolute inset-x-0 -top-1 h-3" />
            <div className="h-full bg-[#1c2433] group-hover/resize:bg-cyan-500/40 transition-colors" />
          </div>

          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-3 h-9 border-b border-[#1c2433] bg-[#0d1117]">
            <div className="flex items-center gap-2.5">
              <Terminal size={13} className="text-cyan-500" strokeWidth={2.5} />
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">
                Devtools
              </span>
              <kbd className="text-[9px] font-mono text-zinc-600 bg-[#161b22] px-1.5 py-0.5 rounded border border-[#1c2433]">
                {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+⇧+D
              </kbd>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMaximized((p) => !p)}
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-[#161b22] transition-colors"
                title={isMaximized ? "Restore" : "Maximize"}
              >
                {isMaximized ? (
                  <Minimize2 size={12} />
                ) : (
                  <Maximize2 size={12} />
                )}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-[#161b22] transition-colors"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <DevtoolsTabs />
          </div>
        </div>
      </div>
    </DevtoolsProvider>
  )
}
