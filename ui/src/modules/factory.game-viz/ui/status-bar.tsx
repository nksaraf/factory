import { useQuery } from "koota/react"

import {
  ConveyorBelt,
  Crate,
  LoadingDock,
  RoboticArm,
  ShelfUnit,
  Visible,
  Worker,
} from "../ecs/traits"

export function StatusBar() {
  const docks = useQuery(LoadingDock, Visible)
  const conveyors = useQuery(ConveyorBelt, Visible)
  const crates = useQuery(Crate, Visible)
  const arms = useQuery(RoboticArm, Visible)
  const shelves = useQuery(ShelfUnit, Visible)
  const workers = useQuery(Worker, Visible)

  const total =
    docks.length +
    conveyors.length +
    crates.length +
    arms.length +
    shelves.length +
    workers.length

  return (
    <div className="absolute bottom-4 left-4 flex gap-3 rounded-lg bg-black/60 px-4 py-2 text-xs text-white/70 backdrop-blur-sm">
      <span>Build Hall</span>
      <span className="text-white/30">|</span>
      <span>{docks.length} docks</span>
      <span>{crates.length} builds</span>
      <span>{shelves.length} artifacts</span>
      <span>{workers.length} workers</span>
      <span className="text-white/30">|</span>
      <span>{total} entities</span>
    </div>
  )
}
