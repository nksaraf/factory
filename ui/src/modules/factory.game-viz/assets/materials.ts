import * as THREE from "three"

// Shared material library — 5 materials for the entire scene

export const mattePainted = new THREE.MeshStandardMaterial({
  roughness: 0.9,
  metalness: 0.05,
  flatShading: true,
})

export const glossyMetal = new THREE.MeshStandardMaterial({
  roughness: 0.4,
  metalness: 0.6,
  flatShading: true,
})

export const ghostGlass = new THREE.MeshStandardMaterial({
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.3,
  flatShading: true,
})

export const emissiveStatus = new THREE.MeshStandardMaterial({
  roughness: 0.5,
  metalness: 0.2,
  emissiveIntensity: 1.5,
  flatShading: true,
})

export const ground = new THREE.MeshStandardMaterial({
  color: 0x3a3a3a,
  roughness: 0.95,
  metalness: 0.02,
  flatShading: true,
})

// Color palette by category
export const PALETTE = {
  build: { r: 1, g: 0.6, b: 0.2 },       // amber/orange
  logistics: { r: 0.2, g: 0.6, b: 1 },    // blue
  storage: { r: 1, g: 0.85, b: 0.2 },     // yellow
  office: { r: 0.2, g: 0.7, b: 0.65 },    // teal
  infra: { r: 0.9, g: 0.25, b: 0.2 },     // red
  utilities: { r: 0.3, g: 0.75, b: 0.35 }, // green
} as const

// Status colors
export const STATUS_COLORS = {
  pending: { r: 0.5, g: 0.5, b: 0.5 },
  running: { r: 1, g: 0.7, b: 0.15 },
  success: { r: 0.3, g: 0.8, b: 0.35 },
  failed: { r: 0.95, g: 0.2, b: 0.2 },
  idle: { r: 0.6, g: 0.6, b: 0.6 },
  syncing: { r: 0.3, g: 0.7, b: 1 },
} as const
