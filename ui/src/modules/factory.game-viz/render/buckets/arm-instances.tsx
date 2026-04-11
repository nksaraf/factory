import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import {
  Position,
  RoboticArm,
  Rotation,
  Scale,
  Tint,
  Visible,
} from "../../ecs/traits"

export function ArmInstances() {
  const arms = useQuery(RoboticArm, Visible)

  return (
    <group>
      {/* Base cylinder */}
      <Instances limit={20}>
        <cylinderGeometry args={[0.4, 0.5, 0.6, 8]} />
        <meshStandardMaterial
          color="white"
          roughness={0.4}
          metalness={0.6}
          flatShading
        />
        {arms.map((entity) => {
          const pos = entity.get(Position)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 0.3, pos.z]}
              color={[tint.r, tint.g, tint.b]}
            />
          )
        })}
      </Instances>

      {/* Arm segment */}
      <Instances limit={20}>
        <boxGeometry args={[0.2, 1.5, 0.2]} />
        <meshStandardMaterial
          color="white"
          roughness={0.4}
          metalness={0.6}
          flatShading
        />
        {arms.map((entity) => {
          const pos = entity.get(Position)
          const rot = entity.get(Rotation)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 1.35, pos.z]}
              rotation={[0, rot.y, Math.PI * 0.15]}
              color={[tint.r * 0.8, tint.g * 0.8, tint.b * 0.8]}
            />
          )
        })}
      </Instances>
    </group>
  )
}
