import type { ResourceType } from "../types"

export interface ResourceTypeConfig {
  icon: string
  /** @deprecated Use iconClass + bgClass instead for theme-aware rendering */
  color: string
  /** @deprecated Use iconClass + bgClass instead for theme-aware rendering */
  bg: string
  label: string
  iconClass: string
  bgClass: string
}

export const RESOURCE_TYPE_CONFIG: Record<ResourceType, ResourceTypeConfig> = {
  folder: {
    icon: "icon-[ph--folder-duotone]",
    color: "#6b7280",
    bg: "#f3f4f6",
    label: "Folder",
    iconClass: "text-gray-500",
    bgClass: "bg-gray-100",
  },
  dataset: {
    icon: "icon-[ph--database-duotone]",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    label: "Dataset",
    iconClass: "text-violet-500",
    bgClass: "bg-violet-50",
  },
  map: {
    icon: "icon-[ph--map-trifold-duotone]",
    color: "#3b82f6",
    bg: "#eff6ff",
    label: "Map",
    iconClass: "text-blue-500",
    bgClass: "bg-blue-50",
  },
  dashboard: {
    icon: "icon-[ph--squares-four-duotone]",
    color: "#f59e0b",
    bg: "#fffbeb",
    label: "Dashboard",
    iconClass: "text-amber-500",
    bgClass: "bg-amber-50",
  },
  report: {
    icon: "icon-[ph--file-text-duotone]",
    color: "#10b981",
    bg: "#ecfdf5",
    label: "Report",
    iconClass: "text-emerald-500",
    bgClass: "bg-emerald-50",
  },
  pipeline: {
    icon: "icon-[ph--git-branch-duotone]",
    color: "#ec4899",
    bg: "#fdf2f8",
    label: "Pipeline",
    iconClass: "text-pink-500",
    bgClass: "bg-pink-50",
  },
  process: {
    icon: "icon-[ph--flow-arrow-duotone]",
    color: "#f97316",
    bg: "#fff7ed",
    label: "Process",
    iconClass: "text-orange-500",
    bgClass: "bg-orange-50",
  },
  ontology: {
    icon: "icon-[ph--brain-duotone]",
    color: "#6366f1",
    bg: "#eef2ff",
    label: "Ontology",
    iconClass: "text-indigo-500",
    bgClass: "bg-indigo-50",
  },
  agent_session: {
    icon: "icon-[ph--robot-duotone]",
    color: "#14b8a6",
    bg: "#f0fdfa",
    label: "Agent Session",
    iconClass: "text-teal-500",
    bgClass: "bg-teal-50",
  },
}

export const CREATE_RESOURCE_TYPES: ResourceType[] = [
  "folder",
  "dataset",
  "map",
  "dashboard",
  "report",
  "pipeline",
  "process",
  "ontology",
  "agent_session",
]
