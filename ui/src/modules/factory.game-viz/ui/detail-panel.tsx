import { useQuery } from "koota/react"

import {
  AssetKind,
  BuildStatus,
  EntityLabel,
  Position,
  Selected,
} from "../ecs/traits"
import { gameActions } from "../ecs/actions"
import { world } from "../ecs/world"

export function DetailPanel() {
  const selected = useQuery(Selected)

  if (selected.length === 0) return null

  const entity = selected[0]
  const label = entity.has(EntityLabel) ? entity.get(EntityLabel) : null
  const kind = entity.has(AssetKind) ? entity.get(AssetKind) : null
  const pos = entity.get(Position)
  const status = entity.has(BuildStatus) ? entity.get(BuildStatus) : null

  return (
    <div className="absolute right-4 top-4 w-72 rounded-lg bg-black/70 p-4 text-white backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">{label?.name ?? "Unknown"}</h3>
        <button
          className="text-white/40 hover:text-white/80"
          onClick={() => gameActions(world).deselect()}
        >
          x
        </button>
      </div>

      {label?.description && (
        <p className="mb-2 text-sm text-white/60">{label.description}</p>
      )}

      <div className="space-y-1 text-xs text-white/50">
        {kind && (
          <div className="flex justify-between">
            <span>Type</span>
            <span className="text-white/70">{kind.kind}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Position</span>
          <span className="text-white/70">
            {pos.x.toFixed(1)}, {pos.y.toFixed(1)}, {pos.z.toFixed(1)}
          </span>
        </div>
        {status && (
          <div className="flex justify-between">
            <span>Status</span>
            <span
              className={
                status.status === "success"
                  ? "text-green-400"
                  : status.status === "failed"
                    ? "text-red-400"
                    : status.status === "running"
                      ? "text-amber-400"
                      : "text-white/50"
              }
            >
              {status.status}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
