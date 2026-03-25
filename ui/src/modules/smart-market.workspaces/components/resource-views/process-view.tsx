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
import { useMemo } from "react"

import "@xyflow/react/dist/style.css"

import type { ResourceDetail } from "../../types"

// ─── Node data types ─────────────────────────────────────────────────────────

interface StepNodeData {
  label: string
  sub?: string
  color: string
  [key: string]: unknown
}

interface BranchLabelData {
  label: string
  color: string
  [key: string]: unknown
}

// ─── Custom nodes ────────────────────────────────────────────────────────────

function ProcessStepNode({ data }: NodeProps<Node<StepNodeData>>) {
  return (
    <div
      className="min-w-[180px] rounded-xl border-2 bg-card px-5 py-2.5 text-center shadow-sm"
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="text-[13px] font-semibold text-foreground">
        {data.label}
      </div>
      {data.sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {data.sub}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  )
}

function BranchLabelNode({ data }: NodeProps<Node<BranchLabelData>>) {
  return (
    <div
      className="rounded-full px-3 py-0.5 text-[11px] font-semibold"
      style={{
        color: data.color,
        background: `${data.color}15`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-transparent !border-none !w-0 !h-0"
      />
      {data.label}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-transparent !border-none !w-0 !h-0"
      />
    </div>
  )
}

const nodeTypes = {
  processStep: ProcessStepNode,
  branchLabel: BranchLabelNode,
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProcessView({
  resource,
}: {
  resource: ResourceDetail
}) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const X_CENTER = 300
    const Y_GAP = 90
    let y = 40

    const nodes: Node[] = []
    const edges: Edge[] = []

    // Linear steps
    const linearSteps = [
      {
        label: "Trigger: New High-MOS Site",
        color: "#f59e0b",
      },
      {
        label: "Notify Expansion Team",
        sub: "Slack",
        color: "#6366f1",
      },
      {
        label: "Manager Approval",
        sub: "Human-in-the-loop",
        color: "#f97316",
      },
    ]

    linearSteps.forEach((s, i) => {
      nodes.push({
        id: `step-${i}`,
        type: "processStep",
        position: { x: X_CENTER - 90, y },
        data: { label: s.label, sub: s.sub, color: s.color },
      })
      if (i > 0) {
        edges.push({
          id: `e-step-${i}`,
          source: `step-${i - 1}`,
          target: `step-${i}`,
          style: { stroke: "#d1d5db", strokeWidth: 2 },
        })
      }
      y += Y_GAP
    })

    // Branch definitions
    const branches = [
      {
        label: "Approved",
        color: "#16a34a",
        xOffset: -140,
        steps: [
          { label: "Schedule Site Visit", sub: "Google Calendar" },
          { label: "Create Task", sub: "Jira" },
        ],
      },
      {
        label: "Rejected",
        color: "#dc2626",
        xOffset: 140,
        steps: [
          { label: "Log Rejection Reason", sub: "SmartMarket" },
          { label: "Archive Site", sub: "Dataset update" },
        ],
      },
    ]

    const lastLinearId = `step-${linearSteps.length - 1}`
    y += 20

    branches.forEach((b, bi) => {
      const branchLabelId = `branch-label-${bi}`
      nodes.push({
        id: branchLabelId,
        type: "branchLabel",
        position: { x: X_CENTER - 90 + b.xOffset, y },
        data: { label: b.label, color: b.color },
      })
      edges.push({
        id: `e-branch-${bi}`,
        source: lastLinearId,
        target: branchLabelId,
        style: { stroke: b.color, strokeWidth: 2 },
      })

      let by = y + 50
      b.steps.forEach((s, si) => {
        const stepId = `branch-${bi}-step-${si}`
        nodes.push({
          id: stepId,
          type: "processStep",
          position: { x: X_CENTER - 90 + b.xOffset - 30, y: by },
          data: { label: s.label, sub: s.sub, color: b.color },
        })
        edges.push({
          id: `e-branch-${bi}-step-${si}`,
          source: si === 0 ? branchLabelId : `branch-${bi}-step-${si - 1}`,
          target: stepId,
          style: { stroke: b.color, strokeWidth: 2 },
        })
        by += Y_GAP
      })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b bg-background px-4 py-2.5">
        <button className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-500 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-400">
          Edit Process
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          3 integrations &middot; 1 approval step &middot; 2 branches
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
