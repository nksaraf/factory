import { Database, User } from "lucide-react"

import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import { Separator } from "@rio.js/ui/components/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"

import type { Block, ResourceDetail } from "../../../types"

function getColumnVariant(type: string) {
  switch (type.toLowerCase()) {
    case "string":
      return "String"
    case "int32":
    case "int64":
      return "Integer"
    case "double":
    case "float":
      return "Number"
    case "geometry":
      return "Geometry"
    case "boolean":
      return "Boolean"
    case "timestamp":
    case "date":
      return "Date"
    default:
      return type
  }
}

function MetadataField({
  label,
  children,
  showSeparator = true,
}: {
  label: string
  children: React.ReactNode
  showSeparator?: boolean
}) {
  return (
    <>
      <div className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </h3>
        <div>{children}</div>
      </div>
      {showSeparator && <Separator />}
    </>
  )
}

function extractDatasetMeta(resource: ResourceDetail) {
  const metaBlock = resource.blocks.find((b) => b.blockType === "dataset_meta")
  if (!metaBlock) return null
  return metaBlock.data as {
    kind?: string
    description?: string
    rowCount?: number
    source?: { type: string }
    bounds?: [number, number, number, number]
  }
}

function extractAttributes(resource: ResourceDetail) {
  return resource.blocks
    .filter((b) => b.blockType === "dataset_attribute")
    .map((b) => ({
      id: b.id,
      name: (b.data.name as string) ?? b.id,
      type: (b.data.type as string) ?? "string",
      description: b.data.description as string | undefined,
    }))
}

export function DatasetOverviewTab({ resource }: { resource: ResourceDetail }) {
  const meta = extractDatasetMeta(resource)
  const attributes = extractAttributes(resource)

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Main content — attributes table */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <h2 className="text-base font-semibold mb-4">Attributes</h2>
          {attributes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">No attributes defined</p>
              <p className="text-xs mt-1 text-muted-foreground/60">
                Add dataset_attribute blocks to define schema columns
              </p>
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Name</TableHead>
                    <TableHead className="w-[150px]">Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attributes.map((attr) => (
                    <TableRow key={attr.id}>
                      <TableCell className="font-medium font-mono text-sm">
                        {attr.name}
                      </TableCell>
                      <TableCell className="py-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-mono">
                          {getColumnVariant(attr.type)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {attr.description || (
                          <span className="italic opacity-50">
                            No description
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar — metadata */}
      <div className="w-72 border-l flex flex-col bg-muted/30">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <MetadataField label="Name">
              <p className="text-sm font-medium">{resource.name}</p>
            </MetadataField>

            {meta?.description && (
              <MetadataField label="Description">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {meta.description}
                </p>
              </MetadataField>
            )}

            <MetadataField label="Kind">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-medium">
                {meta?.kind || "table"}
              </span>
            </MetadataField>

            <MetadataField label="Last Updated">
              <p className="text-sm text-muted-foreground">
                {new Date(resource.updatedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </MetadataField>

            <MetadataField label="Created By">
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {resource.createdBy.slice(0, 8)}...
                </p>
              </div>
            </MetadataField>

            {meta?.source && (
              <MetadataField label="Source">
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-mono">
                  {meta.source.type}
                </span>
              </MetadataField>
            )}

            {(meta?.rowCount !== undefined || attributes.length > 0) && (
              <MetadataField label="Statistics" showSeparator={false}>
                <div className="space-y-1">
                  {meta?.rowCount !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Row Count</span>
                      <span className="font-medium">
                        {meta.rowCount.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Attributes</span>
                    <span className="font-medium">{attributes.length}</span>
                  </div>
                </div>
              </MetadataField>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
