import { createActions } from "koota"

import {
  AssetKind,
  BeltPosition,
  BuildStatus,
  ConveyorBelt,
  Crate,
  EntityLabel,
  LoadingDock,
  Position,
  RenderTier,
  RoboticArm,
  Rotation,
  Scale,
  Selected,
  ShelfUnit,
  Tint,
  Visible,
  Worker,
} from "./traits"

const ENTITY_TYPE_TRAITS = {
  conveyor: ConveyorBelt,
  crate: Crate,
  arm: RoboticArm,
  dock: LoadingDock,
  shelf: ShelfUnit,
  worker: Worker,
} as const

type EntityType = keyof typeof ENTITY_TYPE_TRAITS

export const gameActions = createActions((world) => ({
  spawnEntity(opts: {
    type: EntityType
    position: { x: number; y: number; z: number }
    rotation?: { y: number }
    scale?: { x: number; y: number; z: number }
    tint?: { r: number; g: number; b: number }
    label?: { name: string; description: string }
    buildStatus?: "pending" | "running" | "success" | "failed"
    beltPosition?: number
  }) {
    const typeTrait = ENTITY_TYPE_TRAITS[opts.type]
    const traits = [
      typeTrait,
      Visible,
      Position(opts.position),
      Rotation(opts.rotation ?? { y: 0 }),
      Scale(opts.scale ?? { x: 1, y: 1, z: 1 }),
      AssetKind({ kind: opts.type }),
      RenderTier({ tier: "iconic" }),
      Tint(opts.tint ?? { r: 1, g: 1, b: 1 }),
    ]

    if (opts.label) {
      traits.push(EntityLabel(opts.label))
    }
    if (opts.buildStatus) {
      traits.push(BuildStatus({ status: opts.buildStatus }))
    }
    if (opts.beltPosition !== undefined) {
      traits.push(BeltPosition({ t: opts.beltPosition }))
    }

    return world.spawn(...traits)
  },

  deselect() {
    world.query(Selected).forEach((e) => {
      e.remove(Selected)
    })
  },
}))

// Standalone select function — takes entity object directly from click handler
export function selectEntity(
  entity: { add: (trait: any) => void },
  world: any
) {
  // Deselect all first
  world.query(Selected).forEach((e: any) => {
    e.remove(Selected)
  })
  // Select this one
  entity.add(Selected)
}
