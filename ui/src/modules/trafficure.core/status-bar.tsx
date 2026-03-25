import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rio.js/ui/dropdown-menu"
import { Icon } from "@rio.js/ui/icon"
import { fromNow } from "@rio.js/ui/lib/fromnow"

import { useAlertsQuery } from "./data/alerts"
import { useHistoricalAlertsQuery } from "./data/historical-alerts"

export function StatusBar() {
  const { alerts, dataUpdatedAt } = useAlertsQuery()
  const { alerts: resolvedAlerts } = useHistoricalAlertsQuery({}, { key: "resolved_at", sortOrder: "desc" }, "2d")

  // Calculate statistics
  const activeAlertsCount = alerts.length
  const resolvedAlertsCount = resolvedAlerts.filter(
    (alert) => alert.type === "resolved" || alert.type === "suppressed"
  ).length

  // do without library
  const formattedDate = new Date(dataUpdatedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="w-full h-full flex px-4 flex-row items-center justify-between text-sm !font-inter text-scale-1100">
      {/* Left section */}
      <div className="flex flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-2">
          <span>Last Updated:</span>
          <span className="text-green-600 font-medium">
            {fromNow(dataUpdatedAt)} ({formattedDate})
          </span>
        </div>
        {/* <div className="flex flex-row items-center gap-2">
          <span>Total Incidents:</span>
          <span className="text-green-600 font-medium">{goodAlerts}</span>
          <Icon
            icon="icon-[ph--check-circle-duotone]"
            className="text-green-600 text-icon-sm"
          />
        </div>
        <div className="h-4 w-px bg-scale-700" />
        <div className="flex flex-row items-center gap-2">
          <Icon
            icon="icon-[ph--check-circle-duotone]"
            className="text-green-600 text-icon-sm"
          />
          <span>Good Alert</span>
        </div>
        <div className="h-4 w-px bg-scale-700" />
        <div className="flex flex-row items-center gap-2">
          <span>Dismiss:</span>
          <Icon
            icon="icon-[ph--circle-duotone]"
            className="text-scale-900 text-icon-sm"
          />
          <span>
            {dismissTimeHours > 0 ? `>${dismissTimeHours}h` : "<1h"} mins
          </span>
        </div> */}
      </div>

      {/* Right section */}
      <div className="flex flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-2">
          <span>Active Alerts:</span>
          <span className="font-medium text-red-600">{activeAlertsCount}</span>
        </div>
        <div className="h-4 w-px bg-scale-700" />
        <div className="flex flex-row items-center gap-2">
          <span>Resolved Alerts:</span>
          <span className="font-medium text-green-600">
            {resolvedAlertsCount}
          </span>
        </div>
        <div className="h-4 w-px bg-scale-700" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex flex-row items-center gap-2 cursor-pointer">
              <span>System Status</span>
              <div className="w-3 h-3 rounded-full bg-green-600" />
              {/* <Icon
                icon="icon-[ph--caret-down-duotone]"
                className="text-scale-900 text-icon-sm"
              /> */}
            </div>
          </DropdownMenuTrigger>
          {/* <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Icon
                icon="icon-[ph--check-circle]"
                className="text-icon-md mr-2"
              />
              <span>All Systems Operational</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Icon icon="icon-[ph--info]" className="text-icon-md mr-2" />
              <span>View System Details</span>
            </DropdownMenuItem>
          </DropdownMenuContent> */}
        </DropdownMenu>
      </div>
    </div>
  )
}
