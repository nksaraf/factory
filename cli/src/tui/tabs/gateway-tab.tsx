import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { DataTable, type Column, type DetailField, timeAgo } from "../components/data-table.js"
import { useRoutes, useDomains } from "../hooks/use-infra-data.js"

interface GatewayTabProps {
  focused: boolean
}

type SubView = "routes" | "domains"

const ROUTE_COLUMNS: Column[] = [
  { header: "Path", key: "pathPrefix", width: 20, format: (v: any) => v ?? "/" },
  { header: "Domain", key: "domain", width: 28 },
  { header: "Target", key: "targetService", width: 20 },
  { header: "Port", key: "targetPort", width: 8, format: (v: any) => String(v ?? "-") },
  { header: "Kind", key: "kind", width: 10 },
  { header: "Status", key: "status", width: 12 },
  { header: "TLS", key: "tlsMode", width: 10, format: (v: any) => v ?? "-" },
]

const DOMAIN_COLUMNS: Column[] = [
  { header: "FQDN", key: "fqdn", width: 34 },
  { header: "Kind", key: "kind", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "DNS", key: "dnsVerified", width: 8, format: (v: any) => v ? "yes" : "no" },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

export function GatewayTab({ focused }: GatewayTabProps) {
  const [subView, setSubView] = useState<SubView>("routes")
  const routesQuery = useRoutes()
  const domainsQuery = useDomains()

  useInput(
    (input) => {
      if (!focused) return
      if (input === "r") setSubView("routes")
      else if (input === "d") setSubView("domains")
    },
    { isActive: focused }
  )

  const routes = routesQuery.data ?? []
  const domains = domainsQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1} gap={2}>
        <Text bold={subView === "routes"} color={subView === "routes" ? "cyan" : "gray"}>
          [r] Routes ({routes.length})
        </Text>
        <Text bold={subView === "domains"} color={subView === "domains" ? "cyan" : "gray"}>
          [d] Domains ({domains.length})
        </Text>
      </Box>

      {subView === "routes" && (
        <DataTable
          columns={ROUTE_COLUMNS}
          rows={routes}
          focused={focused}
          emptyMessage="No gateway routes configured."
          detailFields={[
            { label: "Domain", key: "domain" },
            { label: "Path", key: "pathPrefix", format: (v: any) => v ?? "/" },
            { label: "Target", key: "targetService" },
            { label: "Port", key: "targetPort", format: (v: any) => String(v ?? "-") },
            { label: "Kind", key: "kind" },
            { label: "Protocol", key: "protocol" },
            { label: "TLS", key: "tlsMode" },
            { label: "Status", key: "status" },
            { label: "Priority", key: "priority", format: (v: any) => String(v ?? 100) },
            { label: "Created By", key: "createdBy" },
            { label: "Created", key: "createdAt", format: (v: any) => timeAgo(v) },
          ]}
        />
      )}

      {subView === "domains" && (
        <DataTable
          columns={DOMAIN_COLUMNS}
          rows={domains}
          focused={focused}
          emptyMessage="No domains registered."
          detailFields={[
            { label: "FQDN", key: "fqdn" },
            { label: "Kind", key: "kind" },
            { label: "Status", key: "status" },
            { label: "DNS Verified", key: "dnsVerified", format: (v: any) => v ? "yes" : "no" },
            { label: "TLS Cert", key: "tlsCertRef" },
            { label: "Created By", key: "createdBy" },
            { label: "Created", key: "createdAt", format: (v: any) => timeAgo(v) },
          ]}
        />
      )}
    </Box>
  )
}
