import { TextInput } from "@inkjs/ui"
import type { EntityRelationshipType } from "@smp/factory-shared/schemas/org"
import { Box, Text, useInput, useStdout } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"

import { getFactoryRestClient } from "../../../client.js"
import { statusColor, timeAgo } from "../../components/data-table.js"
import {
  createEntityRecord,
  updateEntityRecord,
} from "../../hooks/use-entity-data.js"
import {
  type EntityDef,
  MODULE_GROUPS,
  entityToKind,
  resolveEntityById,
} from "./entity-registry.js"

interface EntityDetailProps {
  entity: EntityDef
  row: Record<string, unknown>
  focused: boolean
  onBack: () => void
  onNavigate: (entity: EntityDef, id: string) => void
  onSaved: () => void
}

const READONLY_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "validFrom",
  "validTo",
  "systemFrom",
  "systemTo",
  "changedBy",
  "changeReason",
  "generation",
  "observedGeneration",
])

const HIDDEN_KEYS = new Set(["id"])

interface FieldEntry {
  key: string
  label: string
  value: string
  rawValue: unknown
  path: string[]
  indent: number
  color?: string
  readonly: boolean
  isHeader: boolean
  // FK resolution
  isFk: boolean
  fkEntity: EntityDef | null
  fkId: string | null
  fkDisplayName: string | null // resolved async
}

interface DropdownState {
  options: { id: string; label: string }[]
  cursor: number
  filter: string
}

interface AssociationState {
  step: "type" | "entity" | "target"
  relationshipType?: EntityRelationshipType
  targetEntity?: EntityDef
  dropdown: DropdownState
  saving: boolean
}

const ASSOCIATION_TYPES: EntityRelationshipType[] = [
  "maps-to",
  "depends-on",
  "tracks",
  "consumes-api",
  "provides",
  "owned-by",
  "deployed-alongside",
  "triggers",
]

function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
}

function formatValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "-"
  if (typeof val === "boolean") return val ? "true" : "false"
  if (typeof val === "object") return JSON.stringify(val, null, 2)
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s))
    return `${s.slice(0, 19).replace("T", " ")} (${timeAgo(s)})`
  return s
}

function isFkField(key: string): boolean {
  return key.endsWith("Id") && key !== "id"
}

function buildFields(row: Record<string, unknown>): FieldEntry[] {
  const fields: FieldEntry[] = []

  for (const [key, val] of Object.entries(row)) {
    if (HIDDEN_KEYS.has(key)) continue
    if (key === "spec" || key === "metadata") continue

    const isFk = isFkField(key) && typeof val === "string"
    const fkEntity = isFk ? resolveEntityById(val as string) : null

    fields.push({
      key,
      label: formatLabel(key),
      value:
        typeof val === "object" && val !== null
          ? JSON.stringify(val)
          : formatValue(key, val),
      rawValue: val,
      path: [key],
      indent: 0,
      color:
        key === "status" && typeof val === "string"
          ? (statusColor(val) ?? undefined)
          : undefined,
      readonly: READONLY_KEYS.has(key),
      isHeader: false,
      isFk,
      fkEntity,
      fkId: isFk ? (val as string) : null,
      fkDisplayName: null,
    })
  }

  // Spec expanded
  const spec = row.spec
  if (spec && typeof spec === "object") {
    fields.push({
      key: "__spec_header",
      label: "── spec ──",
      value: "",
      rawValue: null,
      path: [],
      indent: 0,
      readonly: true,
      isHeader: true,
      isFk: false,
      fkEntity: null,
      fkId: null,
      fkDisplayName: null,
    })
    for (const [key, val] of Object.entries(spec as Record<string, unknown>)) {
      const isFk = isFkField(key) && typeof val === "string"
      const fkEntity = isFk ? resolveEntityById(val as string) : null
      fields.push({
        key: `spec.${key}`,
        label: formatLabel(key),
        value: formatValue(key, val),
        rawValue: val,
        path: ["spec", key],
        indent: 2,
        readonly: false,
        isHeader: false,
        isFk,
        fkEntity,
        fkId: isFk ? (val as string) : null,
        fkDisplayName: null,
      })
    }
  }

  // Metadata expanded
  const metadata = row.metadata
  if (
    metadata &&
    typeof metadata === "object" &&
    Object.keys(metadata as object).length > 0
  ) {
    fields.push({
      key: "__metadata_header",
      label: "── metadata ──",
      value: "",
      rawValue: null,
      path: [],
      indent: 0,
      readonly: true,
      isHeader: true,
      isFk: false,
      fkEntity: null,
      fkId: null,
      fkDisplayName: null,
    })
    for (const [key, val] of Object.entries(
      metadata as Record<string, unknown>
    )) {
      fields.push({
        key: `metadata.${key}`,
        label: formatLabel(key),
        value: formatValue(key, val),
        rawValue: val,
        path: ["metadata", key],
        indent: 2,
        readonly: false,
        isHeader: false,
        isFk: false,
        fkEntity: null,
        fkId: null,
        fkDisplayName: null,
      })
    }
  }

  return fields
}

