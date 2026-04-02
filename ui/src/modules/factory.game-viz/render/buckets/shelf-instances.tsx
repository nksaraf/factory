import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import { selectEntity } from "../../ecs/actions"
import { Position, ShelfUnit, Tint, Visible } from "../../ecs/traits"
import { world } from "../../ecs/world"

export function ShelfInstances() {
  const shelves = useQuery(ShelfUnit, Visible)

  return (
    <group>
      {/* Shelf frame */}
      <Instances limit={50}>
        <boxGeometry args={[1.8, 1.5, 0.8]} />
        <meshStandardMaterial
          color="white"
          roughness={0.7}
          metalness={0.3}
          flatShading
        />
        {shelves.map((entity) => {
          const pos = entity.get(Position)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 0.75, pos.z]}
              color={[tint.r * 0.6, tint.g * 0.6, tint.b * 0.6]}
              onClick={(e) => {
                e.stopPropagation()
                selectEntity(entity, world)
              }}
            />
          )
        })}
      </Instances>

      {/* Small box on top (artifact) */}
      <Instances limit={50}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial
          color="white"
          roughness={0.8}
          metalness={0.1}
          flatShading
        />
        {shelves.map((entity) => {
          const pos = entity.get(Position)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 1.75, pos.z]}
              color={[tint.r, tint.g, tint.b]}
            />
          )
        })}
      </Instances>
    </group>
  )
}
