import { Icon } from "@rio.js/ui/icon"
import { fromNow } from "@rio.js/ui/lib/fromnow"

import { RESOURCE_TYPE_CONFIG } from "../../constants/resource-config"
import { useWorkspaceActivity } from "../../data/use-workspace-activity"
import { useWorkbench } from "../workbench-context"

export function ActivityFeed() {
  const { workspaceId } = useWorkbench()
  const { data: activity } = useWorkspaceActivity(workspaceId)

  if (!activity?.length) return null

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Activity
      </h3>
      <div className="flex flex-col">
        {activity.map((item, i) => {
          const config = RESOURCE_TYPE_CONFIG[item.resourceType]
          return (
            <div key={item.id} className="relative flex gap-3 py-2.5">
              {i < activity.length - 1 && (
                <div className="absolute bottom-0 left-[13px] top-[36px] w-px bg-border" />
              )}
              <div
                className={`relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${config.bgClass}`}
              >
                <Icon
                  icon={config.icon}
                  className={`h-3 w-3 ${config.iconClass}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug">
                  <span className="font-medium">{item.actorName}</span>{" "}
                  <span className="text-muted-foreground">
                    {item.description}
                  </span>{" "}
                  <span className="font-medium">{item.resourceName}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fromNow(item.timestamp)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
