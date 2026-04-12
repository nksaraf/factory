/**
 * Loads and validates YAML inventory files for `dx scan --file`.
 *
 * Accepts a single .yaml/.yml file or a directory.
 * Directory mode: recursively finds all *.yaml/*.yml files, sorts them
 * alphabetically for deterministic ordering, and merges all entities.
 */
import { parse as parseYaml } from "yaml"
import { readFileSync, statSync, readdirSync } from "fs"
import { join } from "path"

interface InventoryFile {
  version: "1"
  entities: unknown[]
}

function isInventoryFile(raw: unknown): raw is InventoryFile {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as any).version === "1" &&
    Array.isArray((raw as any).entities)
  )
}

export function loadInventoryFiles(pathOrDir: string): unknown[] {
  const stat = statSync(pathOrDir)
  const filePaths: string[] = []

  if (stat.isDirectory()) {
    const entries = readdirSync(pathOrDir, {
      recursive: true,
      withFileTypes: false,
    }) as string[]
    for (const entry of entries.sort()) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        filePaths.push(join(pathOrDir, entry))
      }
    }
  } else {
    filePaths.push(pathOrDir)
  }

  if (filePaths.length === 0) {
    throw new Error(`No YAML files found in ${pathOrDir}`)
  }

  const all: unknown[] = []
  for (const filePath of filePaths) {
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(filePath, "utf8"))
    } catch (err: any) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`)
    }
    if (!isInventoryFile(raw)) {
      throw new Error(
        `${filePath}: invalid inventory file — must have version: "1" and entities: []`
      )
    }
    all.push(...raw.entities)
  }
  return all
}
