import {
  HardDrive,
  Layers,
  Puzzle,
  Route,
  Shield,
  Variable,
  Zap,
} from "lucide-react"
import { useState } from "react"

import { AuthInspector } from "./inspectors/auth-inspector"
import { EnvInspector } from "./inspectors/env-inspector"
import { ExtensionsInspector } from "./inspectors/extensions-inspector"
import { QueryInspector } from "./inspectors/query-inspector"
import { RouterInspector } from "./inspectors/router-inspector"
import { ServicesInspector } from "./inspectors/services-inspector"
import { StorageInspector } from "./inspectors/storage-inspector"

const tabs = [
  { id: "router", label: "Router", icon: Route, component: RouterInspector },
  {
    id: "extensions",
    label: "Extensions",
    icon: Puzzle,
    component: ExtensionsInspector,
  },
  { id: "env", label: "Env", icon: Variable, component: EnvInspector },
  {
    id: "storage",
    label: "Storage",
    icon: HardDrive,
    component: StorageInspector,
  },
  { id: "auth", label: "Auth", icon: Shield, component: AuthInspector },
  {
    id: "services",
    label: "Services",
    icon: Layers,
    component: ServicesInspector,
  },
  { id: "query", label: "Queries", icon: Zap, component: QueryInspector },
] as const

export function DevtoolsTabs() {
  const [activeTab, setActiveTab] = useState(
    () => localStorage.getItem("devtools:tab") || "router"
  )

  function selectTab(id: string) {
    setActiveTab(id)
    localStorage.setItem("devtools:tab", id)
  }

  const ActiveComponent =
    tabs.find((t) => t.id === activeTab)?.component ?? RouterInspector

  return (
    <div className="flex h-full">
      {/* Icon tab rail */}
      <div className="w-11 shrink-0 border-r border-[#1c2433] bg-[#0a0e14] flex flex-col py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              title={tab.label}
              className={`
                relative mx-1 mb-0.5 flex items-center justify-center
                h-8 rounded-lg transition-all duration-150
                ${
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "text-zinc-600 hover:text-zinc-400 hover:bg-[#161b22]"
                }
              `}
            >
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-cyan-400" />
              )}
              <Icon size={15} strokeWidth={isActive ? 2.2 : 1.8} />
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab label bar */}
        <div className="shrink-0 h-8 border-b border-[#1c2433] bg-[#0a0e14]/50 flex items-center px-3">
          <span className="text-[11px] font-semibold text-zinc-400 tracking-wide">
            {tabs.find((t) => t.id === activeTab)?.label}
          </span>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-4 devtools-scrollbar">
          <ActiveComponent />
        </div>
      </div>
    </div>
  )
}
