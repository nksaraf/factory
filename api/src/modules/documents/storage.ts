/**
 * Filesystem-backed document storage adapter.
 * Swap point for S3/GCS later — same interface, different backend.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const DOCUMENTS_ROOT = resolve(process.env.DOCUMENTS_PATH ?? "/data/documents")

export function resolveDocumentPath(path: string): string {
  const full = resolve(join(DOCUMENTS_ROOT, path))
  if (!full.startsWith(DOCUMENTS_ROOT + "/") && full !== DOCUMENTS_ROOT) {
    throw new Error(`Path traversal denied: ${path}`)
  }
  return full
}

export async function writeDocument(
  path: string,
  content: Buffer | string
): Promise<void> {
  const fullPath = resolveDocumentPath(path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, "utf-8")
}

export async function readDocument(path: string): Promise<Buffer> {
  return readFile(resolveDocumentPath(path))
}

export async function documentExists(path: string): Promise<boolean> {
  try {
    await stat(resolveDocumentPath(path))
    return true
  } catch {
    return false
  }
}
