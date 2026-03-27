import { Canvas } from "@react-three/fiber"
import { WorldProvider } from "koota/react"
import { useEffect, useRef, useState } from "react"

import { gameActions } from "../ecs/actions"
import { world } from "../ecs/world"
import { spawnBuildHall } from "../mocks/spawn-build-hall"
import { ModeToggle } from "../ui/mode-toggle"
import { StatusBar } from "../ui/status-bar"
import { DetailPanel } from "../ui/detail-panel"
import { BuildHallScene } from "./build-hall-scene"
import { type CameraMode, CameraController } from "./camera-controller"
import { GridOverlay, GroundPlane } from "./ground-plane"
import { SystemsRunner } from "../ecs/systems/systems-runner"
import { SelectedOverlay } from "./selected-overlay"

export function GameCanvas() {
  const [cameraMode, setCameraMode] = useState<CameraMode>("angled")
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    spawnBuildHall()
  }, [])

  return (
    <WorldProvider world={world}>
      <div className="relative h-full w-full">
        <Canvas
          orthographic
          camera={{
            zoom: 30,
            position: [20, 28, 20],
            near: 0.1,
            far: 200,
          }}
          onPointerMissed={() => {
            gameActions(world).deselect()
          }}
          style={{ background: "#1a1a2e" }}
        >
          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[15, 25, 10]}
            intensity={0.8}
            castShadow={false}
          />

          {/* Camera */}
          <CameraController mode={cameraMode} />

          {/* Scene */}
          <GroundPlane />
          <GridOverlay />
          {/* Systems */}
          <SystemsRunner />

          <BuildHallScene />
          <SelectedOverlay />
        </Canvas>

        {/* UI Overlays */}
        <ModeToggle mode={cameraMode} onModeChange={setCameraMode} />
        <StatusBar />
        <DetailPanel />
      </div>
    </WorldProvider>
  )
}
