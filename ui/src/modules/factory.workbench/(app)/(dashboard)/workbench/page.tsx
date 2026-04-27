import { useCallback, useState } from "react"
import { useWorkbenchClient, WorkbenchProvider } from "@/lib/workbench-rpc"
import { useMutation } from "@tanstack/react-query"
import { SiteOverviewTile } from "../../../components/tiles/site-overview-tile"
import { ServiceTile } from "../../../components/tiles/service-tile"
import { EventsTile } from "../../../components/tiles/events-tile"
import { LogsTile } from "../../../components/tiles/logs-tile"
import { WorkbenchCanvas } from "../../../components/workbench-canvas"
import { FileTreePanel } from "../../../components/file-tree-panel"

type ViewMode = "dashboard" | "canvas"

function WorkbenchDashboard() {
  const [selectedService, setSelectedService] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SiteOverviewTile />
        <ServiceTile />
        <EventsTile />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">Service Logs</h2>
          <input
            type="text"
            value={selectedService ?? ""}
            onChange={(e) => setSelectedService(e.target.value || null)}
            placeholder="Enter service name..."
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        {selectedService && <LogsTile serviceName={selectedService} />}
      </div>
    </div>
  )
}

function FileViewer({
  path,
  content,
  language,
}: {
  path: string
  content: string
  language: string
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="icon-[ph--file-text-duotone] h-4 w-4 text-zinc-500" />
        <span className="flex-1 truncate text-sm font-medium">{path}</span>
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
          {language}
        </span>
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
        {content}
      </pre>
    </div>
  )
}

function WorkbenchContent({ viewMode }: { viewMode: ViewMode }) {
  const readFile = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(
        `/api/v1/workbench/readfile?path=${encodeURIComponent(path)}`
      )
      return res.json() as Promise<{
        path: string
        content: string
        language: string
        error?: string
      }>
    },
  })
  const [openFile, setOpenFile] = useState<{
    path: string
    content: string
    language: string
  } | null>(null)

  const handleFileSelect = useCallback(
    (path: string) => {
      readFile.mutate(path, {
        onSuccess: (data) => {
          if (data.error) return
          setOpenFile({
            path: data.path,
            content: data.content,
            language: data.language,
          })
        },
      })
    },
    [readFile]
  )

  return (
    <div className="flex flex-1 gap-0 overflow-hidden">
      <div className="w-64 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <FileTreePanel onFileSelect={handleFileSelect} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {openFile ? (
          <div className="mb-4">
            <FileViewer {...openFile} />
          </div>
        ) : null}

        {viewMode === "dashboard" ? (
          <WorkbenchDashboard />
        ) : (
          <WorkbenchCanvas logServices={[]} agents={[]} />
        )}
      </div>
    </div>
  )
}

export default function WorkbenchPage() {
  const [agentUrl, setAgentUrl] = useState(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("workbench-agent-url") ?? "http://localhost:4401")
      : "http://localhost:4401"
  )
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard")
  const connection = useWorkbenchClient(agentUrl)

  return (
    <WorkbenchProvider value={connection}>
      <div className="flex flex-col" style={{ height: "calc(100vh - 3.5rem)" }}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <span
            className={`h-2 w-2 rounded-full ${
              connection.status === "connected"
                ? "bg-emerald-500"
                : connection.status === "error"
                  ? "bg-red-500"
                  : "bg-zinc-400"
            }`}
          />
          <span className="text-xs text-zinc-500">
            {connection.status === "connected"
              ? "Connected"
              : connection.status === "error"
                ? "Error"
                : "Disconnected"}
          </span>

          <h1 className="ml-2 text-base font-semibold">Workbench</h1>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded border border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => setViewMode("dashboard")}
                className={`px-3 py-1 text-xs ${
                  viewMode === "dashboard"
                    ? "bg-zinc-100 font-medium dark:bg-zinc-800"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <span className="icon-[ph--squares-four] mr-1 inline-block h-3.5 w-3.5 align-middle" />
                Grid
              </button>
              <button
                onClick={() => setViewMode("canvas")}
                className={`px-3 py-1 text-xs ${
                  viewMode === "canvas"
                    ? "bg-zinc-100 font-medium dark:bg-zinc-800"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <span className="icon-[ph--graph-duotone] mr-1 inline-block h-3.5 w-3.5 align-middle" />
                Canvas
              </button>
            </div>

            <input
              type="text"
              value={agentUrl}
              onChange={(e) => {
                setAgentUrl(e.target.value)
                localStorage.setItem("workbench-agent-url", e.target.value)
              }}
              className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              style={{ width: 240 }}
            />
          </div>
        </div>

        <WorkbenchContent viewMode={viewMode} />
      </div>
    </WorkbenchProvider>
  )
}
