import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { EntitySelector } from "./entity-selector.js"
import { EntityRowList } from "./entity-row-list.js"
import { EntityDetail } from "./entity-detail.js"
import { EntityEditor } from "./entity-editor.js"
import { useEntityData } from "../../hooks/use-entity-data.js"
import type { EntityDef } from "./entity-registry.js"

interface ExplorerTabProps {
  focused: boolean
}

type Pane = "types" | "rows" | "detail"

type DetailView =
  | { mode: "detail" }
  | { mode: "edit"; row?: Record<string, unknown> }

export function ExplorerTab({ focused }: ExplorerTabProps) {
  const [activePane, setActivePane] = useState<Pane>("types")
  const [selectedEntity, setSelectedEntity] = useState<EntityDef | null>(null)
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null)
  const [detailView, setDetailView] = useState<DetailView>({ mode: "detail" })

  // Lift data fetching here so row list + editor share it
  const entityData = useEntityData(
    selectedEntity?.module ?? "",
    selectedEntity?.entity ?? "",
    { enabled: !!selectedEntity }
  )

  const typesFocused = focused && activePane === "types"
  const rowsFocused = focused && activePane === "rows"
  const detailFocused = focused && activePane === "detail"

  useInput(
    (input, key) => {
      if (!focused) return
      if (input === "\t" && !key.ctrl && !key.meta) {
        setActivePane((p) => {
          if (p === "types") return selectedEntity ? "rows" : "types"
          if (p === "rows") return selectedRow ? "detail" : "types"
          return "types"
        })
      }
      if (key.escape) {
        if (activePane === "detail") setActivePane("rows")
        else if (activePane === "rows") setActivePane("types")
      }
    },
    { isActive: focused }
  )

  function handleEntitySelect(entity: EntityDef) {
    setSelectedEntity(entity)
    setSelectedRow(null)
    setDetailView({ mode: "detail" })
    setActivePane("rows")
  }

  function handleRowSelect(row: Record<string, unknown>) {
    setSelectedRow(row)
    setDetailView({ mode: "detail" })
  }

  function handleRowConfirm(row: Record<string, unknown>) {
    setSelectedRow(row)
    setDetailView({ mode: "detail" })
    setActivePane("detail")
  }

  async function handleSaved() {
    await entityData.refresh()
    setDetailView({ mode: "detail" })
    setActivePane("rows")
  }

  return (
    <Box flexGrow={1} flexDirection="row">
      {/* Pane 1: Entity types */}
      <Box
        flexDirection="column"
        width={26}
        borderStyle="single"
        borderRight
        borderLeft={false}
        borderTop={false}
        borderBottom={false}
        paddingRight={1}
      >
        <EntitySelector
          focused={typesFocused}
          selected={selectedEntity}
          onSelect={handleEntitySelect}
        />
      </Box>

      {/* Pane 2: Entity rows */}
      <Box
        flexDirection="column"
        width={42}
        borderStyle="single"
        borderRight
        borderLeft={false}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
      >
        {selectedEntity ? (
          <EntityRowList
            entity={selectedEntity}
            rows={entityData.data ?? []}
            loading={entityData.loading}
            error={entityData.error}
            focused={rowsFocused}
            selectedRow={selectedRow}
            onSelect={handleRowSelect}
            onConfirm={handleRowConfirm}
            onCreate={() => {
              setSelectedRow(null)
              setDetailView({ mode: "edit" })
              setActivePane("detail")
            }}
          />
        ) : (
          <Text dimColor>← select entity</Text>
        )}
      </Box>

      {/* Pane 3: Detail / Editor */}
      <Box flexDirection="column" flexGrow={1}>
        {!selectedEntity ? (
          <Box padding={1}>
            <Text dimColor>tab to switch panes</Text>
          </Box>
        ) : !selectedRow && detailView.mode === "detail" ? (
          <Box padding={1}>
            <Text dimColor>← select a record</Text>
          </Box>
        ) : detailView.mode === "edit" ? (
          <EntityEditor
            entity={selectedEntity}
            row={detailView.row}
            focused={detailFocused}
            onBack={() => {
              setDetailView({ mode: "detail" })
              if (!selectedRow) setActivePane("rows")
            }}
            onSaved={handleSaved}
          />
        ) : selectedRow ? (
          <EntityDetail
            entity={selectedEntity}
            row={selectedRow}
            focused={detailFocused}
            onBack={() => setActivePane("rows")}
            onEdit={() => setDetailView({ mode: "edit", row: selectedRow })}
          />
        ) : null}
      </Box>
    </Box>
  )
}
