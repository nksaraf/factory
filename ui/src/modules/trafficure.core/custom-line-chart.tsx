import React from "react"
import {
  Area,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@rio.js/ui/charts"

// Types
export interface ChartDataPoint {
  time: string
  timestamp: number
  [key: string]: number | string
}

export interface LineConfig {
  dataKey: string
  name: string
  stroke: string
  strokeWidth?: number
  strokeDasharray?: string
  dot?: boolean | React.ComponentType<any> | ((props: any) => React.ReactNode)
  activeDot?: boolean | object
  type?: "monotone" | "linear" | "step"
}

export interface ReferenceLineConfig {
  type: "vertical" | "horizontal"
  value: string | number
  stroke: string
  strokeWidth?: number
  strokeDasharray?: string
  label?: string | {
    value: string
    position?: "top" | "bottom" | "left" | "right"
    fill?: string
    fontSize?: number
  }
  isFront?: boolean
}

export interface ReferenceAreaConfig {
  x1: string | number
  x2: string | number
  fill: string
  fillOpacity?: number
  ifOverflow?: "hidden" | "visible" | "discard" | "extendDomain"
}

export interface AreaFillConfig {
  dataKey: string
  fill: string | {
    type: "gradient"
    id: string
    stops: Array<{ offset: string; color: string }>
  }
  fillOpacity?: number
  stroke?: string
}

export interface AxisConfig {
  domain?: [number, number] | [string, string]
  ticks?: (string | number)[]
  tickFormatter?: (value: any) => string
  label?: string
  [key: string]: any
}

export interface CustomLineChartProps {
  data: ChartDataPoint[]
  lines: LineConfig[]
  referenceLines?: ReferenceLineConfig[]
  referenceAreas?: ReferenceAreaConfig[]
  areaFill?: AreaFillConfig
  xAxis?: AxisConfig & {
    dataKey: string
    ticks?: string[]
  }
  yAxis?: AxisConfig
  height?: number
  margin?: { top?: number; right?: number; bottom?: number; left?: number }
  tooltip?: React.ComponentType<any>
  legend?: boolean | {
    enabled?: boolean
    wrapperStyle?: React.CSSProperties
    iconType?: string
    formatter?: (value: string) => React.ReactNode
  }
  hideLegendOnMobile?: boolean
  grid?: {
    enabled?: boolean
    strokeDasharray?: string
    stroke?: string
    vertical?: boolean
  }
  defs?: React.ReactNode
}

export function CustomLineChart({
  data,
  lines,
  referenceLines = [],
  referenceAreas = [],
  areaFill,
  xAxis,
  yAxis,
  height = 200,
  margin = { top: 50, right: 60, bottom: 0, left: -8 },
  tooltip,
  legend,
  hideLegendOnMobile = false,
  grid = {
    enabled: true,
    strokeDasharray: "4 4",
    stroke: "#e5e7eb",
    vertical: false,
  },
  defs,
}: CustomLineChartProps) {
  // Default X-axis config
  const xAxisConfig = {
    dataKey: "time",
    // Slightly darker tick color to match heatmap axes
    tick: { fontSize: 12, fill: "rgb(55, 65, 81)" },
    axisLine: { stroke: "#e5e7eb" },
    tickLine: { stroke: "#e5e7eb" },
    ...xAxis,
  }

  // Default Y-axis config
  const yAxisConfig = {
    // Slightly darker tick color to match heatmap axes
    tick: { fontSize: 12, fill: "rgb(55, 65, 81)" },
    axisLine: { stroke: "#e5e7eb" },
    tickLine: { stroke: "#e5e7eb" },
    ...yAxis,
  }

  // Default legend config
  const legendConfig =
    legend === false
      ? null
      : typeof legend === "object"
        ? {
            wrapperStyle: {
              paddingTop: "10px",
              display: "flex",
              justifyContent: "center",
              width: "100%",
              ...legend.wrapperStyle,
            },
            iconType: legend.iconType || "line",
            formatter:
              legend.formatter ||
              ((value: string) => (
                <span style={{ fontSize: 12, color: "rgb(55, 65, 81)" }}>
                  {value}
                </span>
              )),
          }
        : {
            wrapperStyle: {
              paddingTop: "10px",
              display: "flex",
              justifyContent: "center",
              width: "100%",
            },
            iconType: "line",
            formatter: (value: string) => (
              <span style={{ fontSize: 12, color: "rgb(55, 65, 81)" }}>
                {value}
              </span>
            ),
          }

  return (
    <div className={`w-full ${hideLegendOnMobile ? "[&_.recharts-legend-wrapper]:hidden [&_.recharts-legend-wrapper]:sm:block" : ""}`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin} style={{ overflow: "visible" }}>
          {/* Defs for gradients */}
          {defs && <defs>{defs}</defs>}

          {/* Grid */}
          {grid?.enabled !== false && (
            <CartesianGrid
              strokeDasharray={grid.strokeDasharray}
              stroke={grid.stroke}
              vertical={grid.vertical}
            />
          )}

          {/* X-Axis */}
          <XAxis {...xAxisConfig} />

          {/* Y-Axis */}
          <YAxis {...yAxisConfig} />

          {/* Tooltip */}
          {tooltip && <Tooltip content={tooltip as any} />}

          {/* Area fill under line */}
          {areaFill && (
            <Area
              type="monotone"
              dataKey={areaFill.dataKey}
              stroke={areaFill.stroke || "none"}
              fill={
                typeof areaFill.fill === "string"
                  ? areaFill.fill
                  : `url(#${areaFill.fill.id})`
              }
              fillOpacity={areaFill.fillOpacity ?? 1}
            />
          )}

          {/* Reference areas */}
          {referenceAreas.map((area, index) => (
            <ReferenceArea
              key={index}
              x1={area.x1}
              x2={area.x2}
              fill={area.fill}
              fillOpacity={area.fillOpacity}
              ifOverflow={area.ifOverflow || "visible"}
            />
          ))}

          {/* Reference lines */}
          {referenceLines.map((refLine, index) => {
            if (refLine.type === "vertical") {
              return (
                <ReferenceLine
                  key={index}
                  x={refLine.value}
                  stroke={refLine.stroke}
                  strokeWidth={refLine.strokeWidth || 2}
                  strokeDasharray={refLine.strokeDasharray}
                  label={
                    typeof refLine.label === "string"
                      ? { value: refLine.label }
                      : refLine.label
                  }
                  isFront={refLine.isFront}
                />
              )
            } else {
              return (
                <ReferenceLine
                  key={index}
                  y={refLine.value}
                  stroke={refLine.stroke}
                  strokeWidth={refLine.strokeWidth || 2}
                  strokeDasharray={refLine.strokeDasharray}
                  label={
                    typeof refLine.label === "string"
                      ? { value: refLine.label }
                      : refLine.label
                  }
                  isFront={refLine.isFront}
                />
              )
            }
          })}

          {/* Lines */}
          {lines.map((line, index) => (
            <Line
              key={index}
              type={line.type || "monotone"}
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth || 2}
              strokeDasharray={line.strokeDasharray}
              dot={line.dot as any}
              activeDot={line.activeDot}
            />
          ))}

          {/* Legend */}
          {legendConfig && <Legend {...(legendConfig as any)} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

