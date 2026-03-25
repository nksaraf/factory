/**
 * Expand bounds so that long/narrow roads (e.g. vertical) stay fully within the map view.
 * - Ensures a minimum width/height in degrees so fitBounds doesn't produce a degenerate view.
 * - Adds a small margin so the geometry sits inside the frame (doesn't touch edges).
 */
const MIN_DEGREES_LNG = 0.002
const MIN_DEGREES_LAT = 0.002
const MARGIN_FRACTION = 0.08 // 8% margin so road stays inside bounds

export type Bounds = [[number, number], [number, number]]

export function expandBoundsForFocus(bounds: Bounds): Bounds {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds
  let width = maxLng - minLng
  let height = maxLat - minLat

  // Ensure minimum size so thin/long roads don't get a degenerate fit
  const minWidth = Math.max(width, MIN_DEGREES_LNG)
  const minHeight = Math.max(height, MIN_DEGREES_LAT)

  // Expand by margin so the road sits inside the frame (not on the edge)
  const marginX = Math.max(minWidth * MARGIN_FRACTION, MIN_DEGREES_LNG * 0.5)
  const marginY = Math.max(minHeight * MARGIN_FRACTION, MIN_DEGREES_LAT * 0.5)

  const centerLng = (minLng + maxLng) / 2
  const centerLat = (minLat + maxLat) / 2

  const halfWidth = minWidth / 2 + marginX
  const halfHeight = minHeight / 2 + marginY

  return [
    [centerLng - halfWidth, centerLat - halfHeight],
    [centerLng + halfWidth, centerLat + halfHeight],
  ]
}
