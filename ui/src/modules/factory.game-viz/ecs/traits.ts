import { trait } from "koota"

// Transform
export const Position = trait({ x: 0, y: 0, z: 0 })
export const Rotation = trait({ y: 0 })
export const Scale = trait({ x: 1, y: 1, z: 1 })

// Render
export const AssetKind = trait({ kind: "" as string })
export const RenderTier = trait({
  tier: "iconic" as "iconic" | "standard" | "hidden",
})
export const Tint = trait({ r: 1, g: 1, b: 1 })
export const Visible = trait()
export const Selected = trait()

// Entity type tags
export const ConveyorBelt = trait()
export const Crate = trait()
export const RoboticArm = trait()
export const LoadingDock = trait()
export const ShelfUnit = trait()
export const Worker = trait()

// Simulation
export const Velocity = trait({ x: 0, y: 0, z: 0 })
export const Target = trait({ x: 0, y: 0, z: 0 })
export const BeltPosition = trait({ t: 0 })
export const BuildStatus = trait({
  status: "pending" as "pending" | "running" | "success" | "failed",
})

// Metadata (for display in detail panel)
export const EntityLabel = trait({ name: "", description: "" })
