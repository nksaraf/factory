/**
 * Docker compose source wiring — manage build overrides for source-linked services.
 *
 * Required links: modify main docker-compose.yaml directly (add build: block + required label).
 * Optional links: write .dx/generated/compose-source-overrides.yml (gitignored).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  parseDocument,
  stringify as stringifyYaml,
  parse as parseYaml,
} from "yaml"

const OVERRIDE_PATH = ".dx/generated/compose-source-overrides.yml"

// ── Catalog source label resolution ───────────────────────────

/**
 * Find a compose service by name and return its dx.source.* labels.
 * Scans all compose files at the project root.
 */
export function findComposeService(
  root: string,
  serviceName: string
): {
  serviceName: string
  sourceRepo: string
  sourcePath?: string
  composeFile: string
} | null {
  const composeFiles = findComposeFiles(root)

  for (const file of composeFiles) {
    try {
      const content = readFileSync(file, "utf8")
      const doc = parseYaml(content) as Record<string, any>
      const services = doc?.services
      if (!services) continue

      const svc = services[serviceName]
      if (!svc) continue

      const labels = normalizeLabels(svc.labels)
      const sourceRepo = labels["dx.source.repo"]
      if (!sourceRepo) continue

      return {
        serviceName,
        sourceRepo,
        sourcePath: labels["dx.source.path"],
        composeFile: file,
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Find a compose service whose dx.source.* labels match a given source URL and path.
 * Used by unlink to find the service to clean up.
 */
export function findComposeServiceBySource(
  root: string,
  sourceUrl: string,
  sourcePath?: string
): string | null {
  const sources = listCatalogSources(root)
  for (const s of sources) {
    // Match by repo (normalize GitHub shorthand vs full URL)
    const normalizedLabel = s.sourceRepo.replace(/\.git$/, "").toLowerCase()
    const normalizedSource = sourceUrl
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .toLowerCase()
    if (
      normalizedLabel === normalizedSource ||
      normalizedLabel.endsWith(`/${normalizedSource}`) ||
      normalizedSource.endsWith(`/${normalizedLabel}`)
    ) {
      // If both have paths, they must match
      if (sourcePath && s.sourcePath && s.sourcePath !== sourcePath) continue
      return s.serviceName
    }
  }
  return null
}

/**
 * List all compose services that have dx.source.repo labels.
 * Used by interactive mode to show available linkable services.
 */
export function listCatalogSources(root: string): Array<{
  serviceName: string
  sourceRepo: string
  sourcePath?: string
}> {
  const results: Array<{
    serviceName: string
    sourceRepo: string
    sourcePath?: string
  }> = []

  for (const file of findComposeFiles(root)) {
    try {
      const content = readFileSync(file, "utf8")
      const doc = parseYaml(content) as Record<string, any>
      const services = doc?.services
      if (!services) continue

      for (const [name, svc] of Object.entries(services) as [string, any][]) {
        const labels = normalizeLabels(svc?.labels)
        const sourceRepo = labels["dx.source.repo"]
        if (sourceRepo) {
          results.push({
            serviceName: name,
            sourceRepo,
            sourcePath: labels["dx.source.path"],
          })
        }
      }
    } catch {
      continue
    }
  }

  return results
}

// ── Required: modify main docker-compose.yaml ─────────────────

/**
 * Add a build context to a service in docker-compose.yaml and set
 * dx.source.required label. Preserves existing YAML structure.
 */
export function addBuildToCompose(
  root: string,
  serviceName: string,
  targetDir: string,
  dockerfilePath = "./Dockerfile"
): void {
  const composeFile = findComposeFileWithService(root, serviceName)
  if (!composeFile) {
    throw new Error(
      `Service ${serviceName} not found in any docker-compose file`
    )
  }

  const content = readFileSync(composeFile, "utf8")
  const doc = parseDocument(content)

  const svcNode = doc.getIn(["services", serviceName])
  if (!svcNode || typeof svcNode !== "object") {
    throw new Error(`Service ${serviceName} not found in ${composeFile}`)
  }

  // Add build block
  doc.setIn(["services", serviceName, "build"], {
    context: `./${targetDir}`,
    dockerfile: dockerfilePath,
  })

  // Add dx.source.required label
  const labels = doc.getIn(["services", serviceName, "labels"])
  if (labels && typeof labels === "object") {
    doc.setIn(["services", serviceName, "labels", "dx.source.required"], "true")
  }

  writeFileSync(composeFile, doc.toString())
}

/**
 * Remove the build block and dx.source.required label from a service.
 */
export function removeBuildFromCompose(
  root: string,
  serviceName: string
): void {
  const composeFile = findComposeFileWithService(root, serviceName)
  if (!composeFile) return

  const content = readFileSync(composeFile, "utf8")
  const doc = parseDocument(content)

  doc.deleteIn(["services", serviceName, "build"])
  doc.deleteIn(["services", serviceName, "labels", "dx.source.required"])

  writeFileSync(composeFile, doc.toString())
}

// ── Optional: .dx/generated/compose-source-overrides.yml ──────

/**
 * Generate or append a source override for an optional link.
 */
export function generateSourceOverride(
  root: string,
  serviceName: string,
  targetDir: string,
  dockerfilePath = "./Dockerfile"
): void {
  const overridePath = join(root, OVERRIDE_PATH)
  const genDir = join(root, ".dx", "generated")
  mkdirSync(genDir, { recursive: true })

  let existing: Record<string, any> = {}
  if (existsSync(overridePath)) {
    try {
      existing = parseYaml(readFileSync(overridePath, "utf8")) ?? {}
    } catch {
      // Start fresh
    }
  }

  if (!existing.services) existing.services = {}
  existing.services[serviceName] = {
    build: {
      context: `../../${targetDir}`,
      dockerfile: dockerfilePath,
    },
  }

  writeFileSync(
    overridePath,
    `# Auto-generated by dx source link — do not edit\n${stringifyYaml(existing)}`
  )
}

/**
 * Remove a service from the override file.
 */
export function removeSourceOverride(root: string, serviceName: string): void {
  const overridePath = join(root, OVERRIDE_PATH)
  if (!existsSync(overridePath)) return

  try {
    const existing = parseYaml(readFileSync(overridePath, "utf8")) as Record<
      string,
      any
    >
    if (existing?.services?.[serviceName]) {
      delete existing.services[serviceName]
      if (Object.keys(existing.services).length === 0) {
        unlinkSync(overridePath)
      } else {
        writeFileSync(
          overridePath,
          `# Auto-generated by dx source link — do not edit\n${stringifyYaml(existing)}`
        )
      }
    }
  } catch {
    // Ignore parse errors — file may be corrupted
  }
}

/**
 * Get the override file path if it exists, for inclusion in compose file list.
 */
export function getSourceOverridePath(root: string): string | null {
  const overridePath = join(root, OVERRIDE_PATH)
  return existsSync(overridePath) ? overridePath : null
}

// ── Helpers ───────────────────────────────────────────────────

function findComposeFiles(root: string): string[] {
  const candidates = [
    "docker-compose.yaml",
    "docker-compose.yml",
    "compose.yaml",
    "compose.yml",
  ]
  return candidates.map((f) => join(root, f)).filter((f) => existsSync(f))
}

function findComposeFileWithService(
  root: string,
  serviceName: string
): string | null {
  for (const file of findComposeFiles(root)) {
    try {
      const content = readFileSync(file, "utf8")
      const doc = parseYaml(content) as Record<string, any>
      if (doc?.services?.[serviceName]) return file
    } catch {
      continue
    }
  }
  return null
}

/**
 * Normalize docker-compose labels from array or object form to a flat Record.
 */
function normalizeLabels(
  labels: Record<string, string> | string[] | undefined
): Record<string, string> {
  if (!labels) return {}
  if (Array.isArray(labels)) {
    const result: Record<string, string> = {}
    for (const label of labels) {
      const eqIdx = label.indexOf("=")
      if (eqIdx > 0) {
        result[label.slice(0, eqIdx)] = label.slice(eqIdx + 1)
      }
    }
    return result
  }
  return labels
}
