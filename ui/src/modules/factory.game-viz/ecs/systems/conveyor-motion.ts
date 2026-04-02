import type { World } from "koota"

import { BeltPosition, Crate, Position, Visible } from "../traits"

// Belt path constants — match spawn-build-hall.ts
const BELT_START_Z = -8
const BELT_END_Z = 8
const BELT_SPEED = 0.03 // units per second along t

export function conveyorMotionSystem(world: World, delta: number) {
  world.query(Crate, BeltPosition, Position, Visible).forEach((entity) => {
    const belt = entity.get(BeltPosition)
    const newT = (belt.t + BELT_SPEED * delta) % 1.0

    // Map t to world position along belt
    const z = BELT_START_Z + newT * (BELT_END_Z - BELT_START_Z)

    entity.set(BeltPosition, { t: newT })
    entity.set(Position, (prev) => ({ ...prev, z }))
  })
}
