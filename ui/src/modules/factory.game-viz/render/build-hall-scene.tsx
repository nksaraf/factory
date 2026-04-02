import { ArmInstances } from "./buckets/arm-instances"
import { ConveyorInstances } from "./buckets/conveyor-instances"
import { CrateInstances } from "./buckets/crate-instances"
import { DockInstances } from "./buckets/dock-instances"
import { ShelfInstances } from "./buckets/shelf-instances"
import { WorkerInstances } from "./buckets/worker-instances"

export function BuildHallScene() {
  return (
    <group>
      <DockInstances />
      <ConveyorInstances />
      <CrateInstances />
      <ArmInstances />
      <ShelfInstances />
      <WorkerInstances />
    </group>
  )
}
