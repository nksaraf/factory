import { useMemo } from "react"
import { useParams } from "react-router"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  MarkerType,
  Handle,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState } from "@/components/factory"
import { useSystemComponents } from "../../../../../../data/use-build"
import { SystemLayout } from "../system-layout"

const TYPE_COLOR: Record<string, string> = {
  service: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  website: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
  database: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  queue: "border-purple-400 bg-purple-50 dark:bg-purple-950/30",
  cache: "border-red-400 bg-red-50 dark:bg-red-950/30",
  worker: "border-cyan-400 bg-cyan-50 dark:bg-cyan-950/30",
  proxy: "border-zinc-400 bg-zinc-50 dark:bg-zinc-950/30",
  library: "border-pink-400 bg-pink-50 dark:bg-pink-950/30",
}

const TYPE_ICON: Record<string, string> = {
  service: "icon-[ph--gear-duotone]",
  website: "icon-[ph--globe-duotone]",
  database: "icon-[ph--database-duotone]",
  queue: "icon-[ph--queue-duotone]",
  cache: "icon-[ph--lightning-duotone]",
  worker: "icon-[ph--robot-duotone]",
  proxy: "icon-[ph--arrows-split-duotone]",
  library: "icon-[ph--book-open-duotone]",
}

function ComponentNode({
  data,
}: {
  data: { label: string; type: string; ports: any[]; image?: string }
}) {
  const color = TYPE_COLOR[data.type] ?? "border-zinc-300 bg-card"
  const icon = TYPE_ICON[data.type] ?? "icon-[ph--puzzle-piece-duotone]"
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2 !h-2"
      />
      <div
        className={cn(
          "rounded-lg border-2 px-4 py-3 min-w-[160px] shadow-sm",
          color
        )}
      >
        <div className="flex items-center gap-2">
          <Icon icon={icon} className="text-lg text-foreground/70" />
          <div>
            <div className="font-medium text-sm text-foreground">
              {data.label}
            </div>
            <div className="text-xs text-muted-foreground">{data.type}</div>
          </div>
        </div>
        {data.ports.length > 0 && (
          <div className="mt-1.5 flex gap-1 flex-wrap">
            {data.ports.map((p: any, i: number) => (
              <span
                key={i}
                className="text-xs font-mono px-1 py-0.5 rounded bg-background/80 text-muted-foreground"
              >
                :{p.port}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </>
  )
}

const nodeTypes = { component: ComponentNode }

function buildGraph(components: any[]): { nodes: Node[]; edges: Edge[] } {
  const slugMap = new Map<string, string>()
  for (const c of components) {
    slugMap.set(c.slug, c.id ?? c.slug)
    slugMap.set(c.name, c.id ?? c.slug)
    const shortName = (c.name ?? "").split("-").pop() ?? c.name
    slugMap.set(shortName, c.id ?? c.slug)
  }

  const nodes: Node[] = []
  const edges: Edge[] = []
  const cols = Math.max(3, Math.ceil(Math.sqrt(components.length)))

  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const spec = c.spec ?? {}

    nodes.push({
      id: c.id ?? c.slug,
      type: "component",
      position: { x: col * 240, y: row * 160 },
      data: {
        label: c.name ?? c.slug,
        type: c.type ?? "service",
        ports: Array.isArray(spec.ports) ? spec.ports : [],
        image: spec.image,
      },
    })

    const deps = Array.isArray(spec.dependsOn) ? spec.dependsOn : []
    for (const dep of deps) {
      const targetId = slugMap.get(dep)
      if (targetId) {
        edges.push({
          id: `${c.id ?? c.slug}->${targetId}`,
          source: c.id ?? c.slug,
          target: targetId,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#6366f1", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
          label: "depends",
          labelStyle: { fontSize: 10, fill: "#6366f1" },
        })
      }
    }

    const connections = Array.isArray(spec.connectsTo) ? spec.connectsTo : []
    for (const conn of connections) {
      const targetId = slugMap.get(conn)
      if (targetId) {
        edges.push({
          id: `${c.id ?? c.slug}~>${targetId}`,
          source: c.id ?? c.slug,
          target: targetId,
          type: "smoothstep",
          style: {
            stroke: "#22c55e",
            strokeWidth: 1.5,
            strokeDasharray: "5 5",
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#22c55e" },
          label: "connects",
          labelStyle: { fontSize: 10, fill: "#22c55e" },
        })
      }
    }
  }

  return { nodes, edges }
}

export default function SystemGraphTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: components, isLoading } = useSystemComponents(slug)

  const { nodes, edges } = useMemo(() => {
    if (!components || components.length === 0) return { nodes: [], edges: [] }
    return buildGraph(components)
  }, [components])

  return (
    <SystemLayout>
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && nodes.length === 0 && (
        <EmptyState
          icon="icon-[ph--graph-duotone]"
          title="No components to visualize"
        />
      )}
      {nodes.length > 0 && (
        <div className="h-[600px] rounded-lg border bg-card overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{ type: "smoothstep" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls position="bottom-right" />
            <MiniMap
              nodeColor={(n) => {
                const type = n.data?.type as string
                if (type === "service") return "#60a5fa"
                if (type === "website") return "#34d399"
                if (type === "database") return "#fbbf24"
                if (type === "queue") return "#a78bfa"
                if (type === "cache") return "#f87171"
                return "#a1a1aa"
              }}
              position="bottom-left"
            />
          </ReactFlow>
        </div>
      )}
      {edges.length > 0 && (
        <div className="mt-4 flex items-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="w-8 h-0.5 bg-indigo-500" /> dependency (solid)
          </span>
          <span className="flex items-center gap-2">
            <span className="w-8 h-0.5 bg-emerald-500 border-dashed border-t-2 border-emerald-500" />{" "}
            connection (dashed)
          </span>
        </div>
      )}
    </SystemLayout>
  )
}
