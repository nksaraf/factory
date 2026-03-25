import { useNavigate, useParams } from "react-router"
import { titleCase } from "scule"

import { ExtensionView } from "@rio.js/app-ui/components/extension-view"
import { useQuery } from "@rio.js/client"
import { Badge } from "@rio.js/ui/badge"
import { Button } from "@rio.js/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@rio.js/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rio.js/ui/dropdown-menu"
import { Icon } from "@rio.js/ui/icon"

import {
  type AlertApiResponse,
  getAlertById,
  transformApiAlertToAlert,
} from "./alerts-data"
import { formatDecimal } from "./utils/format-number"
import { AlertFocus } from "./alert-focus"
import { MiniGraph, alertTypeConfig } from "./alerts-inbox"
import { Portkey } from "@rio.js/tunnel"
import { MapSwitcher } from "./map-switcher"

// Gauge component for congestion level
function CongestionGauge({ value, max = 5 }: { value: number; max?: number }) {
  const normalizedValue = Math.min(Math.max(value / max, 0), 1)
  // Angle ranges from -90 (left) to 90 (right) degrees for semi-circle
  const angle = -90 + normalizedValue * 180
  const centerX = 50
  const centerY = 50

  return (
    <svg
      className="w-full h-24"
      viewBox="0 0 100 60"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" /> {/* green */}
          <stop offset="33%" stopColor="#eab308" /> {/* yellow */}
          <stop offset="66%" stopColor="#f97316" /> {/* orange */}
          <stop offset="100%" stopColor="#ef4444" /> {/* red */}
        </linearGradient>
      </defs>
      {/* Semi-circular background arc */}
      <path
        d={`M 10 50 A 40 40 0 0 1 90 50`}
        stroke="url(#gauge-gradient)"
        strokeWidth="12"
        fill="none"
        strokeLinecap="round"
      />
      {/* Needle */}
      <g transform={`translate(${centerX}, ${centerY}) rotate(${angle})`}>
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-35"
          stroke="#6b7280"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Needle center dot */}
        <circle cx="0" cy="0" r="2.5" fill="#6b7280" />
      </g>
    </svg>
  )
}

