/**
 * Workbench identity — generation, detection, and config persistence.
 *
 * The workbench ID is a deterministic hash of the machine ID and hostname,
 * formatted as `wb-<8hex>`. The workbench config lives at `<root>/.dx/workbench.json`.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import {
  hostname as osHostname,
  networkInterfaces,
  platform,
  arch,
} from "node:os"
import { join } from "node:path"

import type {
  WorkbenchConfig,
  WorkbenchType,
} from "@smp/factory-shared/install-types"
import { getMachineId } from "./machine-id.js"

const VALID_TYPES: WorkbenchType[] = [
  "developer",
  "ci",
  "agent",
  "sandbox",
  "build",
  "testbed",
]

/** Generate a deterministic workbench ID from machine ID + hostname. */
export function generateWorkbenchId(
  machineId: string,
  hostname: string
): string {
  const hash = createHash("sha256")
    .update(machineId + hostname)
    .digest("hex")
  return `wb-${hash.slice(0, 8)}`
}

/** Auto-detect or validate workbench type. */
export function detectWorkbenchType(explicit?: string): WorkbenchType {
  if (explicit && VALID_TYPES.includes(explicit as WorkbenchType)) {
    return explicit as WorkbenchType
  }

  if (process.env.CI) return "ci"

  if (
    process.env.CONDUCTOR_WORKSPACE ||
    process.env.DEVIN_SESSION ||
    process.env.DX_AGENT
  ) {
    return "agent"
  }

  if (
    existsSync("/.dockerenv") ||
    process.env.CODESPACES ||
    process.env.GITPOD_WORKSPACE_ID ||
    process.env.KUBERNETES_SERVICE_HOST
  ) {
    return "sandbox"
  }

  return "developer"
}

/** Resolve the workbench root directory from a flag or cwd. */
export function resolveWorkbenchRoot(dirFlag?: string): string {
  return dirFlag ?? process.cwd()
}

/** Read workbench config from `<root>/.dx/workbench.json`. Returns null if not found. */
export function readWorkbenchConfig(root: string): WorkbenchConfig | null {
  const file = join(root, ".dx", "workbench.json")
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, "utf8")) as WorkbenchConfig
  } catch {
    return null
  }
}

/** Write workbench config to `<root>/.dx/workbench.json`. */
export function writeWorkbenchConfig(
  root: string,
  config: WorkbenchConfig
): void {
  const dir = join(root, ".dx")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "workbench.json"),
    JSON.stringify(config, null, 2) + "\n",
    {
      mode: 0o600,
    }
  )
}

/** Collect local non-internal IPv4 addresses. */
export function getLocalIps(): string[] {
  const ips: string[] = []
  const ifaces = networkInterfaces()
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        ips.push(entry.address)
      }
    }
  }
  return ips
}

/** Create a fresh WorkbenchConfig with identity fields populated. */
export function createWorkbenchConfig(opts: {
  root: string
  type?: string
  dxVersion: string
  factoryUrl?: string
  authProfile?: string
}): WorkbenchConfig {
  const machineId = getMachineId()
  const host = osHostname()
  const workbenchId = generateWorkbenchId(machineId, host)
  const now = new Date().toISOString()

  return {
    workbenchId,
    type: detectWorkbenchType(opts.type),
    hostname: host,
    ips: getLocalIps(),
    os: platform(),
    arch: arch(),
    dxVersion: opts.dxVersion,
    authProfile: opts.authProfile,
    factoryUrl: opts.factoryUrl,
    factoryRegistered: false,
    createdAt: now,
    lastInstallAt: now,
    toolchainVersions: {},
  }
}
