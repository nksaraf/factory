import React, { createContext, useContext, useState, type ReactNode } from "react"

export type ResourceType = "substrate" | "runtime" | "workspace"

export interface Selection {
  type: ResourceType
  id: string
  name: string
  /** Parent IDs for breadcrumb context */
  runtimeId?: string
  substrateId?: string
}

interface SelectionContextValue {
  selection: Selection | null
  setSelection: (s: Selection | null) => void
}

const SelectionContext = createContext<SelectionContextValue>({
  selection: null,
  setSelection: () => {},
})

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  return (
    <SelectionContext.Provider value={{ selection, setSelection }}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection() {
  return useContext(SelectionContext)
}
