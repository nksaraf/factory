import { useMemo } from "react"
import { ComparisonResult, CalculatedMetrics, Insight } from "../types"

const VALUE_OF_TIME_PER_HOUR = 150 // Rupees per vehicle-hour (default from spec)

export function useCompareCalculations(result: ComparisonResult | undefined) {
  return useMemo(() => {
    if (!result) {
      return null
    }

    const { before, after } = result

    // 1. Speed Change
    const speedChange = {
      before: before.avgSpeed,
      after: after.avgSpeed,
      change: after.avgSpeed - before.avgSpeed,
      percentage: ((after.avgSpeed - before.avgSpeed) / before.avgSpeed) * 100
    }

    // 2. Time Saved
    const timeSaved = {
      before: before.avgTravelTime,
      after: after.avgTravelTime,
      saved: after.avgTravelTime - before.avgTravelTime // negative = faster
    }

    // 3. Economic Impact
    // Formula: (time_saved_per_vehicle × daily_vehicle_count × value_of_time × days_in_period) / 100000
    const timeSavedPerVehicleHours = (timeSaved.saved / 60) // Convert minutes to hours
    const daysInPeriod = 7 // 7-day period
    const economicValue = (timeSavedPerVehicleHours * before.vehicleCount * VALUE_OF_TIME_PER_HOUR * daysInPeriod) / 100000

    const economicImpact = {
      value: economicValue, // in lakhs
      vehicleCount: before.vehicleCount,
      hasData: before.vehicleCount > 0
    }

    // 4. Congestion Index (BTI)
    const congestionIndex = {
      before: before.bti,
      after: after.bti,
      change: after.bti - before.bti,
      percentage: ((after.bti - before.bti) / before.bti) * 100
    }

    const metrics: CalculatedMetrics = {
      speedChange,
      timeSaved,
      economicImpact,
      congestionIndex
    }

    // Generate insights
    const insights = generateInsights(result, metrics)

    return {
      metrics,
      insights
    }
  }, [result])
}

function generateInsights(result: ComparisonResult, metrics: CalculatedMetrics): Insight[] {
  const insights: Insight[] = []
  const { before, after } = result

  // Analyze heatmap data for patterns
  const beforeHeatmap = before.heatmapData
  const afterHeatmap = after.heatmapData

  // Find Friday evening (day 4, hours 17-19)
  const fridayEveningBefore = beforeHeatmap
    .filter(cell => cell.day === 4 && cell.hour >= 17 && cell.hour <= 19)
    .map(cell => cell.value)
  const fridayEveningAfter = afterHeatmap
    .filter(cell => cell.day === 4 && cell.hour >= 17 && cell.hour <= 19)
    .map(cell => cell.value)

  if (fridayEveningBefore.length > 0 && fridayEveningAfter.length > 0) {
    const avgBefore = fridayEveningBefore.reduce((a, b) => a + b, 0) / fridayEveningBefore.length
    const avgAfter = fridayEveningAfter.reduce((a, b) => a + b, 0) / fridayEveningAfter.length
    const reduction = ((avgBefore - avgAfter) / avgBefore) * 100

    if (reduction > 20) {
      insights.push({
        text: `Friday evening congestion reduced by ${Math.round(reduction)}%`,
        type: 'improvement'
      })
    }
  }

  // Weekend pattern analysis
  const weekendBefore = beforeHeatmap
    .filter(cell => cell.day >= 5) // Sat, Sun
    .map(cell => cell.value)
  const weekendAfter = afterHeatmap
    .filter(cell => cell.day >= 5)
    .map(cell => cell.value)

  if (weekendBefore.length > 0 && weekendAfter.length > 0) {
    const avgBefore = weekendBefore.reduce((a, b) => a + b, 0) / weekendBefore.length
    const avgAfter = weekendAfter.reduce((a, b) => a + b, 0) / weekendAfter.length
    const change = ((avgAfter - avgBefore) / avgBefore) * 100

    if (Math.abs(change) > 15) {
      if (change < 0) {
        insights.push({
          text: `Weekend congestion decreased by ${Math.round(Math.abs(change))}%`,
          type: 'improvement'
        })
      } else {
        insights.push({
          text: `Weekend congestion increased by ${Math.round(change)}%`,
          type: 'degradation'
        })
      }
    }
  }

  // Peak window improvements
  const morningPeakBefore = beforeHeatmap
    .filter(cell => cell.day < 5 && cell.hour >= 7 && cell.hour <= 9)
    .map(cell => cell.value)
  const morningPeakAfter = afterHeatmap
    .filter(cell => cell.day < 5 && cell.hour >= 7 && cell.hour <= 9)
    .map(cell => cell.value)

  const eveningPeakBefore = beforeHeatmap
    .filter(cell => cell.day < 5 && cell.hour >= 17 && cell.hour <= 19)
    .map(cell => cell.value)
  const eveningPeakAfter = afterHeatmap
    .filter(cell => cell.day < 5 && cell.hour >= 17 && cell.hour <= 19)
    .map(cell => cell.value)

  if (morningPeakBefore.length > 0 && eveningPeakBefore.length > 0) {
    const morningAvgBefore = morningPeakBefore.reduce((a, b) => a + b, 0) / morningPeakBefore.length
    const morningAvgAfter = morningPeakAfter.reduce((a, b) => a + b, 0) / morningPeakAfter.length
    const eveningAvgBefore = eveningPeakBefore.reduce((a, b) => a + b, 0) / eveningPeakBefore.length
    const eveningAvgAfter = eveningPeakAfter.reduce((a, b) => a + b, 0) / eveningPeakAfter.length

    const morningChange = ((morningAvgAfter - morningAvgBefore) / morningAvgBefore) * 100
    const eveningChange = ((eveningAvgAfter - eveningAvgBefore) / eveningAvgBefore) * 100

    if (Math.abs(morningChange) > 10 || Math.abs(eveningChange) > 10) {
      if (morningChange < -10 && eveningChange < -10) {
        insights.push({
          text: `Morning peak shows ${Math.round(Math.abs(morningChange))}% improvement while evening peak shows ${Math.round(Math.abs(eveningChange))}% improvement`,
          type: 'improvement'
        })
      } else if (morningChange < -10) {
        insights.push({
          text: `Morning peak shows ${Math.round(Math.abs(morningChange))}% improvement while evening peak shows ${Math.round(eveningChange)}% change`,
          type: morningChange < -10 ? 'improvement' : 'neutral'
        })
      } else if (eveningChange < -10) {
        insights.push({
          text: `Evening peak shows ${Math.round(Math.abs(eveningChange))}% improvement while morning peak shows ${Math.round(morningChange)}% change`,
          type: 'improvement'
        })
      }
    }
  }

  // Overall change significance
  const overallSpeedChange = metrics.speedChange.percentage
  if (Math.abs(overallSpeedChange) < 5) {
    insights.push({
      text: "Changes are within normal variation — no clear improvement or degradation detected",
      type: 'neutral'
    })
  } else if (overallSpeedChange > 0) {
    insights.push({
      text: `Overall speed improved by ${Math.round(overallSpeedChange)}%, indicating significant traffic flow enhancement`,
      type: 'improvement'
    })
  }

  // Ensure we have at least 3 insights, max 5
  return insights.slice(0, 5)
}

