import { useParams } from "react-router"

import { Icon } from "@rio.js/ui/icon"

import { useHost } from "@/lib/infra"
import { HostLayout } from "../host-layout"

export default function HostTerminalTab() {
  const { slug } = useParams<{ slug: string }>()
  const { data: host } = useHost(slug)

  if (!host) return null

  const ipAddress = host.spec.ipAddress as string | undefined
  const accessMethod = (host.spec.accessMethod as string) ?? "ssh"
  const accessUser = (host.spec.accessUser as string) ?? "root"
  const sshPort = (host.spec.sshPort as number) ?? 22

  return (
    <HostLayout>
      <div className="space-y-6">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Icon
              icon="icon-[ph--terminal-window-duotone]"
              className="text-2xl text-muted-foreground"
            />
            <div>
              <h2 className="text-lg font-semibold">Terminal Access</h2>
              <p className="text-base text-muted-foreground">
                Connect to {host.name} via {accessMethod}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md bg-muted p-4 font-mono text-base">
              {accessMethod === "ssh" && ipAddress && (
                <span>
                  ssh {accessUser}@{ipAddress}
                  {sshPort !== 22 ? ` -p ${sshPort}` : ""}
                </span>
              )}
              {!ipAddress && (
                <span className="text-muted-foreground">
                  No IP address configured
                </span>
              )}
            </div>

            {host.spec.jumpHost && (
              <div className="text-base text-muted-foreground">
                Via jump host: {host.spec.jumpHost as string}
                {host.spec.jumpUser && ` (${host.spec.jumpUser as string})`}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <Icon
            icon="icon-[ph--terminal-window-duotone]"
            className="text-4xl text-muted-foreground mx-auto mb-3"
          />
          <h3 className="text-lg font-semibold mb-1">Web Terminal</h3>
          <p className="text-base text-muted-foreground">
            Interactive terminal sessions will be available here once dx
            sentinel mode is active on this host.
          </p>
        </div>
      </div>
    </HostLayout>
  )
}
