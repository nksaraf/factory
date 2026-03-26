import { gameActions } from "../ecs/actions"
import { world } from "../ecs/world"
import { PALETTE, STATUS_COLORS } from "../assets/materials"
import {
  MOCK_ARTIFACTS,
  MOCK_BUILDS,
  MOCK_REPOS,
  MOCK_SYNC_WORKERS,
} from "./build-hall-data"

// Belt path: straight line from docks to output
const BELT_START_Z = -8
const BELT_END_Z = 8
const BELT_Y = 0.5

export function spawnBuildHall() {
  // Loading docks — one per repo, spread along top edge
  MOCK_REPOS.forEach((repo, i) => {
    const x = (i - (MOCK_REPOS.length - 1) / 2) * 4
    gameActions(world).spawnEntity({
      type: "dock",
      position: { x, y: 0, z: BELT_START_Z - 3 },
      tint: PALETTE.build,
      label: { name: repo.name, description: `${repo.kind} repo` },
    })
  })

  // Conveyor belt segments — 8 segments along Z axis
  for (let i = 0; i < 8; i++) {
    const z = BELT_START_Z + i * 2
    gameActions(world).spawnEntity({
      type: "conveyor",
      position: { x: 0, y: 0.25, z },
      scale: { x: 3, y: 0.25, z: 2 },
      tint: PALETTE.logistics,
    })
  }

  // Crates on belt — one per build
  MOCK_BUILDS.forEach((build, i) => {
    const t = (i / (MOCK_BUILDS.length - 1)) * 0.8 + 0.1
    const z = BELT_START_Z + t * (BELT_END_Z - BELT_START_Z)
    const statusColor = STATUS_COLORS[build.status]

    gameActions(world).spawnEntity({
      type: "crate",
      position: { x: 0, y: BELT_Y, z },
      scale: { x: 0.6, y: 0.6, z: 0.6 },
      tint: statusColor,
      label: { name: `${build.repo}@${build.version}`, description: build.status },
      buildStatus: build.status,
      beltPosition: t,
    })
  })

  // Robotic arms — 3 stations along the belt
  for (let i = 0; i < 3; i++) {
    const z = BELT_START_Z + (i + 1) * 4
    gameActions(world).spawnEntity({
      type: "arm",
      position: { x: 3, y: 0, z },
      rotation: { y: -Math.PI / 2 },
      tint: PALETTE.build,
      label: { name: `Station ${i + 1}`, description: "Build station" },
    })
  }

  // Output shelves — artifacts in a grid
  const shelfStartX = -6
  const shelfStartZ = BELT_END_Z + 2
  const COLS = 5
  MOCK_ARTIFACTS.forEach((artifact, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    gameActions(world).spawnEntity({
      type: "shelf",
      position: {
        x: shelfStartX + col * 2.5,
        y: 0,
        z: shelfStartZ + row * 2,
      },
      tint: PALETTE.storage,
      label: {
        name: `${artifact.repo}@${artifact.version}`,
        description: `${artifact.kind} artifact`,
      },
    })
  })

  // Workers — sync agents
  MOCK_SYNC_WORKERS.forEach((worker, i) => {
    const repoIdx = MOCK_REPOS.findIndex((r) => r.slug === worker.repo)
    const x = (repoIdx - (MOCK_REPOS.length - 1) / 2) * 4 + 1.5
    const statusColor = STATUS_COLORS[worker.status]

    gameActions(world).spawnEntity({
      type: "worker",
      position: { x, y: 0, z: BELT_START_Z - 1 },
      tint: statusColor,
      label: { name: `Sync Agent`, description: `${worker.repo} — ${worker.status}` },
    })
  })
}
