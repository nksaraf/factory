import { ItemsAction } from "@rio.js/app-ui/components/items/items-action"
import { ItemsActionMenu } from "@rio.js/app-ui/components/items/items-actions"

import { useOpsAction } from "@/lib/ops"

interface ActionDef {
  action: string
  label: string
  icon: string
}

const ENTITY_ACTIONS: Record<string, ActionDef[]> = {
  workbenches: [
    { action: "start", label: "Start", icon: "icon-[ph--play-duotone]" },
    { action: "stop", label: "Stop", icon: "icon-[ph--stop-duotone]" },
    { action: "destroy", label: "Destroy", icon: "icon-[ph--trash-duotone]" },
    {
      action: "snapshot",
      label: "Snapshot",
      icon: "icon-[ph--camera-duotone]",
    },
  ],
  "component-deployments": [
    { action: "scale", label: "Scale", icon: "icon-[ph--arrows-out-duotone]" },
    {
      action: "restart",
      label: "Restart",
      icon: "icon-[ph--arrow-clockwise-duotone]",
    },
  ],
  databases: [
    { action: "backup", label: "Backup", icon: "icon-[ph--download-duotone]" },
    { action: "restore", label: "Restore", icon: "icon-[ph--upload-duotone]" },
    { action: "seed", label: "Seed", icon: "icon-[ph--plant-duotone]" },
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
  const mutation = useOpsAction(entityPath, entityId, def.action)
  return (
    <ItemsAction
      action={def.label}
      icon={def.icon}
      onClick={() => mutation.mutateAsync()}
    />
  )
}

export function OpsActionMenu({
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
