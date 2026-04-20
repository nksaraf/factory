import { Icon } from "@rio.js/ui/icon"

import { HostLayout } from "../host-layout"

export default function HostFilesTab() {
  return (
    <HostLayout>
      <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
        <Icon
          icon="icon-[ph--folder-open-duotone]"
          className="text-4xl text-muted-foreground mx-auto mb-3"
        />
        <h3 className="text-lg font-semibold mb-1">File System</h3>
        <p className="text-base text-muted-foreground">
          Browse and manage files on this host. Requires dx sentinel mode to be
          active.
        </p>
      </div>
    </HostLayout>
  )
}
