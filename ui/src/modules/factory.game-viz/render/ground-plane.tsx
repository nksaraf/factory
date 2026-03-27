export function GroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial
        color={0x3a3a3a}
        roughness={0.95}
        metalness={0.02}
      />
    </mesh>
  )
}

export function GridOverlay() {
  return (
    <gridHelper
      args={[60, 30, 0x555555, 0x444444]}
      position={[0, 0.01, 0]}
    />
  )
}
