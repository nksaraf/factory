/**
 * Persisted site controller state — survives restarts.
 *
 * Stores the last applied manifest, rollback history, and
 * component image history for rollback support.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import type { SiteManifest } from "./manifest.js"

export interface ImageHistoryEntry {
  image: string
  appliedAt: string
  manifestVersion: number
}

export interface ControllerState {
  lastAppliedManifest: SiteManifest | null
  lastAppliedAt: string | null
  imageHistory: Record<string, ImageHistoryEntry[]>
  startedAt: string
}

const MAX_IMAGE_HISTORY = 10

export class StateStore {
  private stateDir: string
  private statePath: string
  private state: ControllerState

  constructor(stateDir: string) {
    this.stateDir = stateDir
    this.statePath = join(stateDir, "controller-state.json")
    this.state = this.load()
  }

  private load(): ControllerState {
    if (existsSync(this.statePath)) {
      try {
        const raw = readFileSync(this.statePath, "utf8")
        return JSON.parse(raw) as ControllerState
      } catch {
        // corrupted state file — start fresh
      }
    }
    return {
      lastAppliedManifest: null,
      lastAppliedAt: null,
      imageHistory: {},
      startedAt: new Date().toISOString(),
    }
  }

  private persist(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
    const tmpPath = this.statePath + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2))
    renameSync(tmpPath, this.statePath)
  }

  getLastManifest(): SiteManifest | null {
    return this.state.lastAppliedManifest
  }

  getStartedAt(): string {
    return this.state.startedAt
  }

  saveManifest(manifest: SiteManifest): void {
    this.state.lastAppliedManifest = manifest
    this.state.lastAppliedAt = new Date().toISOString()
    this.persist()
  }

  recordImageDeploy(
    component: string,
    image: string,
    manifestVersion: number
  ): void {
    if (!this.state.imageHistory[component]) {
      this.state.imageHistory[component] = []
    }
    const history = this.state.imageHistory[component]
    history.push({
      image,
      appliedAt: new Date().toISOString(),
      manifestVersion,
    })
    if (history.length > MAX_IMAGE_HISTORY) {
      this.state.imageHistory[component] = history.slice(-MAX_IMAGE_HISTORY)
    }
    this.persist()
  }

  getPreviousImage(component: string): string | null {
    const history = this.state.imageHistory[component]
    if (!history || history.length < 2) return null
    return history[history.length - 2].image
  }

  getImageHistory(component: string): ImageHistoryEntry[] {
    return this.state.imageHistory[component] ?? []
  }
}
