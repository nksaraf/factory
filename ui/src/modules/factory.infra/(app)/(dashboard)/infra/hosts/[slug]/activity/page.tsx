import { useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { useHostRaw as useHost } from "@/lib/infra"
import { HostLayout } from "../host-layout"

export default function HostActivityTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: host } = useHost(slug)

  if (!host) return null

  const lastCommand = host.spec.lastCommand as string | undefined

  return (
    <HostLayout>
      <div className="space-y-6">
        {lastCommand && (
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-base font-semibold mb-2">Last Command</h3>
            <code className="rounded-md bg-muted px-3 py-2 font-mono text-base block">
              {lastCommand}
            </code>
          </div>
        )}

        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <Icon
            icon="icon-[ph--clock-counter-clockwise-duotone]"
            className="text-4xl text-muted-foreground mx-auto mb-3"
          />
          <h3 className="text-lg font-semibold mb-1">Activity Log</h3>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            Shell command history, login sessions, and system events will be
            tracked here once dx sentinel is active. This includes who logged
            in, when, and what commands were executed.
          </p>
        </div>
      </div>
    </HostLayout>
  )
}
