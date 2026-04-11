import { useThree, useFrame } from "@react-three/fiber"
import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

export type CameraMode = "topdown" | "angled"

interface CameraPreset {
  position: THREE.Vector3
  lookAt: THREE.Vector3
}

const PRESETS: Record<CameraMode, CameraPreset> = {
  topdown: {
    position: new THREE.Vector3(0, 40, 0.01),
    lookAt: new THREE.Vector3(0, 0, 0),
  },
  angled: {
    position: new THREE.Vector3(20, 28, 20),
    lookAt: new THREE.Vector3(0, 0, 0),
  },
}

const ZOOM_MIN = 15
const ZOOM_MAX = 80
const PAN_SPEED = 0.5
const LERP_SPEED = 4

interface CameraControllerProps {
  mode: CameraMode
  onModeChange?: (mode: CameraMode) => void
}

export function CameraController({ mode }: CameraControllerProps) {
  const { camera, gl } = useThree()
  const targetPos = useRef(PRESETS[mode].position.clone())
  const targetLookAt = useRef(PRESETS[mode].lookAt.clone())
  const panOffset = useRef(new THREE.Vector3())
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // Update target when mode changes
  useEffect(() => {
    const preset = PRESETS[mode]
    targetPos.current.copy(preset.position).add(panOffset.current)
    // Keep lookAt offset consistent
    targetLookAt.current.copy(preset.lookAt).add(panOffset.current)
  }, [mode])

  // Mouse/touch handlers for panning
  const onPointerDown = useCallback((e: PointerEvent) => {
    if (e.button === 0 || e.button === 2) {
      isDragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
  }, [])

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDragging.current) return
      const dx = (e.clientX - lastMouse.current.x) * PAN_SPEED * 0.1
      const dy = (e.clientY - lastMouse.current.y) * PAN_SPEED * 0.1
      lastMouse.current = { x: e.clientX, y: e.clientY }

      const panDelta = new THREE.Vector3(-dx, 0, -dy)
      panOffset.current.add(panDelta)

      const preset = PRESETS[mode]
      targetPos.current.copy(preset.position).add(panOffset.current)
      targetLookAt.current.copy(preset.lookAt).add(panOffset.current)
    },
    [mode]
  )

  const onPointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const orthoCamera = camera as THREE.OrthographicCamera
      const zoomDelta = e.deltaY * 0.05
      orthoCamera.zoom = THREE.MathUtils.clamp(
        orthoCamera.zoom - zoomDelta,
        ZOOM_MIN,
        ZOOM_MAX
      )
      orthoCamera.updateProjectionMatrix()
    },
    [camera]
  )

  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerup", onPointerUp)
    canvas.addEventListener("pointerleave", onPointerUp)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("contextmenu", (e) => e.preventDefault())

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerUp)
      canvas.removeEventListener("pointerleave", onPointerUp)
      canvas.removeEventListener("wheel", onWheel)
    }
  }, [gl, onPointerDown, onPointerMove, onPointerUp, onWheel])

  // Smooth lerp each frame
  useFrame((_, delta) => {
    const t = 1 - Math.exp(-LERP_SPEED * delta)
    camera.position.lerp(targetPos.current, t)
    const currentLookAt = new THREE.Vector3()
    currentLookAt.lerpVectors(
      camera.position
        .clone()
        .add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)),
      targetLookAt.current,
      t
    )
    camera.lookAt(targetLookAt.current)
  })

  return null
}
