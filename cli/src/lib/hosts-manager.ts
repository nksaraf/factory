/**
 * Manage /etc/hosts entries for local gateway DNS routing.
 *
 * The gateway proxy expects *.workbench.dx.dev hostnames.
 * For local routing we add entries pointing to 127.0.0.1.
 *
 * All managed entries are tagged with "# dx-managed" for safe cleanup.
 */
import { readFileSync } from "node:fs"

import { capture } from "./subprocess.js"

const HOSTS_FILE = "/etc/hosts"
const MARKER = "# dx-managed"

export type RouteFamily = "sandbox" | "workbench" | "preview" | "tunnel"

/**
 * Add a host entry: `127.0.0.1 <slug>.<family>.dx.dev  # dx-managed`
 * Requires sudo on most systems.
 */
export async function addHostEntry(
  slug: string,
  family: RouteFamily = "workbench"
): Promise<void> {
  const hostname = `${slug}.${family}.dx.dev`
  const line = `127.0.0.1 ${hostname}  ${MARKER}`

  // Check if already present
  const current = readHostsFile()
  if (current.includes(hostname)) return

  // Append via sudo tee
  const result = await capture([
    "sudo",
    "sh",
    "-c",
    `echo '${line}' >> ${HOSTS_FILE}`,
  ])

  if (result.exitCode !== 0) {
    console.warn(
      `Could not add hosts entry for ${hostname}.\n` +
        `Run manually: sudo sh -c "echo '${line}' >> ${HOSTS_FILE}"`
    )
  }
}

/**
 * Remove a host entry by slug and family.
 */
export async function removeHostEntry(
  slug: string,
  family: RouteFamily = "workbench"
): Promise<void> {
  const hostname = `${slug}.${family}.dx.dev`

  const result = await capture([
    "sudo",
    "sed",
    "-i",
    "",
    `/${hostname}.*${MARKER}/d`,
    HOSTS_FILE,
  ])

  if (result.exitCode !== 0) {
    console.warn(`Could not remove hosts entry for ${hostname}.`)
  }
}

/**
 * List all dx-managed host entries.
 */
export function listHostEntries(): string[] {
  const content = readHostsFile()
  return content
    .split("\n")
    .filter((line) => line.includes(MARKER))
    .map((line) => line.trim())
}

function readHostsFile(): string {
  try {
    return readFileSync(HOSTS_FILE, "utf-8")
  } catch {
    return ""
  }
}
