import React, { useState, useMemo } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { TextInput } from "@inkjs/ui"
import { createEntityRecord } from "../../hooks/use-entity-data.js"
import type { EntityDef } from "./entity-registry.js"

interface EntityEditorProps {
  entity: EntityDef
  focused: boolean
  onBack: () => void
  onSaved: () => void
}

interface FormField {
  key: string
  label: string
  path: string[]
}

function buildCreateFields(): FormField[] {
  return [
    { key: "name", label: "Name", path: ["name"] },
    { key: "slug", label: "Slug", path: ["slug"] },
    { key: "type", label: "Type", path: ["type"] },
  ]
}

export function EntityEditor({ entity, focused, onBack, onSaved }: EntityEditorProps) {
  const fields = useMemo(() => buildCreateFields(), [])

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeField, setActiveField] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const currentField = fields[activeField]

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      for (const field of fields) {
        const raw = values[field.key]
        if (raw) body[field.path[0]] = raw
      }
      await createEntityRecord(entity.module, entity.entity, body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  useInput(
    (input, key) => {
      if (!focused || editing) return
      if (key.escape) onBack()
      else if (key.upArrow) setActiveField((f) => Math.max(0, f - 1))
      else if (key.downArrow) setActiveField((f) => Math.min(fields.length - 1, f + 1))
      else if (key.return) setEditing(true)
      else if (input === "s" && key.ctrl) handleSave()
    },
    { isActive: focused }
  )

  const { stdout } = useStdout()
  const editorWindowSize = Math.max(8, (stdout.rows ?? 24) - 6)
  const scroll = Math.max(0, activeField - Math.floor(editorWindowSize / 2))
  const visible = fields.slice(scroll, scroll + editorWindowSize)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={2}>
        <Text bold color="cyan">{entity.module}</Text>
        <Text dimColor>›</Text>
        <Text bold>{entity.label}</Text>
        <Text dimColor>›</Text>
        <Text bold color="green">Create New</Text>
        <Box flexGrow={1} />
        <Text dimColor>↑↓ fields  ↵ edit  ^S save  esc back</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {visible.map((field) => {
          const isActive = field.key === currentField?.key
          const val = values[field.key] ?? ""

          return (
            <Box key={field.key}>
              <Box width={24}>
                <Text color={isActive ? "cyan" : undefined} bold={isActive}>
                  {isActive ? "› " : "  "}{field.label}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {isActive && editing ? (
                  <TextInput
                    defaultValue={val}
                    onSubmit={(newVal) => {
                      setValues((prev) => ({ ...prev, [field.key]: newVal }))
                      setEditing(false)
                      setActiveField((f) => Math.min(fields.length - 1, f + 1))
                    }}
                  />
                ) : (
                  <Text color={isActive ? "white" : "gray"}>
                    {val || (isActive ? "↵ to edit" : "-")}
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      <Box paddingX={2} gap={3}>
        <Text dimColor>
          {activeField + 1}/{fields.length} fields
          {saving && "  saving..."}
        </Text>
      </Box>

      {error && (
        <Box paddingX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  )
}
