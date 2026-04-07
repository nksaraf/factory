import React, { useState, useMemo } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { TextInput } from "@inkjs/ui"
import { createEntityRecord, updateEntityRecord } from "../../hooks/use-entity-data.js"
import type { EntityDef } from "./entity-registry.js"

interface EntityEditorProps {
  entity: EntityDef
  row?: Record<string, unknown> // undefined = create mode
  focused: boolean
  onBack: () => void
  onSaved: () => void
}

const READONLY_KEYS = new Set([
  "id", "createdAt", "updatedAt",
  "validFrom", "validTo", "systemFrom", "systemTo",
  "changedBy", "changeReason",
  "generation", "observedGeneration",
])

interface FormField {
  key: string
  label: string
  path: string[] // for nested reconstruction
  readonly: boolean
}

function buildFormFields(row: Record<string, unknown> | undefined): FormField[] {
  const fields: FormField[] = []
  const sample = row ?? {}

  // Collect top-level scalar keys
  const topKeys = Object.keys(sample).filter(
    (k) => k !== "spec" && k !== "metadata"
  )

  for (const key of topKeys) {
    fields.push({
      key,
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      path: [key],
      readonly: READONLY_KEYS.has(key),
    })
  }

  // For create mode with no sample, add minimal fields
  if (!row) {
    if (!fields.some((f) => f.key === "name")) {
      fields.unshift({ key: "name", label: "Name", path: ["name"], readonly: false })
    }
    if (!fields.some((f) => f.key === "slug")) {
      fields.splice(1, 0, { key: "slug", label: "Slug", path: ["slug"], readonly: false })
    }
  }

  // Flatten spec one level
  const spec = (sample.spec ?? {}) as Record<string, unknown>
  if (Object.keys(spec).length > 0 || !row) {
    for (const [key, _] of Object.entries(spec)) {
      fields.push({
        key: `spec.${key}`,
        label: `spec.${key}`,
        path: ["spec", key],
        readonly: false,
      })
    }
  }

  // Metadata as raw JSON
  if (sample.metadata !== undefined || !row) {
    fields.push({
      key: "metadata",
      label: "metadata (JSON)",
      path: ["metadata"],
      readonly: false,
    })
  }

  return fields
}

function initFormValues(row: Record<string, unknown> | undefined, fields: FormField[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.path.length === 1) {
      const val = row?.[field.path[0]]
      if (field.key === "metadata") {
        values[field.key] = val ? JSON.stringify(val) : "{}"
      } else if (typeof val === "object" && val !== null) {
        values[field.key] = JSON.stringify(val)
      } else {
        values[field.key] = val != null ? String(val) : ""
      }
    } else if (field.path.length === 2) {
      const parent = (row?.[field.path[0]] ?? {}) as Record<string, unknown>
      const val = parent[field.path[1]]
      if (typeof val === "object" && val !== null) {
        values[field.key] = JSON.stringify(val)
      } else {
        values[field.key] = val != null ? String(val) : ""
      }
    }
  }
  return values
}

/** Coerce a string value back to its original type based on what the row had */
function coerce(raw: string, original: unknown): unknown {
  if (raw === "") return raw
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  // If the original value was a number, parse back to number
  if (typeof original === "number") {
    const n = Number(raw)
    if (!Number.isNaN(n)) return n
  }
  // If it looks like JSON object/array, try parsing
  if (/^\s*[{\[]/.test(raw)) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  return raw
}

function reconstructBody(
  values: Record<string, string>,
  fields: FormField[],
  originalRow: Record<string, unknown> | undefined
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const spec: Record<string, unknown> = {}
  let hasSpec = false
  const originalSpec = (originalRow?.spec ?? {}) as Record<string, unknown>

  for (const field of fields) {
    if (field.readonly) continue
    const raw = values[field.key]
    if (raw === undefined || raw === "") continue

    if (field.path[0] === "spec" && field.path.length === 2) {
      const origVal = originalSpec[field.path[1]]
      spec[field.path[1]] = coerce(raw, origVal)
      hasSpec = true
    } else if (field.key === "metadata") {
      try { body.metadata = JSON.parse(raw) } catch { body.metadata = {} }
    } else if (field.path.length === 1) {
      const origVal = originalRow?.[field.path[0]]
      body[field.path[0]] = coerce(raw, origVal)
    }
  }

  if (hasSpec) body.spec = spec

  return body
}

export function EntityEditor({ entity, row, focused, onBack, onSaved }: EntityEditorProps) {
  const isCreate = !row
  const fields = useMemo(() => buildFormFields(row), [row])
  const editableFields = useMemo(() => fields.filter((f) => !f.readonly), [fields])

  const [values, setValues] = useState(() => initFormValues(row, fields))
  const [activeField, setActiveField] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false) // whether text input is active

  const currentField = editableFields[activeField]

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body = reconstructBody(values, fields, row)
      if (isCreate) {
        await createEntityRecord(entity.module, entity.entity, body)
      } else {
        const slugOrId = (row!.slug as string) ?? (row!.id as string)
        await updateEntityRecord(entity.module, entity.entity, slugOrId, body)
      }
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
      else if (key.downArrow || input === "\t") setActiveField((f) => Math.min(editableFields.length - 1, f + 1))
      else if (key.return) setEditing(true)
      else if (input === "s" && key.ctrl) handleSave()
    },
    { isActive: focused }
  )

  const name = row
    ? ((row.name as string) ?? (row.slug as string) ?? (row.id as string) ?? "?")
    : "new"

  const { stdout } = useStdout()
  // 6 = tab bar + status bar + breadcrumb + field count + error line + padding
  const editorWindowSize = Math.max(8, (stdout.rows ?? 24) - 6)
  const scroll = Math.max(0, activeField - Math.floor(editorWindowSize / 2))
  const visible = editableFields.slice(scroll, scroll + editorWindowSize)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={2}>
        <Text bold color="cyan">{entity.module}</Text>
        <Text dimColor>›</Text>
        <Text bold>{entity.label}</Text>
        <Text dimColor>›</Text>
        <Text bold color={isCreate ? "green" : "white"}>{isCreate ? "Create New" : name}</Text>
        <Box flexGrow={1} />
        <Text dimColor>↑↓ fields  ↵ edit  ^S save  esc back</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {visible.map((field) => {
          const isActive = field.key === currentField?.key
          const val = values[field.key] ?? ""

          // Section separator for spec fields
          const showSpecHeader = field.key.startsWith("spec.") &&
            !editableFields[editableFields.indexOf(field) - 1]?.key.startsWith("spec.")

          return (
            <React.Fragment key={field.key}>
              {showSpecHeader && (
                <Box marginTop={1}>
                  <Text bold dimColor>── spec ──</Text>
                </Box>
              )}
              <Box>
                <Box width={24}>
                  <Text
                    color={isActive ? "cyan" : undefined}
                    bold={isActive}
                  >
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
                        // Auto-advance to next field
                        setActiveField((f) => Math.min(editableFields.length - 1, f + 1))
                      }}
                    />
                  ) : (
                    <Text color={isActive ? "white" : "gray"}>
                      {val || (isActive ? "↵ to edit" : "-")}
                    </Text>
                  )}
                </Box>
                {field.key.endsWith("Id") && (
                  <Text dimColor> (FK)</Text>
                )}
              </Box>
            </React.Fragment>
          )
        })}
      </Box>

      <Box paddingX={2} gap={3}>
        <Text dimColor>
          {activeField + 1}/{editableFields.length} fields
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
