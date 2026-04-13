/**
 * Sync required source links declared in package.json#dx.sources.
 *
 * For each declared source, checks if it's already linked locally.
 * If not, calls sourceLink() to restore it.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { PackageState } from "../pkg/state.js"
import { readSources } from "./sources-config.js"
import { sourceLink } from "./link.js"

export interface SyncSourcesResult {
  total: number
  alreadyLinked: string[]
  restored: string[]
  failed: Array<{ name: string; error: string }>
}

export async function syncSources(
  root: string,
  opts?: { verbose?: boolean }
): Promise<SyncSourcesResult> {
  const sources = readSources(root)
  const names = Object.keys(sources)

  const result: SyncSourcesResult = {
    total: names.length,
    alreadyLinked: [],
    restored: [],
    failed: [],
  }

  if (names.length === 0) return result

  const pm = new PackageState(root)
  const packages = pm.all()

  for (const name of names) {
    const config = sources[name]!
    const entry = packages[name]

    // Already linked and target exists — skip
    if (entry && existsSync(join(root, entry.local_path))) {
      result.alreadyLinked.push(name)
      continue
    }

    // Need to restore this source link
    console.log(`  ⟳ Sources: restoring ${name}...`)
    try {
      await sourceLink(root, {
        source: config.source,
        path: config.path,
        target: config.target,
        ref: config.ref,
        require: true,
        restore: true,
        quiet: true,
        verbose: opts?.verbose,
      })
      result.restored.push(name)
    } catch (err) {
      result.failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