export function AlertDetailView() {
  const { alertId } = useParams()
  const navigate = useNavigate()

  // Fetch alerts from API
  const { data: apiResponse } = useQuery<AlertApiResponse>({
    queryKey: ["alerts", "active"],
    queryFn: async () => {
      const response = await fetch(
        "https://api.traffic.management.rio.software/api/alerts/active"
      )
      if (!response.ok) {
        throw new Error("Failed to fetch alerts")
      }
      return response.json()
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  // Transform and find alert
  const alerts = apiResponse?.alerts.map(transformApiAlertToAlert) || []
  const alert = alertId ? getAlertById(alertId, alerts) : null

  if (!alert) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Alert not found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Map Section */}
      <div className="border-b relative">
        <div className="px-3 p-2 flex flex-row items-center gap-2 text-md font-medium border-b border-scale-700">
          <div className="flex flex-row items-center gap-2 flex-1">
            <span className="icon-[ph--alarm-duotone] text-icon-xl text-red-500"></span>
            <div className="flex flex-col -space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span>{alert.location}</span>
                <Badge
                  variant={alertTypeConfig[alert.alertType].color as any}
                  className="text-xs font-semibold shrink-0"
                >
                  <Icon
                    icon={alertTypeConfig[alert.alertType].icon}
                    className="text-icon-sm mr-1"
                  />
                  {alertTypeConfig[alert.alertType].label}
                </Badge>
              </div>
              <span className="text-xs text-scale-1000">
                {alert.landmark ? `(${alert.landmark}) • ` : ""}
                {alert.roadName} • {alertTypeConfig[alert.alertType].label}
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="primary"
                size="tiny"
                className="ml-auto"
                icon="icon-[ph--play-duotone]"
              >
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>
                <Icon icon="icon-[ph--arrow-right]" className="text-icon-md" />
                <span>Live Drone View</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* <AlertFocus alertId={alertId!} /> */}

        {/* <div className="absolute top-4 right-4 z-10">
          <Button variant="outline" size="sm">
            Live Drone View
          </Button>
        </div> */}
      </div>
      <div className="flex-1 h-full flex flex-col px-2 py-2 space-y-2 bg-scale-400">
        <div className="flex-1 bg-scale-400 rounded-sm">
          <ExtensionView
            src="gis.core.views.map"
            props={{
              mapId: "main",
              className: "h-full rounded-sm",
              contextMenuItems: <></>,
              renderers: {},
              floatingLayoutClassName: "p-0",
            }}
            
          />
        </div>

        {/* Vitals Strip */}
        <div className="grid grid-cols-4 grid-rows-2 flex-1 gap-2">
          {/* Congestion Level - Large Card */}
          <Card className="rounded-sm flex flex-col row-span-2">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Congestion Level</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-end gap-2 py-2 pb-8 flex-1">
              <CongestionGauge value={alert.congestionLevel || 0} />
              <p className="text-3xl font-bold text-destructive">
                <span className="font-mono">
                  {formatDecimal(alert.congestionLevel)}
                </span>
                x
              </p>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Moves at{" "}
                  <span className="font-mono">
                    {formatDecimal(alert.liveSpeedKmph)}
                  </span>{" "}
                  km/h
                </p>
                <p className="text-xs text-muted-foreground">
                  Velocity decay:{" "}
                  <span className="font-mono">
                    {formatDecimal(alert.velocityDecay)}
                  </span>{" "}
                  km/h
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Impact</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 px-3 py-2 pb-4 flex-1">
              {/* <div className="flex flex-col items-center justify-center w-24 h-16 flex-shrink-0 bg-scale-200 rounded border border-scale-500">
                <p className="text-xs text-muted-foreground text-center">
                  Time Lost
                </p>
                <p className="text-lg font-bold">
                  <span className="font-mono">
                    {((alert.totalPain * 1000) / 60).toFixed(0)}
                  </span>
                  m
                </p>
              </div> */}
              <div className="flex flex-col flex-1 items-end gap-2">
                <Badge
                  variant="outline"
                  className="border-red-500 text-red-500 bg-red-100/50 rounded-sm text-xs w-fit mt-1"
                >
                  High Impact
                </Badge>
                <div className="flex flex-col flex-1 items-end gap-0">
                  <p className="text-2xl font-bold text-red-500">
                    +
                    <span className="font-mono">
                      {formatDecimal(alert.impactMinutes)}
                    </span>
                    m
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Est. delay per vehicle
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Abnormality</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 p-2 pb-4 flex-1">
              <div className="flex items-end h-16 w-24 flex-shrink-0">
                <div
                  className="w-full bg-scale-300 border border-scale-700 rounded-t"
                  style={{
                    height: `${Math.min((alert.saturationIndex || 0) * 15, 100)}%`,
                  }}
                />
                <div
                  className="w-full bg-scale-300 border border-scale-700 rounded-t"
                  style={{
                    height: `${Math.min((alert.saturationIndex || 0) * 10, 100)}%`,
                  }}
                />
                <div
                  className="w-full bg-scale-300 border border-scale-700 rounded-t"
                  style={{
                    height: `${Math.min((alert.saturationIndex || 0) * 20, 100)}%`,
                  }}
                />
                <div
                  className="w-full bg-red-300 border border-red-500 rounded-t"
                  style={{
                    height: `${Math.min((alert.saturationIndex || 0) * 25, 100)}%`,
                  }}
                />
              </div>
              <div className="flex flex-col flex-1 items-end text-right">
                <p className="text-2xl font-bold">
                  <span className="font-mono">
                    {formatDecimal(alert.saturationIndex)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Saturation Index
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Road Length Affected</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 px-3 py-2 pb-4 flex-1">
              <div className="flex-shrink-0 w-24 h-16 flex items-center justify-center bg-scale-200 rounded border border-scale-700">
                <Icon
                  icon="icon-[hugeicons--road]"
                  className="text-icon-2xl text-scale-700"
                />
              </div>
              <div className="flex flex-col flex-1 text-right items-end">
                <p className="text-2xl font-bold">
                  <span className="font-mono">
                    {alert.geometry.coordinates.length > 0 ? "~" : "0.0"}
                  </span>{" "}
                  {alert.geometry.coordinates.length > 0 ? "segments" : "km"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {alert.geometry.coordinates.length} coordinates
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Momentum</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 px-3 py-2 pb-4 flex-1">
              <div className="flex-shrink-0 w-16">
                {/* Traffic flow data not available in API - showing placeholder */}
                <div className="w-full h-9 bg-scale-200 rounded border border-scale-700 flex items-center justify-center">
                  <span className="text-xs text-scale-600">N/A</span>
                </div>
              </div>
              <div className="flex flex-col flex-1 gap-2 items-end text-right">
                <Badge
                  variant="outline"
                  className="border-red-500 text-red-500 bg-red-100/50 rounded-sm text-xs w-fit mt-1"
                >
                  Rapid Deceleration
                </Badge>
                <p className="text-2xl font-bold text-destructive">
                  <span className="font-mono">
                    {formatDecimal(alert.velocityDecay)}
                  </span>{" "}
                  km/h
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Police Station</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 px-3 py-2 pb-4 flex-1">
              <div className="flex-shrink-0 w-24 h-16 flex items-center justify-center bg-scale-200 rounded border border-scale-700">
                <Icon
                  icon="icon-[hugeicons--police-station]"
                  className="text-icon-2xl text-scale-700"
                />
              </div>
              <div className="flex flex-col items-end text-right flex-1">
                <p className="text-xs text-scale-1000 font-medium">
                  {alert.roadName.split("/")[0] || "N/A"}
                </p>
                <p className="text-2xl font-medium leading-tight">
                  {alert.roadId.slice(0, 8) || "N/A"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-sm flex flex-col">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <span>Officer In Charge</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-row items-end gap-3 px-3 py-2 pb-4 flex-1">
              <div className="flex-shrink-0 w-24 h-16 flex items-center justify-center bg-scale-200 rounded border border-scale-700">
                <img
                  src="/police.jpg"
                  className="w-full h-full object-contain rounded-sm"
                />
              </div>
              <div className="flex flex-col flex-1 text-right items-end">
                <p className="text-2xl font-medium leading-tight">
                  <span className="text-sm text-scale-1000">Alert ID</span>{" "}
                  {alert.alertId}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Root Cause & Actions */}
        <div className="grid grid-cols-2 gap-2 overflow-y-auto">
          {/* Root Cause */}
          <Card className="rounded-sm">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <Icon
                  icon="icon-[hugeicons--traffic-jam]"
                  className="text-icon-sm"
                />
                <span>Root Cause</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="flex items-start gap-2">
                <span className="text-destructive text-lg icon-[ic--twotone-minor-crash]"></span>
                <p className="text-sm">{alert.reason}</p>
              </div>
            </CardContent>
          </Card>

          {/* Recommended Actions */}
          <Card className="rounded-sm">
            <CardHeader className="p-0">
              <CardTitle className="flex flex-row items-center rounded-t-sm w-full text-base font-normal spacing-2 bg-scale-200 border-b py-2 px-3 border-scale-700 text-scale-1100">
                <Icon
                  icon="icon-[hugeicons--traffic-jam]"
                  className="text-icon-sm"
                />
                <span>Recommended Actions</span>
                <div className="ml-auto flex items-center gap-1">
                  <Icon
                    icon="icon-[ph--question-duotone]"
                    className="text-icon-md"
                  />
                  <Icon
                    icon="icon-[ph--arrow-right]"
                    className="text-icon-md"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-x-2 flex flex-row p-2">
              {/* Recommendations not available in API - showing default actions */}
              {["Monitor", "Investigate", "Dispatch"].map((action, index) => {
                const variant =
                  index === 0 ? "default" : index === 1 ? "outline" : "ghost"
                const buttonVariant =
                  index === 0
                    ? "alternativeScale"
                    : index === 1
                      ? "danger"
                      : "warning"

                return (
                  <Button
                    key={action}
                    variant={buttonVariant}
                    className="w-full h-full justify-center flex-1"
                  >
                    {titleCase(action.toLowerCase().replace(/ /g, "_"))}
                    {/* {index < 2 && (
                      <Badge variant="secondary" className="ml-auto">
                        Enabled
                      </Badge>
                    )} */}
                  </Button>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
