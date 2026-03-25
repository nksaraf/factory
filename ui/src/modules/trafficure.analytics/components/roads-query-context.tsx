import { createContext, useContext, useState, useTransition, ReactNode } from "react"
import { type RoadsSort, type RoadsFilters } from "../data/use-roads-query"

interface RoadsQueryContextType {
  sort: RoadsSort
  count: number | null
  selectedQuestion: string | null
  filters: RoadsFilters
  setSort: (sort: RoadsSort) => void
  setCount: (count: number | null) => void
  setSortAndCount: (sort: RoadsSort, count: number | null, questionId: string | null) => void
  setSelectedQuestion: (questionId: string | null) => void
  setFilters: (filters: RoadsFilters) => void
  isPending: boolean
}

export const RoadsQueryContext = createContext<RoadsQueryContextType | undefined>(undefined)

export function RoadsQueryProvider({ children }: { children: ReactNode }) {
  const [sort, setSortState] = useState<RoadsSort>({ key: "severity", sortOrder: "desc" })
  const [count, setCountState] = useState<number | null>(null)
  const [selectedQuestion, setSelectedQuestionState] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<RoadsFilters>({ 
    searchTerm: "",
    timeScope: "this_week", // Default time scope for degrading roads
    peakType: "evening-peak" // Default peak type for peak hour
  })
  const [isPending, startTransition] = useTransition()

  const setSort = (newSort: RoadsSort) => {
    startTransition(() => {
      setSortState(newSort)
      setSelectedQuestionState(null)
    })
  }

  const setCount = (newCount: number | null) => {
    startTransition(() => {
      setCountState(newCount)
      setSelectedQuestionState(null)
    })
  }

  const setSortAndCount = (newSort: RoadsSort, newCount: number | null, questionId: string | null) => {
    startTransition(() => {
      setSortState(newSort)
      setCountState(newCount)
      setSelectedQuestionState(questionId)
    })
  }

  const setSelectedQuestion = (questionId: string | null) => {
    startTransition(() => {
      setSelectedQuestionState(questionId)
    })
  }

  const setFilters = (newFilters: RoadsFilters) => {
    startTransition(() => {
      setFiltersState(newFilters)
    })
  }

  return (
    <RoadsQueryContext.Provider
      value={{
        sort,
        count,
        selectedQuestion,
        filters,
        setSort,
        setCount,
        setSortAndCount,
        setSelectedQuestion,
        setFilters,
        isPending,
      }}
    >
      {children}
    </RoadsQueryContext.Provider>
  )
}

export function useRoadsQueryContext() {
  const context = useContext(RoadsQueryContext)
  if (context === undefined) {
    throw new Error("useRoadsQueryContext must be used within a RoadsQueryProvider")
  }
  return context
}

