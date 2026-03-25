import {
  CompositeLayer,
  CompositeLayerProps,
  DefaultProps,
} from "@rio.js/maps-ui/lib/deck-gl/core"
import { PathLayer } from "@rio.js/maps-ui/lib/deck-gl/layers"

import { generateArrowLines } from "./traffic-utils"

export interface TrafficRoadHighlightLayerProps<T = any>
  extends CompositeLayerProps {
  /** Array of data items to render paths for */
  data: T[]
  /** Function to extract path coordinates [[lng, lat], ...] from each data item */
  getPath: (d: T) => number[][]
  /** Border color [r, g, b, a] */
  borderColor?:
    | [number, number, number, number]
    | ((d?: T) => [number, number, number, number])
  /** Core color [r, g, b, a] or function that returns color */
  coreColor:
    | [number, number, number, number]
    | ((d?: T) => [number, number, number, number])
  /** Border width in pixels */
  borderWidth?: number
  /** Core width in pixels */
  coreWidth?: number
  /** Border width min pixels */
  borderWidthMinPixels?: number
  /** Border width max pixels */
  borderWidthMaxPixels?: number
  /** Core width min pixels */
  coreWidthMinPixels?: number
  /** Core width max pixels */
  coreWidthMaxPixels?: number
  /** Arrow length in meters (null to disable arrows) */
  arrowLength?: number | null
  /** Whether to show glow layer (for selected roads) */
  showGlow?: boolean
  /** Glow color [r, g, b, a] */
  glowColor?: [number, number, number, number]
  /** Glow width in pixels */
  glowWidth?: number
  /** Glow width min pixels */
  glowWidthMinPixels?: number
  /** Glow width max pixels */
  glowWidthMaxPixels?: number
  /** Rounded caps/joints (false = sharp, Google-style) */
  rounded?: boolean
}

const defaultProps: DefaultProps<TrafficRoadHighlightLayerProps<any>> = {
  borderColor: [255, 255, 255, 255],
  borderWidth: 12,
  coreWidth: 8,
  borderWidthMinPixels: 8,
  borderWidthMaxPixels: 16,
  coreWidthMinPixels: 6,
  coreWidthMaxPixels: 7,
  arrowLength: null,
  showGlow: false,
  glowColor: [255, 255, 255, 180],
  glowWidth: 14,
  glowWidthMinPixels: 10,
  glowWidthMaxPixels: 20,
  rounded: false,
}

/**
 * Composite layer that renders highlighted roads with border, core, and optional arrows.
 * Handles all the sublayers internally for a clean API.
 * Supports rendering multiple paths from a data array.
 */
export default class TrafficRoadHighlightLayer<T = any> extends CompositeLayer<
  TrafficRoadHighlightLayerProps<T>
