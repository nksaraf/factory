import { Database, Table2 } from "lucide-react"

import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"

import type { ResourceDetail } from "../../../types"

function extractAttributes(resource: ResourceDetail) {
  return resource.blocks
    .filter((b) => b.blockType === "dataset_attribute")
    .map((b) => ({
      id: b.id,
      name: (b.data.name as string) ?? b.id,
      type: (b.data.type as string) ?? "string",
    }))
}

function extractRows(resource: ResourceDetail) {
  return resource.blocks
    .filter((b) => b.blockType === "dataset_row")
    .map((b) => b.data as Record<string, unknown>)
}

export function DatasetTableTab({ resource }: { resource: ResourceDetail }) {
  const attributes = extractAttributes(resource)
  const rows = extractRows(resource)

  if (attributes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Table2 className="h-12 w-12 opacity-30" />
        <p className="text-sm">No schema defined</p>
        <p className="text-xs opacity-60">
          Add dataset_attribute and dataset_row blocks to populate the table
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <Database className="h-3.5 w-3.5" />
        {rows.length.toLocaleString()} rows &middot; {attributes.length} columns
      </div>
      <ScrollArea className="flex-1">
        <div className="min-w-max">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                {attributes.map((attr) => (
                  <TableHead key={attr.id} className="min-w-[140px]">
                    <div className="flex flex-col gap-0.5">
                      <span>{attr.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground/60 font-mono">
                        {attr.type}
                      </span>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={attributes.length + 1}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No data rows
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    {attributes.map((attr) => (
                      <TableCell key={attr.id} className="text-sm font-mono">
                        {row[attr.name] !== undefined
                          ? String(row[attr.name])
                          : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  )
}
