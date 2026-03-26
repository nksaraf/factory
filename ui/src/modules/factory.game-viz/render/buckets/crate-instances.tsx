import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import { selectEntity } from "../../ecs/actions"
import { Crate, Position, Rotation, Scale, Tint, Visible } from "../../ecs/traits"
import { world } from "../../ecs/world"

export function CrateInstances() {
  const crates = useQuery(Crate, Visible)

  return (
    <Instances limit={200}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="white"
        roughness={0.8}
        metalness={0.1}
        flatShading
      />
      {crates.map((entity) => {
        const pos = entity.get(Position)
        const rot = entity.get(Rotation)
        const scl = entity.get(Scale)
        const tint = entity.get(Tint)
        return (
          <Instance
            key={entity.id()}
            position={[pos.x, pos.y, pos.z]}
            rotation={[0, rot.y, 0]}
            scale={[scl.x, scl.y, scl.z]}
            color={[tint.r, tint.g, tint.b]}
            onClick={(e) => {
              e.stopPropagation()
              selectEntity(entity, world)
            }}
          />
        )
      })}
    </Instances>
  )
}
