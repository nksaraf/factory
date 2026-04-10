/**
 * Shared catalog resolution — format fallback + drift detection.
 *
 * Used by both `dx catalog` display commands and `dx catalog sync`.
 * Resolves the local CatalogSystem via format fallback:
 *   docker-compose → backstage → helm
 *
 * Generates cross-format variants into .dx/generated/ and reports drift
 * when an existing file differs from its generated counterpart.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { CatalogFormat } from "@smp/factory-shared/catalog-registry"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Side-effect import: registers all format adapters
import "@smp/factory-shared/formats/index"

import { getCatalogFormat } from "@smp/factory-shared/catalog-registry"

import { ProjectContext } from "./project.js"

// ── Constants ────────────────────────────────────────────────

/** Map of format → files to probe for detection (in priority order). */
const FORMAT_FILES: [CatalogFormat, string[]][] = [
  [
    "docker-compose",
    [
      "docker-compose.yaml",
      "docker-compose.yml",
      "compose.yaml",
      "compose.yml",
      "compose/",
    ],
  ],
  ["backstage", ["catalog-info.yaml", "catalog-info.yml"]],
  ["helm", ["Chart.yaml"]],
]

/** Priority order for format fallback. */
const FORMAT_PRIORITY: CatalogFormat[] = ["docker-compose", "backstage", "helm"]

const GENERATED_DIR = ".dx/generated"

// ── Types ────────────────────────────────────────────────────

export interface DetectedFormat {
  format: CatalogFormat
  file: string
}

export interface FileDrift {
  file: string
  format: CatalogFormat
  status: "added" | "modified"
}

export interface CatalogResult {
  catalog: CatalogSystem
  format: CatalogFormat
  file: string
  rootDir: string
  warnings: string[]
  drifts: FileDrift[]
  /** Resolved owner: catalog spec → dx config team → "unknown" */
  owner: string
}

// ── Format detection ─────────────────────────────────────────

export function detectFormats(rootDir: string): DetectedFormat[] {
  const found: DetectedFormat[] = []
  for (const [format, files] of FORMAT_FILES) {
    for (const file of files) {
      if (existsSync(join(rootDir, file))) {
        found.push({ format, file })
        break // one match per format
      }
    }
  }
  return found
}

// ── Generate + diff ──────────────────────────────────────────

/** Normalize whitespace for comparison: trim trailing, normalize line endings. */
function normalizeForDiff(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
}

/**
 * Generate all format variants from the catalog, write to .dx/generated/,
 * and diff against existing files in the project root.
 */
export function generateAndDiff(
  catalog: CatalogSystem,
  activeFormat: CatalogFormat,
  rootDir: string
): FileDrift[] {
  const genDir = join(rootDir, GENERATED_DIR)
  mkdirSync(genDir, { recursive: true })

  const drifts: FileDrift[] = []

  for (const format of FORMAT_PRIORITY) {
    // Skip the active source format — it's the source of truth
    if (format === activeFormat) continue

    let generated: Record<string, string>
    try {
      const adapter = getCatalogFormat(format)
      const result = adapter.generate(catalog, { rootDir })
      generated = result.files
    } catch {
      // Some adapters may fail to generate (e.g., missing required fields)
      continue
    }

    for (const [filename, content] of Object.entries(generated)) {
      // Write generated version
      const genPath = join(genDir, filename)
      writeFileSync(genPath, content, "utf-8")

      // Compare against existing file in project root
      const existingPath = join(rootDir, filename)
      if (!existsSync(existingPath)) {
        // No existing file — not a drift, just a new generated file
        continue
      }

      const existing = readFileSync(existingPath, "utf-8")
      if (normalizeForDiff(existing) !== normalizeForDiff(content)) {
        drifts.push({ file: filename, format, status: "modified" })
      }
    }
  }

  return drifts
}

// ── Catalog loading ──────────────────────────────────────────

/**
 * Load the catalog using format fallback: docker-compose → backstage → helm.
 * Generates all other format variants and checks for drift.
 * Returns null if no catalog source is found.
 */
export function loadCatalog(cwd: string): CatalogResult | null {
  // Try ProjectContext first (docker-compose, walks up the tree)
  try {
    const ctx = ProjectContext.fromCwd(cwd)
    const drifts = generateAndDiff(ctx.catalog, "docker-compose", ctx.rootDir)
    return {
      catalog: ctx.catalog,
      format: "docker-compose",
      file: ctx.composeFiles[0] ?? cwd,
      rootDir: ctx.rootDir,
      warnings: [],
      drifts,
      owner: ctx.owner,
    }
  } catch {
    // No compose files found, fall through
  }

  // Fall back through other formats in priority order (skip docker-compose, already tried via ProjectContext)
  for (const format of FORMAT_PRIORITY.slice(1)) {
    const adapter = getCatalogFormat(format)
    if (adapter.detect(cwd)) {
      const result = adapter.parse(
        cwd
      ) as import("@smp/factory-shared/catalog-registry").CatalogParseResult
      const drifts = generateAndDiff(result.system, format, cwd)
      const detected = detectFormats(cwd).find((d) => d.format === format)
      return {
        catalog: result.system,
        format,
        file: detected ? join(cwd, detected.file) : cwd,
        rootDir: cwd,
        warnings: result.warnings,
        drifts,
        owner: result.system.spec.owner,
      }
    }
  }

  return null
}

/** Re-export constants for commands that need them. */
export { GENERATED_DIR, FORMAT_PRIORITY }
