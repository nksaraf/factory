import { useFrame } from "@react-three/fiber"
import { useWorld } from "koota/react"

import { conveyorMotionSystem } from "./conveyor-motion"
import { workerMovementSystem } from "./worker-movement"

export function SystemsRunner() {
  const world = useWorld()

  useFrame((_, delta) => {
    // Clamp delta to prevent large jumps on tab-switch
    const dt = Math.min(delta, 0.1)

    conveyorMotionSystem(world, dt)
    workerMovementSystem(world, dt)
  })

  return null
}
