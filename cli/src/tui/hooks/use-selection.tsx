import React, {
  type ReactNode,
  createContext,
  useContext,
  useState,
} from "react"

export type ResourceType = "estate" | "realm" | "workbench"

export interface Selection {
  type: ResourceType
  id: string
  name: string
  /** Parent IDs for breadcrumb context */
  realmId?: string
  estateId?: string
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
