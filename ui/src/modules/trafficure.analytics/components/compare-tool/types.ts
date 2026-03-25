/**
 * Types for the Compare Tool feature
 */

export interface ComparisonParams {
  beforeStartDate: Date
  beforeEndDate: Date
  afterStartDate: Date
  afterEndDate: Date
  roadId: string
  roadName: string
}

export interface HeatmapCell {
  day: number // 0-6 (Mon-Sun)
  hour: number // 0-23
  value: number // delay percentage
}

export interface PeriodMetrics {
  avgSpeed: number // km/h
  avgTravelTime: number // minutes
  bti: number // Congestion Index (BTI)
  heatmapData: HeatmapCell[] // 7×24 = 168 cells
  vehicleCount: number // daily vehicle count
  percentile95TravelTime: number // seconds
}

export interface ComparisonResult {
  before: PeriodMetrics
  after: PeriodMetrics
  roadLength: number // meters
  freeflowTravelTime: number // seconds
  roadName: string
}

export interface CalculatedMetrics {
  speedChange: {
    before: number
    after: number
    change: number
    percentage: number
  }
  timeSaved: {
    before: number // minutes
    after: number // minutes
    saved: number // minutes (negative = faster)
  }
  economicImpact: {
    value: number // Rupees (in lakhs)
    vehicleCount: number
    hasData: boolean
  }
  congestionIndex: {
    before: number
    after: number
    change: number
    percentage: number
  }
}

export interface Insight {
  text: string
  type: 'improvement' | 'degradation' | 'neutral'
}

