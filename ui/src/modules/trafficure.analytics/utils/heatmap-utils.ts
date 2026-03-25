import chroma from "chroma-js"

/** ---------- Helpers ---------- */

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0..23

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}


/**
 * Heatmap color logic - relative to min/max values in the dataset
 * Colors match the legend in the busy hours pattern visualization:
 * - Normal Flow (green): emerald-400
 * - Moderate (yellow): amber-400  
 * - Heavy Delay (red): red-500
 * 
 * Normalizes the value relative to min/max range and applies colors:
 * - Lowest values: Green (emerald-400)
 * - Middle values: Yellow (amber-400)
 * - Highest values: Red (red-500)
 */
export function getHeatColorForCongestion(
  value: number,
  min: number,
  max: number
) {
  // Handle edge cases
  if (max === min) {
    // All values are the same, return middle color (yellow)
    return "#fbbf24" // amber-400
  }

  // Normalize value to 0-1 range relative to min/max
  const normalized = (value - min) / (max - min)
  const clamped = clamp(normalized, 0, 1)

  // Create a smooth gradient with color stops that match the legend
  // The gradient transitions through green -> yellow -> red
  // Using relative positioning: 0 = lowest (green), 0.5 = middle (yellow), 1 = highest (red)
  const scale = chroma.scale([
    "#34d399", // emerald-400 - Normal Flow (lowest values)
    "#34d399", // emerald-400 - Normal Flow (lower third)
    "#fbbf24", // amber-400 - Moderate (middle)
    "#ef4444", // red-500 - Heavy Delay (highest values)
  ])
    .domain([0, 0.33, 0.67, 1]) // Map normalized 0-1 range to color stops

  return scale(clamped).hex()
}


