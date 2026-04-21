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
import dagre from "@dagrejs/dagre"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState } from "@/components/factory"
import { useSystemComponents } from "../../../../../../data/use-build"
import {
  COMPONENT_KIND_COLOR,
  COMPONENT_KIND_DOT,
  COMPONENT_KIND_ICON,
  inferComponentKind,
} from "../../../../../../data/component-kind"
import { SystemLayout } from "../system-layout"

function ComponentNode({
  data,
}: {
  data: { label: string; type: string; ports: any[]; image?: string }
}) {
  const color = COMPONENT_KIND_COLOR[data.type] ?? "border-zinc-300 bg-card"
  const icon = COMPONENT_KIND_ICON[data.type] ?? "icon-[ph--cube-duotone]"
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

const NODE_WIDTH = 200
const NODE_HEIGHT = 80

const LAYER_RANK: Record<string, number> = {
  website: 0,
  cli: 0,
  gateway: 1,
  proxy: 1,
  service: 2,
  worker: 2,
  agent: 2,
  task: 2,
  cronjob: 2,
  library: 2,
  database: 3,
  queue: 3,
  cache: 3,
  storage: 3,
  search: 3,
}

function typeRank(type: string): number {
  return LAYER_RANK[type] ?? 2
}

function inferConnections(c: any, allNames: Set<string>): string[] {
  const spec = c.spec ?? {}
  const targets = new Set<string>()
  const selfName = c.name ?? c.slug

  // 1. Explicit connectsTo
  if (Array.isArray(spec.connectsTo)) {
    for (const t of spec.connectsTo) targets.add(t)
  }

  // 2. depEnv keys — each key is a dependency this component connects to
  if (spec.depEnv && typeof spec.depEnv === "object") {
    for (const dep of Object.keys(spec.depEnv)) targets.add(dep)
  }

  // 3. consumesApis — implies connection to the providing component
  if (Array.isArray(spec.consumesApis)) {
    for (const api of spec.consumesApis) targets.add(api)
  }

  // 4. Gateway targets
  if (Array.isArray(spec.gatewayTargets)) {
    for (const gt of spec.gatewayTargets) {
      if (gt.service) targets.add(gt.service)
    }
  }

  // 5. Environment variable scanning — match service names in env values
  const env: Record<string, string> = spec.environment ?? {}
  for (const v of Object.values(env)) {
    if (typeof v !== "string") continue
    for (const svc of allNames) {
      if (svc !== selfName && v.includes(svc)) {
        targets.add(svc)
      }
    }
  }

  targets.delete(selfName)
  return [...targets]
}

function buildGraph(components: any[]): { nodes: Node[]; edges: Edge[] } {
  const allNames = new Set<string>()
  const slugMap = new Map<string, string>()
  const typeMap = new Map<string, string>()
  for (const c of components) {
    const nodeId = c.id ?? c.slug
    const name = c.name ?? c.slug
    allNames.add(name)
    allNames.add(c.slug)
    slugMap.set(c.slug, nodeId)
    slugMap.set(name, nodeId)
    const shortName = name.split("-").pop() ?? name
    slugMap.set(shortName, nodeId)
    typeMap.set(nodeId, inferComponentKind(c))
  }

  const nodes: Node[] = []
  const depEdges: Edge[] = []
  const connectionEdges: Edge[] = []
  const depPairs = new Set<string>()
  const connPairs = new Set<string>()

  for (const c of components) {
    const spec = c.spec ?? {}
    const nodeId = c.id ?? c.slug

    nodes.push({
      id: nodeId,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label: c.name ?? c.slug,
        type: inferComponentKind(c),
        ports: Array.isArray(spec.ports) ? spec.ports : [],
        image: spec.image,
      },
    })

    // Dependencies (solid edges, drive layout)
    const deps = Array.isArray(spec.dependsOn) ? spec.dependsOn : []
    for (const dep of deps) {
      const targetId = slugMap.get(dep)
      if (targetId && targetId !== nodeId) {
        depPairs.add(`${nodeId}::${targetId}`)
        depEdges.push({
          id: `${nodeId}->${targetId}`,
          source: nodeId,
          target: targetId,
          type: "default",
          style: { stroke: "#6366f1", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
          label: "depends on",
          labelStyle: { fontSize: 10, fill: "#6366f1" },
        })
      }
    }

    // Connections (dashed edges, inferred from env vars, depEnv, gateway targets, etc.)
    const connections = inferConnections(c, allNames)
    for (const conn of connections) {
      const targetId = slugMap.get(conn)
      const pairKey = `${nodeId}::${targetId}`
      if (
        targetId &&
        targetId !== nodeId &&
        !depPairs.has(pairKey) &&
        !connPairs.has(pairKey)
      ) {
        connPairs.add(pairKey)
        connectionEdges.push({
          id: `${nodeId}~>${targetId}`,
          source: nodeId,
          target: targetId,
          type: "default",
          style: {
            stroke: "#a78bfa",
            strokeWidth: 1.5,
            strokeDasharray: "6 4",
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#a78bfa" },
          label: "connects to",
          labelStyle: { fontSize: 10, fill: "#a78bfa" },
        })
      }
    }
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of depEdges) {
    g.setEdge(edge.source, edge.target)
  }

  // Add invisible edges between layer anchors to enforce type-based layering:
  // apps (website) → proxy → services/workers → resources (db/queue/cache)
  const layerGroups: Map<number, string[]> = new Map()
  for (const node of nodes) {
    const rank = typeRank(typeMap.get(node.id) ?? "service")
    if (!layerGroups.has(rank)) layerGroups.set(rank, [])
    layerGroups.get(rank)!.push(node.id)
  }
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b)
  for (let i = 0; i < sortedLayers.length - 1; i++) {
    const upper = layerGroups.get(sortedLayers[i])!
    const lower = layerGroups.get(sortedLayers[i + 1])!
    g.setEdge(upper[0], lower[0], { minlen: 1, weight: 0 })
  }

  dagre.layout(g)

  for (const node of nodes) {
    const pos = g.node(node.id)
    node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
  }

  return { nodes, edges: [...depEdges, ...connectionEdges] }
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
            defaultEdgeOptions={{ type: "default" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls position="bottom-right" />
            <MiniMap
              nodeColor={(n) =>
                COMPONENT_KIND_DOT[n.data?.type as string] ?? "#a1a1aa"
              }
              position="bottom-left"
            />
          </ReactFlow>
        </div>
      )}
      {edges.length > 0 && (
        <div className="mt-4 flex items-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="w-8 h-0.5 bg-indigo-500" /> depends on (solid)
          </span>
          <span className="flex items-center gap-2">
            <span className="w-8 h-0.5 border-dashed border-t-2 border-purple-400" />{" "}
            connects to (dashed)
          </span>
        </div>
      )}
    </SystemLayout>
  )
}
