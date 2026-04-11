import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import {
  ConveyorBelt,
  Position,
  Rotation,
  Scale,
  Tint,
  Visible,
} from "../../ecs/traits"

export function ConveyorInstances() {
  const conveyors = useQuery(ConveyorBelt, Visible)

  return (
    <Instances limit={100}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="white"
        roughness={0.4}
        metalness={0.6}
        flatShading
      />
      {conveyors.map((entity) => {
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
          />
        )
      })}
    </Instances>
  )
}
