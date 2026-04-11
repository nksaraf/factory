import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import { selectEntity } from "../../ecs/actions"
import {
  LoadingDock,
  Position,
  Rotation,
  Tint,
  Visible,
} from "../../ecs/traits"
import { world } from "../../ecs/world"

export function DockInstances() {
  const docks = useQuery(LoadingDock, Visible)

  return (
    <group>
      {/* Platform base */}
      <Instances limit={20}>
        <boxGeometry args={[3, 0.3, 2]} />
        <meshStandardMaterial
          color="white"
          roughness={0.85}
          metalness={0.1}
          flatShading
        />
        {docks.map((entity) => {
          const pos = entity.get(Position)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 0.15, pos.z]}
              color={[tint.r * 0.7, tint.g * 0.7, tint.b * 0.7]}
              onClick={(e) => {
                e.stopPropagation()
                selectEntity(entity, world)
              }}
            />
          )
        })}
      </Instances>

      {/* Ramp */}
      <Instances limit={20}>
        <boxGeometry args={[2, 0.1, 1]} />
        <meshStandardMaterial
          color="white"
          roughness={0.9}
          metalness={0.05}
          flatShading
        />
        {docks.map((entity) => {
          const pos = entity.get(Position)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 0.05, pos.z + 1.2]}
              rotation={[0.15, 0, 0]}
              color={[tint.r * 0.5, tint.g * 0.5, tint.b * 0.5]}
            />
          )
        })}
      </Instances>
    </group>
  )
}
