import React from "react"
import { Box, Text } from "ink"
import { DataTable, type Column, timeAgo } from "../components/data-table.js"
import { useCustomers } from "../hooks/use-fleet-data.js"

interface CommerceTabProps {
  focused: boolean
}

const CUSTOMER_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 36, slugKey: "slug" },
  { header: "Status", key: "status", width: 14 },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

export function CommerceTab({ focused }: CommerceTabProps) {
  const customersQuery = useCustomers()
  const customers = customersQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">
          Customers ({customers.length})
        </Text>
      </Box>

      <DataTable
        columns={CUSTOMER_COLUMNS}
        rows={customers}
        focused={focused}
        emptyMessage="No customers."
      />
    </Box>
  )
}
