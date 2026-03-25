
import type { Road } from "../roads-data"
import { env } from "@rio.js/env"

export type RoadId = string

/**
 * Converts a timestamp to a relative time string (e.g., "5 minutes ago", "2 hours ago")
 */
export function getRelativeTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSeconds < 60) {
    return diffSeconds === 1 ? '1 second ago' : `${diffSeconds} seconds ago`
  } else if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`
  } else if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  } else if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`
  } else if (diffWeeks < 4) {
    return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`
  } else if (diffMonths < 12) {
    return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`
  } else {
    return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`
  }
}

export type RoadAlertType = "Congestion" | "Rapid Deterioration"

export interface RoadDetail {
  name: string
  id: RoadId
  roadLengthMeters: number
  currentStatus?: string
  segmentLabel?: string
  segmentLengthKm?: number
  lastUpdated?: string

  speed: {
    current: number 
    typical: number 
    freeFlow: number
    delayMinutes: number 
    delaySeconds: number 
    delayPercent: number 
    trend: {
      last7Days: number 
      prev7Days: number 
      change7Days: number 
      changePercent7Days: number 
      last30Days: number 
      prev30Days: number 
      change30Days: number 
      changePercent30Days: number 
    }
  }
  
  // Busy Hours Pattern
  congestionGrid: number[][] 
  patterns: {
    busiestDay: string 
    busiestDayDelayPercent: number 
    busiestHour: string 
    busiestHourDelayPercent: number 
  }
  
  // Speed Degradation Analysis
  degradation: {
    trend: "DEGRADING" | "STABLE" | "IMPROVING"
    speedHistory30Days: Array<{ date: string; avgSpeed: number }> 
    speedLoss: number 
    speedLossPercent: number 
    weekComparison: {
      change: number 
      changePercent: number 
    }
  }
  
  // Alert Statistics
  alerts: {
    totalLast7Days: number 
    totalLast15Days: number
    totalLast30Days: number 
    byType: {
      congestion: number
      rapidDeterioration: number
    }
    avgDurationMinutes: number 
    longestAlert: {
      durationMinutes: number
      date: string
      type: RoadAlertType
    }
    trendPercent: number 
    peakHours: string 
    currentAlert?: {
      type: RoadAlertType
      startedMinutesAgo: number
    }
    dailyTrend: number[] 
    recent: Array<{
      id: string
      type: RoadAlertType
      startedAtIso: string
      durationMinutes: number
    }>
  }
  
  geometry?: {
    type: "LineString"
    coordinates: number[][]
  }
}

export function generateSpeedAndTrendData(currentSpeedKmph: number): {
  avgSpeedLast7DaysKmph: number
  avgSpeedPrev7DaysKmph: number
  avgSpeedLast30DaysKmph: number
  avgSpeedPrev30DaysKmph: number
} {

  const delta7 = (Math.random() * 6 - 3) 
  const avgSpeedLast7DaysKmph = Math.max(5, currentSpeedKmph + delta7)
  const delta7Prev = (Math.random() * 6 - 3)
  const avgSpeedPrev7DaysKmph = Math.max(5, avgSpeedLast7DaysKmph + delta7Prev)


  const delta30 = (Math.random() * 4 - 2) 
  const avgSpeedLast30DaysKmph = Math.max(5, currentSpeedKmph + delta30)
  const delta30Prev = (Math.random() * 4 - 2)
  const avgSpeedPrev30DaysKmph = Math.max(5, avgSpeedLast30DaysKmph + delta30Prev)

  return {
    avgSpeedLast7DaysKmph: Math.round(avgSpeedLast7DaysKmph * 10) / 10,
    avgSpeedPrev7DaysKmph: Math.round(avgSpeedPrev7DaysKmph * 10) / 10,
    avgSpeedLast30DaysKmph: Math.round(avgSpeedLast30DaysKmph * 10) / 10,
    avgSpeedPrev30DaysKmph: Math.round(avgSpeedPrev30DaysKmph * 10) / 10,
  }
}

export function generateAlertStatisticsData(
  currentSpeedKmph: number,
  trafficStatus: string
): {
  totalLast7Days: number
  totalLast15Days: number
  totalLast30Days: number
  byType: { congestion: number; rapidDeterioration: number }
  avgDurationMinutes: number
  longestAlert: { durationMinutes: number; date: string; type: RoadAlertType }
  trendPercent: number
  peakHours: string
  currentAlert?: { type: RoadAlertType; startedMinutesAgo: number }
  dailyTrend: number[]
  recentAlerts: Array<{
    id: string
    type: RoadAlertType
    startedAtIso: string
    durationMinutes: number
  }>
} {
  const isBadTraffic = trafficStatus === "TRAFFIC_JAM" || currentSpeedKmph < 15
  
  // Generate 7-day and 30-day totals
  const totalLast7Days = isBadTraffic 
    ? Math.floor(Math.random() * 8 + 8) // 8-16 alerts
    : Math.floor(Math.random() * 5 + 3)  // 3-8 alerts
  
  const totalLast30Days = isBadTraffic 
    ? Math.floor(Math.random() * 30 + 30) // 30-60 alerts
    : Math.floor(Math.random() * 20 + 10)  // 10-30 alerts

  // Calculate 15-day total by interpolating between 7 and 30 days
  // Linear interpolation: totalLast15Days = totalLast7Days + (totalLast30Days - totalLast7Days) * (15 - 7) / (30 - 7)
  const totalLast15Days = Math.round(
    totalLast7Days + (totalLast30Days - totalLast7Days) * (15 - 7) / (30 - 7)
  )

  // Split by type (roughly 60-70% congestion, rest rapid deterioration)
  const congestionRatio = 0.6 + Math.random() * 0.1
  const congestionCount = Math.floor(totalLast7Days * congestionRatio)
  const rapidDetCount = totalLast7Days - congestionCount

  const avgAlertDurationMinutes = isBadTraffic
    ? Math.floor(Math.random() * 20 + 25) // 25-45 mins
    : Math.floor(Math.random() * 15 + 15) // 15-30 mins

  // Generate longest alert
  const longestDuration = Math.floor(Math.random() * 60 + 60) // 60-120 mins
  const longestDate = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
  const longestType: RoadAlertType = Math.random() > 0.5 ? "Congestion" : "Rapid Deterioration"

  // Trend percentage (could be up or down)
  const trendPercent = Math.floor(Math.random() * 50) * (Math.random() > 0.5 ? 1 : -1)

  // Peak hours
  const peakHours = "5-7 PM weekdays"

  // Current alert (20% chance of active alert)
  const hasCurrentAlert = Math.random() > 0.4
  const currentAlert = hasCurrentAlert ? {
    type: "Congestion" as RoadAlertType,
    startedMinutesAgo: Math.floor(Math.random() * 30 + 5)
  } : undefined

  // Daily trend for sparkline (last 7 days)
  const dailyTrend: number[] = Array.from({ length: 7 }, () => 
    Math.floor(Math.random() * 4 + (isBadTraffic ? 2 : 1))
  )

  // Generate recent alerts
  const alertTypes: RoadAlertType[] = ["Congestion", "Rapid Deterioration"]
  const recentAlerts: Array<{
    id: string
    type: RoadAlertType
    startedAtIso: string
    durationMinutes: number
  }> = []

  for (let i = 0; i < 5; i++) {
    const hoursAgo = i === 0 ? Math.random() * 2 : 
                     i === 1 ? Math.random() * 6 + 2 : 
                     i === 2 ? Math.random() * 24 + 8 :
                     i === 3 ? Math.random() * 48 + 32 :
                     Math.random() * 72 + 80
    const startedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    const type = alertTypes[Math.floor(Math.random() * alertTypes.length)]
    const duration = Math.floor(Math.random() * 40 + 15)

    recentAlerts.push({
      id: `alert-${i}-${Date.now()}`,
      type,
      startedAtIso: startedAt.toISOString(),
      durationMinutes: duration,
    })
  }

  recentAlerts.sort((a, b) => 
    new Date(b.startedAtIso).getTime() - new Date(a.startedAtIso).getTime()
  )

  return {
    totalLast7Days,
    totalLast15Days,
    totalLast30Days,
    byType: {
      congestion: congestionCount,
      rapidDeterioration: rapidDetCount
    },
    avgDurationMinutes: avgAlertDurationMinutes,
    longestAlert: {
      durationMinutes: longestDuration,
      date: longestDate.toISOString(),
      type: longestType
    },
    trendPercent,
    peakHours,
    currentAlert,
    dailyTrend,
    recentAlerts: recentAlerts.slice(0, 5),
  }
}


export function generateSpeedDegradationData(
  currentSpeedKmph: number,
  avgSpeedLast30Days: number,
  avgSpeedPrev30Days: number
): {
  trend: "DEGRADING" | "STABLE" | "IMPROVING"
  speedHistory30Days: Array<{ date: string; avgSpeed: number }>
  speedLoss: number
  speedLossPercent: number
  weekComparison: { change: number; changePercent: number }
} {
  // Determine trend
  const speedChange = avgSpeedLast30Days - avgSpeedPrev30Days
  let trend: "DEGRADING" | "STABLE" | "IMPROVING"
  if (speedChange < -2) {
    trend = "DEGRADING"
  } else if (speedChange > 2) {
    trend = "IMPROVING"
  } else {
    trend = "STABLE"
  }

  // Generate 30-day history
  const speedHistory30Days: Array<{ date: string; avgSpeed: number }> = []
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)
  
  let prevSpeed = avgSpeedPrev30Days
  for (let i = 0; i < 30; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    
    // Gradually move from prev30Days average to current
    const progress = i / 29
    const targetSpeed = avgSpeedLast30Days + (currentSpeedKmph - avgSpeedLast30Days) * Math.min(progress * 2, 1)
    const noise = (Math.random() - 0.5) * 3
    const avgSpeed = Math.max(5, prevSpeed * 0.7 + targetSpeed * 0.3 + noise)
    
    speedHistory30Days.push({
      date: date.toISOString().split('T')[0],
      avgSpeed: Math.round(avgSpeed * 10) / 10
    })
    
    prevSpeed = avgSpeed
  }

  // Speed loss calculation
  const speedLoss = avgSpeedPrev30Days - avgSpeedLast30Days
  const speedLossPercent = avgSpeedPrev30Days > 0 
    ? (speedLoss / avgSpeedPrev30Days) * 100 
    : 0

  // Week comparison (compare last 7 days to previous 7 days)
  const weekChange = -(Math.random() * 10 - 3) // Slightly negative bias
  const weekChangePercent = avgSpeedLast30Days > 0
    ? (weekChange / avgSpeedLast30Days) * 100
    : 0

  return {
    trend,
    speedHistory30Days,
    speedLoss: Math.round(speedLoss * 10) / 10,
    speedLossPercent: Math.round(speedLossPercent * 10) / 10,
    weekComparison: {
      change: Math.round(weekChange * 10) / 10,
      changePercent: Math.round(weekChangePercent * 10) / 10
    }
  }
}

export function generateCongestionGrid(
  baseCongestion: number,
  _isHighway: boolean = false
): number[][] {
  return Array.from({ length: 7 }, (_, day) => {
    return Array.from({ length: 24 }, (_, hr) => {
      const isWeekday = day <= 4 

      let score = baseCongestion

      if (isWeekday) {
        if (hr >= 8 && hr <= 10) {
          const peakFactor = 1 - Math.abs(hr - 9) / 1 
          score = baseCongestion + 30 + peakFactor * 25 
        }
        else if (hr >= 18 && hr <= 21) {
          const peakFactor = 1 - Math.abs(hr - 19.5) / 1.5 
          score = baseCongestion + 25 + peakFactor * 30 
        }
        else if (hr >= 11 && hr <= 17) {
          score = baseCongestion + 15 + Math.random() * 15
        }
        else {
          score = Math.max(0, baseCongestion - 20 + Math.random() * 10)
        }
      } else {
        if (hr >= 11 && hr <= 20) {
          score = baseCongestion - 10 + Math.random() * 20
        }
        else if ((hr >= 8 && hr <= 10) || (hr >= 21 && hr <= 23)) {
          score = Math.max(0, baseCongestion - 25 + Math.random() * 10)
        }
        else {
          score = Math.max(0, baseCongestion - 30 + Math.random() * 5)
        }
      }

      score += (Math.sin((day + 1) * (hr + 1)) + 1) * 2

      return Math.max(0, Math.min(100, Math.round(score)))
    })
  })
}
export async function getPartialRoadDetail(roadId: RoadId): Promise<Road | null> {
  try {
    const url = new URL(
      `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/traffic_segments_for_tiles`
    )
    url.searchParams.set("road_id", `eq.${roadId}`)
    
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    })

    if (response.ok) {
      const data: Road[] = await response.json()
      if (data && data.length > 0) {
        return data[0]
      }
    }
  } catch (error) {
    console.warn(`Failed to fetch road data for ${roadId}:`, error)
  }
  return null
}


export async function getRoadDetail(roadId: RoadId): Promise<RoadDetail | null> {
  const roadData = await getPartialRoadDetail(roadId)

  const currentSpeedKmph = roadData?.current_speed_kmph ?? 0
  const trafficStatus = roadData?.traffic_status ?? "UNKNOWN"

  const roadLengthMeters = roadData?.road_length_meters ?? 0

  const freeflowTravelTimeSec = roadData?.freeflow_travel_time_sec 

  const delaySeconds = Math.abs(roadData?.delay_seconds ?? 0)
  console.log(delaySeconds,"delaySeconds")
  const delayPercent = Math.abs(roadData?.delay_percent ?? 0)

  const trafficEventTime = roadData?.traffic_event_time ?? new Date().toISOString() 

  // Generate all module data
  const speedTrendData = generateSpeedAndTrendData(currentSpeedKmph)
  const alertData = generateAlertStatisticsData(currentSpeedKmph, trafficStatus)
  const degradationData = generateSpeedDegradationData(
    currentSpeedKmph,
    speedTrendData.avgSpeedLast30DaysKmph,
    speedTrendData.avgSpeedPrev30DaysKmph
  )
  const congestionGrid = generateCongestionGrid(
    Math.min(100, delayPercent),
    false
  )

  const getStatusBadge = (delayPercent: number) => {
    if (delayPercent >= 50) {
      return "Heavy"
    } else if (delayPercent >= 20) {
      return "Moderate"
    }
    return "Smooth"
  }

  const currentStatus = getStatusBadge(delayPercent)



  // Calculate busiest day and hour from congestion grid
  let busiestDay = ""
  let busiestDayDelayPercent = 0
  let busiestHour = ""
  let busiestHourDelayPercent = 0
  
  if (congestionGrid && congestionGrid.length === 7) {
    const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    let maxDayIdx = 0
    let maxDayAvg = 0
    let maxHour = 0
    let maxHourValue = 0

    congestionGrid.forEach((row, dayIdx) => {
      const dayAvg = row.reduce((sum, val) => sum + val, 0) / row.length
      if (dayAvg > maxDayAvg) {
        maxDayAvg = dayAvg
        maxDayIdx = dayIdx
      }
      row.forEach((val, hour) => {
        if (val > maxHourValue) {
          maxHourValue = val
          maxHour = hour
        }
      })
    })

    busiestDay = DAYS[maxDayIdx]
    busiestDayDelayPercent = Math.round(maxDayAvg)
    busiestHour = `${String(maxHour).padStart(2, "0")}:00`
    busiestHourDelayPercent = Math.round(maxHourValue)
  }

  // Calculate typical speed (freeflow or baseline)
  const typicalSpeed = freeflowTravelTimeSec && roadLengthMeters
    ? (roadLengthMeters / 1000) / (freeflowTravelTimeSec / 3600)
    : currentSpeedKmph * 1.5

  // Use delaySeconds directly from API
  const delayMinutes = Math.floor(Math.abs(delaySeconds) / 60)
  const delaySecondsRemainder = Math.abs(delaySeconds) % 60
  const segmentLengthKm = roadLengthMeters / 1000

  // Calculate speed changes
  const change7Days = speedTrendData.avgSpeedLast7DaysKmph - speedTrendData.avgSpeedPrev7DaysKmph
  const changePercent7Days = speedTrendData.avgSpeedPrev7DaysKmph > 0
    ? (change7Days / speedTrendData.avgSpeedPrev7DaysKmph) * 100
    : 0

  const change30Days = speedTrendData.avgSpeedLast30DaysKmph - speedTrendData.avgSpeedPrev30DaysKmph
  const changePercent30Days = speedTrendData.avgSpeedPrev30DaysKmph > 0
    ? (change30Days / speedTrendData.avgSpeedPrev30DaysKmph) * 100
    : 0

  // Split road name by "/" to extract segment label and road name
  const fullRoadName = roadData?.road_name ?? "Unknown Road"
  const nameParts = fullRoadName.split("/")
  const segmentLabel = nameParts.length > 1 ? nameParts[0].trim() : undefined
  const roadName = nameParts.length > 1 ? nameParts[1].trim() : fullRoadName

  return {
    name: roadName,
    id: roadData?.road_id ?? roadId,
    roadLengthMeters,
    currentStatus,
    segmentLabel,
    segmentLengthKm,
    lastUpdated: trafficEventTime,
    
    // Speed & Status Card
    speed: {
      current: currentSpeedKmph,
      typical: Math.round(typicalSpeed * 10) / 10,
      freeFlow: Math.round((typicalSpeed * 1.45) * 10) / 10, // Free-flow is typically 45% faster than typical speed
      delayMinutes,
      delaySeconds: delaySecondsRemainder,
      delayPercent,
      trend: {
        last7Days: speedTrendData.avgSpeedLast7DaysKmph,
        prev7Days: speedTrendData.avgSpeedPrev7DaysKmph,
        change7Days: Math.round(change7Days * 10) / 10,
        changePercent7Days: Math.round(changePercent7Days * 10) / 10,
        last30Days: speedTrendData.avgSpeedLast30DaysKmph,
        prev30Days: speedTrendData.avgSpeedPrev30DaysKmph,
        change30Days: Math.round(change30Days * 10) / 10,
        changePercent30Days: Math.round(changePercent30Days * 10) / 10,
      }
    },
    
    // Busy Hours Pattern
    congestionGrid,
    patterns: {
      busiestDay,
      busiestDayDelayPercent,
      busiestHour,
      busiestHourDelayPercent,
    },
    
    // Speed Degradation Analysis
    degradation: degradationData,
    
    // Alert Statistics
    alerts: {
      ...alertData,
      recent: alertData.recentAlerts,
    },
    
    geometry: roadData?.geom?.coordinates ? {
      type: "LineString" as const,
      coordinates: roadData.geom.coordinates,
    } : undefined,
  }
}



