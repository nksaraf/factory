import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import { useCallback, useMemo } from "react"

import "@xyflow/react/dist/style.css"

import { Activity, Check, Circle } from "lucide-react"

import type { ResourceDetail } from "../../types"

// ─── Step data ───────────────────────────────────────────────────────────────

interface StepData {
  label: string
  stepType: string
  status: "done" | "running" | "pending"
  [key: string]: unknown
}

const STATUS_COLORS: Record<string, string> = {
  done: "#16a34a",
  running: "#3b82f6",
  pending: "#d1d5db",
}

// ─── Custom node ─────────────────────────────────────────────────────────────

function PipelineStepNode({ data }: NodeProps<Node<StepData>>) {
  const color = STATUS_COLORS[data.status] ?? STATUS_COLORS.pending

  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-xl border-2 bg-card px-5 py-3 shadow-sm"
      style={{
        borderColor: color,
        boxShadow:
          data.status === "running" ? `0 0 0 4px ${color}20` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-border" />

      <div className="flex items-center gap-2">
        {data.status === "done" && (
          <Check className="h-4 w-4" style={{ color }} />
        )}
        {data.status === "running" && (
          <Activity className="h-4 w-4 animate-pulse" style={{ color }} />
        )}
        {data.status === "pending" && (
          <Circle className="h-3 w-3 fill-muted-foreground/30 text-muted-foreground/30" />
        )}
        <span className="text-sm font-semibold text-foreground">
          {data.label}
        </span>
      </div>

      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {data.stepType}
      </span>

      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  )
}

const nodeTypes = { pipelineStep: PipelineStepNode }

// ─── Default mock steps ──────────────────────────────────────────────────────

const DEFAULT_STEPS: {
  name: string
  type: string
  status: StepData["status"]
}[] = [
  { name: "Ingest from S3", type: "source", status: "done" },
  { name: "Clean & Geocode", type: "transform", status: "done" },
  { name: "H3 Spatial Join", type: "transform", status: "done" },
  { name: "MOS Scoring", type: "model", status: "running" },
  { name: "Write Results", type: "sink", status: "pending" },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function PipelineView({
  resource,
}: {
  resource: ResourceDetail
}) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const steps = DEFAULT_STEPS
    const Y = 100
    const X_GAP = 220

    const nodes: Node<StepData>[] = steps.map((s, i) => ({
      id: `step-${i}`,
      type: "pipelineStep",
      position: { x: 60 + i * X_GAP, y: Y },
      data: { label: s.name, stepType: s.type, status: s.status },
    }))

    const edges: Edge[] = steps.slice(1).map((_, i) => ({
      id: `e-${i}`,
      source: `step-${i}`,
      target: `step-${i + 1}`,
      animated: steps[i].status === "running",
      style: {
        stroke:
          steps[i].status === "done"
            ? STATUS_COLORS.done
            : STATUS_COLORS.pending,
        strokeWidth: 2,
      },
    }))

    return { initialNodes: nodes, initialEdges: edges }
  }, [])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b bg-background px-4 py-2.5">
        <button className="rounded-md border border-pink-300 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-500 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-400">
          &#x25B6; Running
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          Last run: 3h ago &middot; Duration: 4m 12s
        </span>
      </div>

      {/* Flow canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable={false}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
