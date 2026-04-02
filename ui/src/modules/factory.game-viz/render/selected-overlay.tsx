import { useQuery } from "koota/react"
import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

import { Position, Scale, Selected } from "../ecs/traits"

export function SelectedOverlay() {
  const selected = useQuery(Selected)
  const ringRef = useRef<THREE.Mesh>(null!)
  const timeRef = useRef(0)

  useFrame((_, delta) => {
    if (!ringRef.current) return
    timeRef.current += delta
    // Pulsing scale
    const pulse = 1 + Math.sin(timeRef.current * 3) * 0.08
    ringRef.current.scale.set(pulse, 1, pulse)
  })

  if (selected.length === 0) return null

  const entity = selected[0]
  const pos = entity.get(Position)
  const scl = entity.get(Scale)
  const radius = Math.max(scl.x, scl.z) * 0.8 + 0.5

  return (
    <group position={[pos.x, 0.05, pos.z]}>
      {/* Selection ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.08, radius, 32]} />
        <meshBasicMaterial
          color={0x00aaff}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
