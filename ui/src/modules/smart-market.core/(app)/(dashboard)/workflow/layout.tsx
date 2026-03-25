import { Suspense } from "react"

import { RioClient } from "@rio.js/client"

export async function loader() {
  const rio = RioClient.instance
  await rio.extensions.enable("gis.flows", "smart-market.flows")
  return null
}

export default function WorkflowLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Suspense>{children}</Suspense>
}
