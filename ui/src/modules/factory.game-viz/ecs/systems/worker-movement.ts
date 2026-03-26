import type { World } from "koota"

import { Position, Target, Visible, Worker } from "../traits"

const WORKER_SPEED = 1.5 // units per second
const ARRIVAL_THRESHOLD = 0.3
const PATROL_RANGE = 3

export function workerMovementSystem(world: World, delta: number) {
  world.query(Worker, Position, Visible).forEach((entity) => {
    // If no target, pick a random nearby patrol point
    if (!entity.has(Target)) {
      const pos = entity.get(Position)
      entity.add(
        Target({
          x: pos.x + (Math.random() - 0.5) * PATROL_RANGE,
          y: 0,
          z: pos.z + (Math.random() - 0.5) * PATROL_RANGE,
        })
      )
      return
    }

    const pos = entity.get(Position)
    const target = entity.get(Target)

    const dx = target.x - pos.x
    const dz = target.z - pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < ARRIVAL_THRESHOLD) {
      // Arrived — remove target, will pick new one next frame
      entity.remove(Target)
      return
    }

    // Move toward target
    const step = Math.min(WORKER_SPEED * delta, dist)
    const nx = dx / dist
    const nz = dz / dist

    entity.set(Position, (prev) => ({
      ...prev,
      x: prev.x + nx * step,
      z: prev.z + nz * step,
    }))

    // Face movement direction
    const angle = Math.atan2(nx, nz)
    entity.set(Position, (prev) => prev) // trigger re-render
    // Note: Rotation update would go here if workers had Rotation trait in query
  })
}