> {
  static layerName = "TrafficRoadHighlightLayer"
  static defaultProps = defaultProps

  renderLayers() {
    const {
      data,
      getPath,
      borderColor,
      coreColor,
      borderWidth,
      coreWidth,
      borderWidthMinPixels,
      borderWidthMaxPixels,
      coreWidthMinPixels,
      coreWidthMaxPixels,
      arrowLength,
      showGlow,
      glowColor,
      glowWidth,
      glowWidthMinPixels,
      glowWidthMaxPixels,
      rounded,
      pickable,
      onHover,
      onClick,
    } = this.props

    const capAndJoint = rounded ?? defaultProps.rounded

    if (!data || !Array.isArray(data) || data.length === 0) {
      return []
    }

    // Filter out invalid paths
    const validData = data.filter((d) => {
      const path = getPath(d)
      return path && Array.isArray(path) && path.length >= 2
    })

    if (validData.length === 0) {
      return []
    }

    const layers: PathLayer[] = []

    const getBorderColor = (d: T) => {
      return typeof borderColor === "function"
        ? borderColor(d)
        : borderColor || defaultProps.borderColor
    }

    // 1. Glow layer (if enabled) - rendered first
    if (showGlow) {
      layers.push(
        new PathLayer(
          this.getSubLayerProps({
            id: "glow",
            data: validData,
            getPath: getPath as any,
            getColor: glowColor || defaultProps.glowColor,
            widthUnits: "pixels",
            getWidth: glowWidth || defaultProps.glowWidth,
            widthMinPixels:
              glowWidthMinPixels || defaultProps.glowWidthMinPixels,
            widthMaxPixels:
              glowWidthMaxPixels || defaultProps.glowWidthMaxPixels,
            rounded: capAndJoint,
            pickable: false,
          } as any)
        )
      )
    }

    // 2. Border layer - rendered second
    layers.push(
      new PathLayer(
        this.getSubLayerProps({
          id: "border",
          data: validData,
          getPath: getPath as any,
          getColor: getBorderColor as any,
          widthUnits: "pixels",
          getWidth: borderWidth || defaultProps.borderWidth,
          widthMinPixels:
            borderWidthMinPixels || defaultProps.borderWidthMinPixels,
          widthMaxPixels:
            borderWidthMaxPixels || defaultProps.borderWidthMaxPixels,
          rounded: capAndJoint,
          pickable: false,
        } as any)
      )
    )

    // 3. Generate arrows if arrowLength is provided
    const arrows: Array<{
      dataItem: T
      arrow: {
        type: "Feature"
        geometry: { type: "LineString"; coordinates: number[][] }
      }
      index: number
    }> = []
    if (arrowLength !== null && arrowLength !== undefined && arrowLength > 0) {
      validData.forEach((dataItem, dataIndex) => {
        const path = getPath(dataItem)
        const generatedArrows = generateArrowLines(path, arrowLength)
        generatedArrows.forEach((arrow, arrowIndex) => {
          arrows.push({
            dataItem,
            arrow,
            index: dataIndex * 1000 + arrowIndex, // Unique index
          })
        })
      })
    }

    // 4. Arrow border layers - use rounded caps so arrow head renders fully (not cut off)
    if (arrows.length > 0) {
      arrows.forEach(({ dataItem, arrow, index }) => {
        layers.push(
          new PathLayer(
            this.getSubLayerProps({
              id: `arrow-border-${index}`,
              data: [arrow.geometry.coordinates],
              getPath: (d: number[][]) => d as any,
              getColor: getBorderColor(dataItem),
              widthUnits: "pixels",
              getWidth: borderWidth || defaultProps.borderWidth,
              widthMinPixels:
                borderWidthMinPixels || defaultProps.borderWidthMinPixels,
              widthMaxPixels:
                borderWidthMaxPixels || defaultProps.borderWidthMaxPixels,
              rounded: true,
              pickable: false,
            } as any)
          )
        )
      })
    }

    // 5. Arrow core layers - use rounded caps so arrow head renders fully (not cut off)
    if (arrows.length > 0) {
      arrows.forEach(({ dataItem, arrow, index }) => {
        const color =
          typeof coreColor === "function" ? coreColor(dataItem) : coreColor
        layers.push(
          new PathLayer(
            this.getSubLayerProps({
              id: `arrow-core-${index}`,
              data: [arrow.geometry.coordinates],
              getPath: (d: number[][]) => d as any,
              getColor: color,
              widthUnits: "pixels",
              getWidth: coreWidth || defaultProps.coreWidth,
              widthMinPixels:
                coreWidthMinPixels || defaultProps.coreWidthMinPixels,
              widthMaxPixels:
                coreWidthMaxPixels || defaultProps.coreWidthMaxPixels,
              rounded: true,
              pickable: false,
            } as any)
          )
        )
      })
    }

    // 6. Core layer - rendered last (on top)
    const getCoreColor = (d: T) => {
      return typeof coreColor === "function" ? coreColor(d) : coreColor
    }
    layers.push(
      new PathLayer(
        this.getSubLayerProps({
          id: "core",
          data: validData,
          getPath: getPath as any,
          getColor: getCoreColor as any,
          widthUnits: "pixels",
          getWidth: coreWidth || defaultProps.coreWidth,
          widthMinPixels: coreWidthMinPixels || defaultProps.coreWidthMinPixels,
          widthMaxPixels: coreWidthMaxPixels || defaultProps.coreWidthMaxPixels,
          rounded: capAndJoint,
          pickable: pickable !== false, // Make pickable if not explicitly false
          // Add picking radius to make it easier to hover/click on paths
          getPickingRadius: () =>
            Math.max(
              ((coreWidth || defaultProps.coreWidth) as any) / 2 + 5,
              10
            ),
          onHover: onHover,
          onClick: onClick,
        } as any)
      )
    )

    return layers
  }
}
