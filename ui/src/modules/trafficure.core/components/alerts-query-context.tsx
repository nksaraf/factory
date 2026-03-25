import { createContext, useContext, useState, useTransition, ReactNode, useEffect } from "react"
import { useNavigate, useParams } from "react-router"

// Re-export query types from canonical location for backward compatibility
export type { LiveAlertsSortKey, HistoricalAlertsSortKey, AlertsSort, AlertsFilters, HistoricalTimeRange } from "../types/alert-query"
import type { AlertsSort, AlertsFilters, HistoricalTimeRange } from "../types/alert-query"

interface AlertsQueryContextType {
  // Sort, count, and filters (separate for live and historical)
  liveSort: AlertsSort
  historicalSort: AlertsSort
  liveCount: number | null
  historicalTimeRange: HistoricalTimeRange // Time range for historical alerts (instead of count)
  liveFilters: AlertsFilters
  historicalFilters: AlertsFilters
  
  // Selected alert and tab
  selectedAlertId: string | null
  activeTab: "live" | "resolved"
  
  // Setters
  setLiveSort: (sort: AlertsSort) => void
  setHistoricalSort: (sort: AlertsSort) => void
  setLiveCount: (count: number | null) => void
  setHistoricalTimeRange: (timeRange: HistoricalTimeRange) => void
  setLiveFilters: (filters: AlertsFilters) => void
  setHistoricalFilters: (filters: AlertsFilters) => void
  setSelectedAlertId: (alertId: string | null) => void
  setActiveTab: (tab: "live" | "resolved") => void
  
  // Pending state
  isPending: boolean
}

export const AlertsQueryContext = createContext<AlertsQueryContextType | undefined>(undefined)

export function AlertsQueryProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const params = useParams()
  
  // State - separate sort, count, and filters for live and historical
  const [liveSort, setLiveSortState] = useState<AlertsSort>({ 
    key: "delay_seconds", 
    sortOrder: "desc" 
  })
  const [historicalSort, setHistoricalSortState] = useState<AlertsSort>({ 
    key: "resolved_at", 
    sortOrder: "desc" 
  })
  const [liveCount, setLiveCountState] = useState<number | null>(10) // null = show all
  const [historicalTimeRange, setHistoricalTimeRangeState] = useState<HistoricalTimeRange>("1h") // Default to last 1 hour
  const [liveFilters, setLiveFiltersState] = useState<AlertsFilters>({})
  const [historicalFilters, setHistoricalFiltersState] = useState<AlertsFilters>({})
  const [activeTab, setActiveTabState] = useState<"live" | "resolved">("live")
  const [isPending, startTransition] = useTransition()

  // Extract alertId from URL params
  const urlAlertId = params.alertId || null

  // Initialize alertId state from URL on mount
  const [selectedAlertId, setSelectedAlertIdState] = useState<string | null>(urlAlertId)

  // Sync alertId state with URL params when URL changes
  useEffect(() => {
    startTransition(() => {
      setSelectedAlertIdState(urlAlertId)
    })
  }, [urlAlertId])

  const setLiveSort = (newSort: AlertsSort) => {
    startTransition(() => {
      setLiveSortState(newSort)
    })
  }

  const setHistoricalSort = (newSort: AlertsSort) => {
    startTransition(() => {
      setHistoricalSortState(newSort)
    })
  }

  const setLiveCount = (newCount: number | null) => {
    startTransition(() => {
      setLiveCountState(newCount)
    })
  }

  const setHistoricalTimeRange = (newTimeRange: HistoricalTimeRange) => {
    startTransition(() => {
      setHistoricalTimeRangeState(newTimeRange)
    })
  }

  const setLiveFilters = (newFilters: AlertsFilters) => {
    startTransition(() => {
      setLiveFiltersState(newFilters)
    })
  }

  const setHistoricalFilters = (newFilters: AlertsFilters) => {
    startTransition(() => {
      setHistoricalFiltersState(newFilters)
    })
  }

  const setSelectedAlertId = (newAlertId: string | null) => {
    startTransition(() => {
      setSelectedAlertIdState(newAlertId)
      // Update URL to reflect alertId change
      if (newAlertId) {
        navigate(`/alerts/${newAlertId}`, { replace: true })
      } else {
        // Navigate to base alerts route if alertId is null
        navigate("/alerts", { replace: true })
      }
    })
  }

  const setActiveTab = (tab: "live" | "resolved") => {
    startTransition(() => {
      setActiveTabState(tab)
      // No need to reset sort - each tab maintains its own sort state
    })
  }

  return (
    <AlertsQueryContext.Provider
      value={{
        liveSort,
        historicalSort,
        liveCount,
        historicalTimeRange,
        liveFilters,
        historicalFilters,
        selectedAlertId,
        activeTab,
        setLiveSort,
        setHistoricalSort,
        setLiveCount,
        setHistoricalTimeRange,
        setLiveFilters,
        setHistoricalFilters,
        setSelectedAlertId,
        setActiveTab,
        isPending,
      }}
    >
      {children}
    </AlertsQueryContext.Provider>
  )
}

/**
 * Hook to access alerts query context
 * Returns context if available, null otherwise (for use in routes without AlertsQueryProvider)
 * @deprecated Use useContext(AlertsQueryContext) directly for better null handling
 */
export function useAlertsQueryContext() {
  const context = useContext(AlertsQueryContext)
  return context || null
}

