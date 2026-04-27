import { useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Position,
  Handle,
  useNodesState,
  useEdgesState,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import dagre from "@dagrejs/dagre"

import { SiteOverviewTile } from "./tiles/site-overview-tile"
import { ServiceTile } from "./tiles/service-tile"
import { EventsTile } from "./tiles/events-tile"
import { LogsTile } from "./tiles/logs-tile"
import { AgentTile } from "./tiles/agent-tile"
import type {
  ThreadMessage,
  ThreadExchange,
} from "../../factory.threads/data/types"

type TileType = "site-overview" | "health" | "events" | "logs" | "agent"

interface TileNodeData extends Record<string, unknown> {
  tileType: TileType
  label: string
  serviceName?: string
  threadId?: string
  messages?: ThreadMessage[]
  exchanges?: ThreadExchange[]
  threadStatus?: string
  cwd?: string
}

const TILE_WIDTH = 380
const TILE_HEIGHT = 320

function TileNode({ data }: NodeProps<Node<TileNodeData>>) {
  return (
    <div style={{ width: TILE_WIDTH }}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-zinc-400 !h-2 !w-2"
      />
      {data.tileType === "site-overview" && <SiteOverviewTile />}
      {data.tileType === "health" && <ServiceTile />}
      {data.tileType === "events" && <EventsTile />}
      {data.tileType === "logs" && data.serviceName && (
        <LogsTile serviceName={data.serviceName} />
      )}
      {data.tileType === "agent" &&
        data.threadId &&
        data.messages &&
        data.exchanges && (
          <AgentTile
            threadId={data.threadId}
            messages={data.messages as ThreadMessage[]}
            exchanges={data.exchanges as ThreadExchange[]}
            status={data.threadStatus as string | undefined}
            cwd={data.cwd as string | undefined}
          />
        )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-zinc-400 !h-2 !w-2"
      />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  tile: TileNode as any,
}

function layoutWithDagre(
  nodes: Node<TileNodeData>[],
  edges: Edge[]
): { nodes: Node<TileNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: "TB",
    nodesep: 40,
    ranksep: 60,
  })

  for (const node of nodes) {
    g.setNode(node.id, { width: TILE_WIDTH, height: TILE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: {
        x: pos.x - TILE_WIDTH / 2,
        y: pos.y - TILE_HEIGHT / 2,
      },
    }
  })

  return { nodes: laidOut, edges }
}

interface WorkbenchCanvasProps {
  logServices?: string[]
  agents?: Array<{
    threadId: string
    messages: ThreadMessage[]
    exchanges: ThreadExchange[]
    status?: string
    cwd?: string
  }>
}

export function WorkbenchCanvas({
  logServices = [],
  agents = [],
}: WorkbenchCanvasProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node<TileNodeData>[] = [
      {
        id: "site-overview",
        type: "tile",
        position: { x: 0, y: 0 },
        data: { tileType: "site-overview", label: "Site Overview" },
      },
      {
        id: "health",
        type: "tile",
        position: { x: 0, y: 0 },
        data: { tileType: "health", label: "Health" },
      },
      {
        id: "events",
        type: "tile",
        position: { x: 0, y: 0 },
        data: { tileType: "events", label: "Events" },
      },
    ]

    const edges: Edge[] = [
      { id: "e-overview-health", source: "site-overview", target: "health" },
      { id: "e-overview-events", source: "site-overview", target: "events" },
    ]

    for (const svc of logServices) {
      const nodeId = `logs-${svc}`
      nodes.push({
        id: nodeId,
        type: "tile",
        position: { x: 0, y: 0 },
        data: { tileType: "logs", label: `Logs: ${svc}`, serviceName: svc },
      })
      edges.push({
        id: `e-health-${nodeId}`,
        source: "health",
        target: nodeId,
      })
    }

    for (const agent of agents) {
      const nodeId = `agent-${agent.threadId}`
      nodes.push({
        id: nodeId,
        type: "tile",
        position: { x: 0, y: 0 },
        data: {
          tileType: "agent",
          label: `Agent ${agent.threadId.slice(0, 8)}`,
          threadId: agent.threadId,
          messages: agent.messages,
          exchanges: agent.exchanges,
          threadStatus: agent.status,
          cwd: agent.cwd,
        },
      })
      edges.push({
        id: `e-events-${nodeId}`,
        source: "events",
        target: nodeId,
      })
    }

    return layoutWithDagre(nodes, edges)
  }, [logServices, agents])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="h-full w-full rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-zinc-50 dark:!bg-zinc-900"
        />
      </ReactFlow>
    </div>
  )
}
