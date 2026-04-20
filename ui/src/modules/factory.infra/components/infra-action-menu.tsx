import { ItemsAction } from "@rio.js/app-ui/components/items/items-action"
import { ItemsActionMenu } from "@rio.js/app-ui/components/items/items-actions"

import { useInfraAction } from "@/lib/infra"

interface ActionDef {
  action: string
  label: string
  icon: string
}

const ENTITY_ACTIONS: Record<string, ActionDef[]> = {
  estates: [
    {
      action: "sync",
      label: "Sync",
      icon: "icon-[ph--arrows-clockwise-duotone]",
    },
  ],
  hosts: [
    { action: "start", label: "Start", icon: "icon-[ph--play-duotone]" },
    { action: "stop", label: "Stop", icon: "icon-[ph--stop-duotone]" },
    {
      action: "restart",
      label: "Restart",
      icon: "icon-[ph--arrow-clockwise-duotone]",
    },
    {
      action: "scan",
      label: "Scan",
      icon: "icon-[ph--magnifying-glass-duotone]",
    },
    {
      action: "snapshot",
      label: "Snapshot",
      icon: "icon-[ph--camera-duotone]",
    },
  ],
  realms: [
    {
      action: "upgrade",
      label: "Upgrade",
      icon: "icon-[ph--arrow-fat-up-duotone]",
    },
  ],
  "dns-domains": [
    {
      action: "verify",
      label: "Verify",
      icon: "icon-[ph--check-circle-duotone]",
    },
  ],
  tunnels: [
    { action: "close", label: "Close", icon: "icon-[ph--x-circle-duotone]" },
  ],
  secrets: [
    { action: "revoke", label: "Revoke", icon: "icon-[ph--prohibit-duotone]" },
  ],
}

function ActionItem({
  entityPath,
  entityId,
  def,
}: {
  entityPath: string
  entityId: string
  def: ActionDef
}) {
  const mutation = useInfraAction(entityPath, entityId, def.action)
  return (
    <ItemsAction
      action={def.label}
      icon={def.icon}
      onClick={() => mutation.mutateAsync()}
    />
  )
}

export function InfraActionMenu({
  entityPath,
  entityId,
}: {
  entityPath: string
  entityId: string
}) {
  const actions = ENTITY_ACTIONS[entityPath]
  if (!actions?.length) return null

  return (
    <ItemsActionMenu>
      {actions.map((def) => (
        <ActionItem
          key={def.action}
          entityPath={entityPath}
          entityId={entityId}
          def={def}
        />
      ))}
    </ItemsActionMenu>
  )
}
