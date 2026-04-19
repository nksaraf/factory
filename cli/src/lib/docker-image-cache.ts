/**
 * Host-level Docker image pull cache.
 *
 * Tracks which images have been pulled and their digests so that
 * `dx sync` can report image status without hitting the network.
 * `dx sync --pull` forces a registry check and updates the cache.
 *
 * Cache lives at ~/.dx/cache/docker-pulls.json (shared across all projects).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { DX_CACHE_DIR } from "./host-dirs.js"

export interface ImageCacheEntry {
  digest: string
  pulledAt: string
}

export interface ImagePullResult {
  total: number
  upToDate: number
  updated: string[]
  failed: string[]
}

const CACHE_FILE = join(DX_CACHE_DIR, "docker-pulls.json")

function readCache(): Record<string, ImageCacheEntry> {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"))
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, ImageCacheEntry>): void {
  mkdirSync(DX_CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

const DIGEST_FORMAT =
  "{{if gt (len .RepoDigests) 0}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}"

/** Parse a digest line — strip repo@ prefix if present. */
function parseDigestLine(line: string): string {
  const atIdx = line.indexOf("@")
  return atIdx >= 0 ? line.slice(atIdx + 1) : line
}

/**
 * Get local digests for multiple images in a single docker inspect call.
 * Returns a map of image → digest (null for images not present locally).
 */
function localDigests(images: string[]): Record<string, string | null> {
  if (images.length === 0) return {}

  const result = spawnSync(
    "docker",
    ["inspect", "--format", DIGEST_FORMAT, ...images],
    { encoding: "utf8", timeout: 10_000 }
  )

  const digests: Record<string, string | null> = {}
  if (result.status === 0) {
    const lines = result.stdout.trim().split("\n")
    for (let i = 0; i < images.length && i < lines.length; i++) {
      const line = lines[i]!.trim()
      digests[images[i]!] = line ? parseDigestLine(line) : null
    }
  }

  // If batch inspect failed (e.g. one image missing causes full failure),
  // fall back to individual inspects
  if (result.status !== 0) {
    for (const image of images) {
      const r = spawnSync(
        "docker",
        ["inspect", "--format", DIGEST_FORMAT, image],
        {
          encoding: "utf8",
          timeout: 5_000,
        }
      )
      if (r.status === 0) {
        const line = r.stdout.trim()
        digests[image] = line ? parseDigestLine(line) : null
      } else {
        digests[image] = null
      }
    }
  }

  // Fill in any images not in the result
  for (const image of images) {
    if (!(image in digests)) digests[image] = null
  }

  return digests
}

/**
 * Extract all images from compose files in a project directory.
 * Uses `docker compose config` to resolve variables and get the merged config.
 */
export function extractComposeImages(
  rootDir: string,
  composeFiles: string[]
): string[] {
  const args = ["compose"]
  for (const f of composeFiles) args.push("-f", f)
  args.push("config", "--format", "json")

  const result = spawnSync("docker", args, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 10_000,
  })
  if (result.status !== 0) return []

  try {
    const config = JSON.parse(result.stdout)
    const images: string[] = []
    for (const svc of Object.values(config.services ?? {})) {
      const image = (svc as { image?: string }).image
      if (image) images.push(image)
    }
    return [...new Set(images)]
  } catch {
    return []
  }
}

/**
 * Check image status from cache — no network calls, single docker inspect.
 * Returns cached (digest matches) vs missing (not in cache or digest changed).
 */
export function checkImageStatus(images: string[]): {
  cached: string[]
  missing: string[]
} {
  const cache = readCache()
  const cached: string[] = []
  const missing: string[] = []

  // Split into images we have cache entries for vs ones we don't
  const needsVerify: string[] = []
  for (const image of images) {
    if (cache[image]) {
      needsVerify.push(image)
    } else {
      missing.push(image)
    }
  }

  // Batch-verify cached images still match locally
  if (needsVerify.length > 0) {
    const digests = localDigests(needsVerify)
    for (const image of needsVerify) {
      const digest = digests[image]
      if (digest && digest === cache[image]!.digest) {
        cached.push(image)
      } else {
        missing.push(image)
      }
    }
  }

  return { cached, missing }
}

/**
 * Pull images from registry and update the cache.
 * Returns which images were updated vs already up-to-date.
 */
export function pullAndCacheImages(
  rootDir: string,
  composeFiles: string[],
  images: string[],
  opts?: { quiet?: boolean }
): ImagePullResult {
  const cache = readCache()
  const log = opts?.quiet
    ? (..._args: unknown[]) => {}
    : (...args: unknown[]) => console.log(...args)

  // Snapshot digests before pull (single batch call)
  const beforeDigests = localDigests(images)

  // Pull via docker compose (handles auth, parallel pulls, etc.)
  const args = ["compose"]
  for (const f of composeFiles) args.push("-f", f)
  args.push("pull", "--ignore-pull-failures")
  if (opts?.quiet) args.push("--quiet")

  log("  ⟳ Docker images: pulling...")
  spawnSync("docker", args, {
    cwd: rootDir,
    stdio: opts?.quiet ? "ignore" : "inherit",
    timeout: 120_000,
  })

  // Snapshot digests after pull (single batch call)
  const afterDigests = localDigests(images)

  const result: ImagePullResult = {
    total: images.length,
    upToDate: 0,
    updated: [],
    failed: [],
  }

  for (const image of images) {
    const afterDigest = afterDigests[image]
    if (!afterDigest) {
      result.failed.push(image)
      continue
    }

    const before = beforeDigests[image]
    if (before && before === afterDigest) {
      result.upToDate++
    } else {
      result.updated.push(image)
    }

    cache[image] = {
      digest: afterDigest,
      pulledAt: new Date().toISOString(),
    }
  }

  writeCache(cache)
  return result
}

/**
 * Seed the cache from locally-present images (no network).
 * Single batch docker inspect call.
 */
export function seedCacheFromLocal(images: string[]): number {
  const cache = readCache()
  const uncached = images.filter((img) => !cache[img])
  if (uncached.length === 0) return 0

  const digests = localDigests(uncached)
  let seeded = 0

  for (const image of uncached) {
    const digest = digests[image]
    if (digest) {
      cache[image] = {
        digest,
        pulledAt: new Date().toISOString(),
      }
      seeded++
    }
  }

  if (seeded > 0) writeCache(cache)
  return seeded
}
