import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { EntitySelector } from "./entity-selector.js"
import { EntityRowList } from "./entity-row-list.js"
import { EntityDetail } from "./entity-detail.js"
import { EntityEditor } from "./entity-editor.js"
import { useEntityData } from "../../hooks/use-entity-data.js"
import { getFactoryRestClient } from "../../../client.js"
import type { EntityDef } from "./entity-registry.js"

interface ExplorerTabProps {
  focused: boolean
}

type Pane = "types" | "rows" | "detail"

type DetailView = { mode: "detail" } | { mode: "create" }

export function ExplorerTab({ focused }: ExplorerTabProps) {
  const [activePane, setActivePane] = useState<Pane>("types")
  const [selectedEntity, setSelectedEntity] = useState<EntityDef | null>(null)
  const [selectedRow, setSelectedRow] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [detailView, setDetailView] = useState<DetailView>({ mode: "detail" })

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
      // Escape is handled by each pane's onBack callback, not here,
      // to avoid conflicting with pane-internal escape actions (close dropdown, cancel edit, etc.)
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
  }

  async function handleNavigate(targetEntity: EntityDef, id: string) {
    // Switch to the target entity and load the specific row
    setSelectedEntity(targetEntity)
    setDetailView({ mode: "detail" })
    setActivePane("detail")
    try {
      const client = await getFactoryRestClient()
      const res = await client.getEntity(
        targetEntity.module,
        targetEntity.entity,
        id
      )
      if (res.data) {
        setSelectedRow(res.data)
      }
    } catch {
      // If we can't fetch it, just switch to the entity list
      setSelectedRow(null)
      setActivePane("rows")
    }
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
              setDetailView({ mode: "create" })
              setActivePane("detail")
            }}
            onBack={() => setActivePane("types")}
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
        ) : detailView.mode === "create" ? (
          <EntityEditor
            entity={selectedEntity}
            focused={detailFocused}
            onBack={() => {
              setDetailView({ mode: "detail" })
              setActivePane("rows")
            }}
            onSaved={handleSaved}
          />
        ) : !selectedRow ? (
          <Box padding={1}>
            <Text dimColor>← select a record</Text>
          </Box>
        ) : (
          <EntityDetail
            entity={selectedEntity}
            row={selectedRow}
            focused={detailFocused}
            onBack={() => setActivePane("rows")}
            onNavigate={handleNavigate}
            onSaved={handleSaved}
          />
        )}
      </Box>
    </Box>
  )
}