/** Coerce a string value back to its original type */
function coerce(raw: string, original: unknown): unknown {
  if (raw === "") return raw
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  if (typeof original === "number") {
    const n = Number(raw)
    if (!Number.isNaN(n)) return n
  }
  if (/^\s*[{\[]/.test(raw)) {
    try {
      return JSON.parse(raw)
    } catch {
      /* fall through */
    }
  }
  return raw
}

export function EntityDetail({
  entity,
  row,
  focused,
  onBack,
  onNavigate,
  onSaved,
}: EntityDetailProps) {
  const fields = useMemo(() => buildFields(row), [row])
  const selectableFields = useMemo(
    () => fields.map((f, i) => (!f.isHeader ? i : -1)).filter((i) => i >= 0),
    [fields]
  )
  const maxLabel = Math.max(
    ...fields.filter((f) => !f.isHeader).map((f) => f.label.length + f.indent),
    10
  )

  const [cursorIdx, setCursorIdx] = useState(0) // index into selectableFields
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // FK resolution cache: fkId → display name
  const [fkNames, setFkNames] = useState<Record<string, string>>({})
  // FK dropdown state
  const [fkDropdown, setFkDropdown] = useState<DropdownState | null>(null)
  const [association, setAssociation] = useState<AssociationState | null>(null)

  const { stdout } = useStdout()
  const windowSize = Math.max(10, (stdout.rows ?? 24) - 5)

  const activeFieldIdx = selectableFields[cursorIdx] ?? 0
  const activeField = fields[activeFieldIdx]

  // Resolve FK display names on mount
  useEffect(() => {
    const fkFields = fields.filter((f) => f.isFk && f.fkEntity && f.fkId)
    if (fkFields.length === 0) return
    let cancelled = false

    async function resolve() {
      const client = await getFactoryRestClient()
      const results: Record<string, string> = {}
      await Promise.all(
        fkFields.map(async (f) => {
          try {
            const res = await client.getEntity(
              f.fkEntity!.module,
              f.fkEntity!.entity,
              f.fkId!
            )
            const data = res.data
            if (data) {
              results[f.fkId!] =
                (data.name as string) ?? (data.slug as string) ?? f.fkId!
            }
          } catch {
            // Silently ignore resolution failures
          }
        })
      )
      if (!cancelled) setFkNames(results)
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [row])

  const isDirty = Object.keys(editValues).length > 0

  const handleSave = useCallback(async () => {
    if (!isDirty) return
    setSaving(true)
    setError(null)
    const body: Record<string, unknown> = {}
    try {
      let hasSpecEdit = false
      const originalSpec = (row.spec ?? {}) as Record<string, unknown>

      for (const [key, raw] of Object.entries(editValues)) {
        const field = fields.find((f) => f.key === key)
        if (!field || field.readonly) continue

        if (field.path[0] === "spec" && field.path.length === 2) {
          hasSpecEdit = true
        } else if (key === "metadata") {
          try {
            body.metadata = JSON.parse(raw)
          } catch {
            body.metadata = {}
          }
        } else if (field.path.length === 1) {
          body[field.path[0]] = coerce(raw, row[field.path[0]])
        }
      }
      // When any spec field was edited, send the full spec with edits applied
      if (hasSpecEdit) {
        const fullSpec = { ...originalSpec }
        for (const [key, raw] of Object.entries(editValues)) {
          const field = fields.find((f) => f.key === key)
          if (field?.path[0] === "spec" && field.path.length === 2) {
            fullSpec[field.path[1]] = coerce(raw, originalSpec[field.path[1]])
          }
        }
        body.spec = fullSpec
      }

      const slugOrId = (row.slug as string) ?? (row.id as string)
      await updateEntityRecord(entity.module, entity.entity, slugOrId, body)
      setEditValues({})
      setError(null)
      setNotice("Saved changes")
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }, [editValues, entity, fields, isDirty, onSaved, row])

  // Load FK options for dropdown
  const openFkDropdown = useCallback(async (field: FieldEntry) => {
    if (!field.fkEntity) return
    try {
      const client = await getFactoryRestClient()
      const res = await client.listEntities(
        field.fkEntity.module,
        field.fkEntity.entity
      )
      const items = (res.data as Record<string, unknown>[]) ?? []
      setFkDropdown({
        options: items.map((item) => ({
          id: item.id as string,
          label: `${(item.name as string) ?? (item.slug as string) ?? "?"} (${item.id})`,
        })),
        cursor: 0,
        filter: "",
      })
    } catch {
      // Fall back to text editing
      setEditing(true)
    }
  }, [])

  const openAssociation = useCallback(() => {
    const sourceKind = entityToKind(entity)
    if (!sourceKind || typeof row.id !== "string") {
      setError(`Associations are not supported for ${entity.label}.`)
      return
    }

    setNotice(null)
    setError(null)
    setAssociation({
      step: "type",
      dropdown: {
        options: ASSOCIATION_TYPES.map((type) => ({ id: type, label: type })),
        cursor: 0,
        filter: "",
      },
      saving: false,
    })
  }, [entity, row.id])

  const advanceAssociation = useCallback(
    async (selectedId: string) => {
      if (!association) return

      if (association.step === "type") {
        const entityOptions = MODULE_GROUPS.flatMap((group) => group.entities)
          .filter((candidate) => entityToKind(candidate))
          .map((candidate) => ({
            id: `${candidate.module}/${candidate.entity}`,
            label: `${candidate.label} (${candidate.module})`,
          }))

        setAssociation({
          step: "entity",
          relationshipType: selectedId as EntityRelationshipType,
          dropdown: {
            options: entityOptions,
            cursor: 0,
            filter: "",
          },
          saving: false,
        })
        return
      }

      if (association.step === "entity") {
        const targetEntity = MODULE_GROUPS.flatMap(
          (group) => group.entities
        ).find(
          (candidate) =>
            `${candidate.module}/${candidate.entity}` === selectedId
        )

        if (!targetEntity) {
          setError(`Unknown target entity type: ${selectedId}`)
          return
        }

        const client = await getFactoryRestClient()
        const res = await client.listEntities(
          targetEntity.module,
          targetEntity.entity
        )
        const rows = (res.data as Record<string, unknown>[]) ?? []
        setAssociation({
          step: "target",
          relationshipType: association.relationshipType,
          targetEntity,
          dropdown: {
            options: rows.map((item) => ({
              id: item.id as string,
              label: `${(item.name as string) ?? (item.slug as string) ?? "?"} (${item.id as string})`,
            })),
            cursor: 0,
            filter: "",
          },
          saving: false,
        })
        return
      }

      if (!association.relationshipType || !association.targetEntity) {
        setError("Association setup is incomplete.")
        return
      }

      const sourceKind = entityToKind(entity)
      const targetKind = entityToKind(association.targetEntity)
      if (!sourceKind || !targetKind || typeof row.id !== "string") {
        setError("Could not resolve entity kinds for association.")
        return
      }

      setAssociation((current) =>
        current ? { ...current, saving: true } : current
      )
      try {
        await createEntityRecord("org", "entity-relationships", {
          type: association.relationshipType,
          sourceKind,
          sourceId: row.id,
          targetKind,
          targetId: selectedId,
          spec: {},
        })
        setAssociation(null)
        setNotice(
          `Associated ${entity.label} via ${association.relationshipType}.`
        )
        onSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setAssociation((current) =>
          current ? { ...current, saving: false } : current
        )
      }
    },
    [association, entity, onSaved, row.id]
  )

  useInput(
    (input, key) => {
      if (!focused) return

      if (association) {
        const filtered = association.dropdown.options.filter((option) =>
          option.label
            .toLowerCase()
            .includes(association.dropdown.filter.toLowerCase())
        )
        if (key.escape) {
          setAssociation(null)
          return
        }
        if (key.upArrow) {
          setAssociation((current) =>
            current
              ? {
                  ...current,
                  dropdown: {
                    ...current.dropdown,
                    cursor: Math.max(0, current.dropdown.cursor - 1),
                  },
                }
              : null
          )
          return
        }
        if (key.downArrow) {
          setAssociation((current) =>
            current
              ? {
                  ...current,
                  dropdown: {
                    ...current.dropdown,
                    cursor: Math.min(
                      Math.max(filtered.length - 1, 0),
                      current.dropdown.cursor + 1
                    ),
                  },
                }
              : null
          )
          return
        }
        if (key.return && filtered[association.dropdown.cursor]) {
          void advanceAssociation(filtered[association.dropdown.cursor]!.id)
          return
        }
        if (key.backspace || key.delete) {
          setAssociation((current) =>
            current
              ? {
                  ...current,
                  dropdown: {
                    ...current.dropdown,
                    filter: current.dropdown.filter.slice(0, -1),
                    cursor: 0,
                  },
                }
              : null
          )
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setAssociation((current) =>
            current
              ? {
                  ...current,
                  dropdown: {
                    ...current.dropdown,
                    filter: current.dropdown.filter + input,
                    cursor: 0,
                  },
                }
              : null
          )
          return
        }
        return
      }

      // FK dropdown mode
      if (fkDropdown) {
        const filtered = fkDropdown.options.filter((o) =>
          o.label.toLowerCase().includes(fkDropdown.filter.toLowerCase())
        )
        if (key.escape) {
          setFkDropdown(null)
          return
        }
        if (key.upArrow) {
          setFkDropdown((d) =>
            d ? { ...d, cursor: Math.max(0, d.cursor - 1) } : null
          )
          return
        }
        if (key.downArrow) {
          setFkDropdown((d) =>
            d
              ? { ...d, cursor: Math.min(filtered.length - 1, d.cursor + 1) }
              : null
          )
          return
        }
        if (key.return && filtered[fkDropdown.cursor]) {
          const selected = filtered[fkDropdown.cursor]
          setEditValues((prev) => ({ ...prev, [activeField.key]: selected.id }))
          setFkNames((prev) => ({
            ...prev,
            [selected.id]: selected.label.split(" (")[0],
          }))
          setFkDropdown(null)
          return
        }
        if (key.backspace || key.delete) {
          setFkDropdown((d) =>
            d ? { ...d, filter: d.filter.slice(0, -1), cursor: 0 } : null
          )
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setFkDropdown((d) =>
            d ? { ...d, filter: d.filter + input, cursor: 0 } : null
          )
          return
        }
        return
      }

      // Text editing mode
      if (editing) return // TextInput handles its own input

      // Normal navigation
      if (key.escape) {
        onBack()
      } else if (key.upArrow) {
        setCursorIdx((c) => Math.max(0, c - 1))
      } else if (key.downArrow) {
        setCursorIdx((c) => Math.min(selectableFields.length - 1, c + 1))
      } else if (key.return) {
        if (
          activeField?.isFk &&
          activeField.fkEntity &&
          !activeField.readonly
        ) {
          openFkDropdown(activeField)
        } else if (
          activeField?.isFk &&
          activeField.fkEntity &&
          activeField.fkId
        ) {
          // Navigate to referenced entity
          onNavigate(activeField.fkEntity, activeField.fkId)
        } else if (!activeField?.readonly) {
          setEditing(true)
        }
      } else if (
        input === "g" &&
        activeField?.isFk &&
        activeField.fkEntity &&
        activeField.fkId
      ) {
        onNavigate(activeField.fkEntity, activeField.fkId)
      } else if (input === "a") {
        openAssociation()
      } else if (input === "s" && key.ctrl) {
        handleSave()
      }
    },
    { isActive: focused }
  )

  const name =
    (row.name as string) ?? (row.slug as string) ?? (row.id as string) ?? "?"

  // Scrolling
  const scrollStart = Math.max(0, activeFieldIdx - Math.floor(windowSize / 2))
  const visible = fields.slice(scrollStart, scrollStart + windowSize)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={2}>
        <Text bold color="cyan">
          {entity.module}
        </Text>
        <Text dimColor>›</Text>
        <Text bold>{entity.label}</Text>
        <Text dimColor>›</Text>
        <Text bold color="white">
          {name}
        </Text>
        {isDirty && <Text color="yellow">(modified)</Text>}
        <Box flexGrow={1} />
        <Text dimColor>
          ↵ edit a associate {isDirty ? "^S save  " : ""}g goto FK esc back
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {visible.map((field) => {
          if (field.isHeader) {
            return (
              <Box key={field.key} marginTop={1}>
                <Text bold dimColor>
                  {field.label}
                </Text>
              </Box>
            )
          }

          const isActive = field === activeField && focused
          const editedVal = editValues[field.key]
          const displayVal = editedVal !== undefined ? editedVal : field.value
          const isModified = editedVal !== undefined

          // FK display
          const fkName = field.fkId ? fkNames[editedVal ?? field.fkId] : null

          return (
            <Box key={field.key}>
              <Box width={maxLabel + 4}>
                <Text
                  dimColor={!isActive}
                  color={isActive ? "cyan" : undefined}
                  bold={isActive}
                >
                  {"  ".repeat(field.indent / 2)}
                  {isActive ? "› " : "  "}
                  {field.label.padEnd(maxLabel - field.indent)}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {isActive && editing ? (
                  <TextInput
                    defaultValue={displayVal}
                    onSubmit={(newVal) => {
                      if (newVal !== field.value) {
                        setEditValues((prev) => ({
                          ...prev,
                          [field.key]: newVal,
                        }))
                      }
                      setEditing(false)
                    }}
                  />
                ) : isActive && fkDropdown ? (
                  <SelectionDropdown
                    dropdown={fkDropdown}
                    footer="type to filter  ↵ select  esc cancel"
                  />
                ) : (
                  <>
                    {field.color ? (
                      <Text color={field.color}>● {displayVal}</Text>
                    ) : field.readonly ? (
                      <Text dimColor>{displayVal}</Text>
                    ) : (
                      <Text
                        color={
                          isModified ? "yellow" : isActive ? "white" : undefined
                        }
                      >
                        {displayVal || "-"}
                      </Text>
                    )}
                    {field.isFk && fkName && (
                      <Text color={isActive ? "cyan" : "blue"}>
                        {" "}
                        → {fkName}
                      </Text>
                    )}
                    {field.isFk && !fkName && field.fkEntity && (
                      <Text dimColor> ({field.fkEntity.label})</Text>
                    )}
                    {isActive && !field.readonly && (
                      <Text dimColor>
                        {" "}
                        {field.isFk ? "↵ select" : "↵ edit"}
                      </Text>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      <Box paddingX={2} gap={2}>
        <Text dimColor>
          {cursorIdx + 1}/{selectableFields.length}
          {saving && "  saving..."}
        </Text>
      </Box>

      {association && (
        <Box paddingX={2} flexDirection="column">
          <Text color="cyan">
            {association.step === "type"
              ? "Associate: choose relationship type"
              : association.step === "entity"
                ? "Associate: choose target entity type"
                : `Associate: choose ${association.targetEntity?.label ?? "target"}`}
          </Text>
          <SelectionDropdown
            dropdown={association.dropdown}
            footer={
              association.saving
                ? "creating association..."
                : "type to filter  ↵ select  esc cancel"
            }
          />
        </Box>
      )}

      {error && (
        <Box paddingX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {notice && (
        <Box paddingX={2}>
          <Text color="green">{notice}</Text>
        </Box>
      )}
    </Box>
  )
}

function SelectionDropdown({
  dropdown,
  footer,
}: {
  dropdown: DropdownState
  footer: string
}) {
  const filtered = dropdown.options.filter((o) =>
    o.label.toLowerCase().includes(dropdown.filter.toLowerCase())
  )
  const windowSize = Math.min(8, filtered.length)
  const start = Math.max(0, dropdown.cursor - Math.floor(windowSize / 2))
  const visible = filtered.slice(start, start + windowSize)

  return (
    <Box flexDirection="column">
      {dropdown.filter && (
        <Box>
          <Text color="yellow">/</Text>
          <Text>{dropdown.filter}</Text>
          <Text color="yellow">▌</Text>
        </Box>
      )}
      {visible.length === 0 ? (
        <Text dimColor>no match</Text>
      ) : (
        visible.map((opt, i) => {
          const isCursor = start + i === dropdown.cursor
          return (
            <Box key={opt.id}>
              <Text
                backgroundColor={isCursor ? "blue" : undefined}
                color={isCursor ? "white" : undefined}
              >
                {isCursor ? "› " : "  "}
                {opt.label}
              </Text>
            </Box>
          )
        })
      )}
      <Text dimColor>
        {filtered.length} options {footer}
      </Text>
    </Box>
  )
}
