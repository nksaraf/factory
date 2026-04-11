import { Instance, Instances } from "@react-three/drei"
import { useQuery } from "koota/react"

import { selectEntity } from "../../ecs/actions"
import { Position, Rotation, Tint, Visible, Worker } from "../../ecs/traits"
import { world } from "../../ecs/world"

export function WorkerInstances() {
  const workers = useQuery(Worker, Visible)

  return (
    <group>
      {/* Body — block */}
      <Instances limit={30}>
        <boxGeometry args={[0.4, 0.7, 0.3]} />
        <meshStandardMaterial
          color="white"
          roughness={0.85}
          metalness={0.05}
          flatShading
        />
        {workers.map((entity) => {
          const pos = entity.get(Position)
          const rot = entity.get(Rotation)
          const tint = entity.get(Tint)
          return (
            <Instance
              key={entity.id()}
              position={[pos.x, 0.45, pos.z]}
              rotation={[0, rot.y, 0]}
              color={[tint.r, tint.g, tint.b]}
              onClick={(e) => {
                e.stopPropagation()
                selectEntity(entity, world)
              }}
            />
          )
        })}
      </Instances>

      {/* Head — sphere */}
      <Instances limit={30}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial
          color={0xf5d6b8}
          roughness={0.9}
          metalness={0}
          flatShading
        />
        {workers.map((entity) => {
          const pos = entity.get(Position)
          return <Instance key={entity.id()} position={[pos.x, 0.98, pos.z]} />
        })}
      </Instances>
    </group>
  )
}
