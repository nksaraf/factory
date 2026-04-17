import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

const STATE_DIR = ".dx/.state"

/**
 * Prefix written to every stamp file. Bump when the semantics of what gets
 * hashed change (e.g. adding a new input file to an existing step). Every
 * prior stamp becomes stale once, forcing a clean re-run.
 */
const STAMP_FORMAT_VERSION = "v1"

function stampPath(rootDir: string, key: string): string {
  return join(rootDir, STATE_DIR, `${key}.stamp`)
}

export function hashFiles(rootDir: string, relPaths: string[]): string {
  const h = createHash("sha256")
  for (const rel of [...relPaths].sort()) {
    const abs = join(rootDir, rel)
    if (!existsSync(abs)) {
      h.update(`missing:${rel}\n`)
      continue
    }
    h.update(`${rel}:`)
    h.update(readFileSync(abs))
    h.update("\n")
  }
  return h.digest("hex")
}

export function readStamp(rootDir: string, key: string): string | null {
  const p = stampPath(rootDir, key)
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, "utf8").trim()
    // Strip the format-version prefix. Stamps missing the prefix, or with a
    // different version, are treated as stale (caller sees non-matching hash).
    const prefix = `${STAMP_FORMAT_VERSION}:`
    if (!raw.startsWith(prefix)) return null
    return raw.slice(prefix.length)
  } catch {
    return null
  }
}

export function writeStamp(rootDir: string, key: string, hash: string): void {
  const p = stampPath(rootDir, key)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${STAMP_FORMAT_VERSION}:${hash}`)
}

export function isStale(
  rootDir: string,
  key: string,
  inputs: string[]
): { stale: boolean; hash: string } {
  const hash = hashFiles(rootDir, inputs)
  const prior = readStamp(rootDir, key)
  return { stale: prior !== hash, hash }
}

export function markFresh(rootDir: string, key: string, hash: string): void {
  writeStamp(rootDir, key, hash)
}

export function clearStamps(rootDir: string): void {
  const dir = join(rootDir, STATE_DIR)
  if (!existsSync(dir)) return
  // Intentionally simple: next check will recompute. We don't delete the dir
  // because other dx state (ports.env, etc.) may live in .dx/, not .dx/.state/.
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".stamp")) unlinkSync(join(dir, f))
    }
  } catch (err) {
    console.warn(
      `clearStamps: failed to clear ${dir}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
