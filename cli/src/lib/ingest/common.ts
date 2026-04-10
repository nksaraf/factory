/**
 * Shared types and utilities for IDE session ingestion.
 * Adapted from scripts/ingest/lib/common.ts for cross-platform CLI use.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Types ────────────────────────────────────────────────────

export type IngestEvent = {
  source: "claude-code" | "conductor" | "cursor"
  deliveryId: string
  eventType: string
  action?: string
  sessionId: string
  timestamp: string
  cwd?: string
  project?: string
  payload?: Record<string, unknown>
}

export type IngestOptions = {
  since?: Date
  dryRun: boolean
  limit: number
  verbose: boolean
}

export type IngestResult = {
  sent: number
  duplicates: number
  errors: number
}

// ── Standardized token usage ────────────────────────────────

export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const ZERO_TOKENS: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
}

// ── Model normalization ─────────────────────────────────────

/**
 * Normalize model identifiers across sources to canonical form.
 *
 * Canonical forms:
 *   claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
 *   gpt-4o, gpt-4o-mini, o3, o4-mini
 *   cursor-composer-2, cursor-default
 *   codex (OpenAI Codex agent)
 *   unknown
 *
 * Extensible: add new patterns as new IDE agents (Codex, Pi, etc.) appear.
 */
export function normalizeModel(raw: string | undefined | null): string {
  if (!raw) return "unknown"
  const m = raw.trim().toLowerCase()
  if (!m || m === "unknown" || m === "<synthetic>") return "unknown"

  // Claude models — already canonical or short alias
  if (m === "opus" || m === "claude-opus-4-6") return "claude-opus-4-6"
  if (m === "sonnet" || m === "claude-sonnet-4-6") return "claude-sonnet-4-6"
  if (m.startsWith("claude-haiku-4-5")) return "claude-haiku-4-5"
  if (m.includes("opus") && m.includes("thinking")) return "claude-opus-4-6" // cursor's "claude-4.6-opus-high-thinking"
  // Catch-all for claude-* models we haven't seen yet
  if (m.startsWith("claude-")) return m

  // OpenAI models (for Codex, future agents)
  if (m.startsWith("gpt-4o")) return m // gpt-4o, gpt-4o-mini
  if (
    m === "o3" ||
    m === "o4-mini" ||
    m.startsWith("o3-") ||
    m.startsWith("o4-")
  )
    return m
  if (m === "codex" || m.startsWith("codex-")) return m

  // Cursor-specific models
  if (m === "default") return "cursor-default"
  if (m === "composer-2") return "cursor-composer-2"
  if (m === "composer-2-fast") return "cursor-composer-2-fast"

  // Google models (Gemini)
  if (m.startsWith("gemini-")) return m

  return m
}

// ── Timestamp ────────────────────────────────────────────────

/**
 * Fix timestamps that are local time but incorrectly tagged as UTC (with Z suffix).
 * Claude Code JSONL files stamp local wall-clock time with a Z suffix.
 * This strips the Z so JS Date() parses it as local time, then returns a proper UTC ISO string.
 */
export function fixLocalTimestamp(ts: string | undefined): string | undefined {
  if (!ts) return undefined
  const bare = ts.replace(/Z$/, "")
  const d = new Date(bare)
  if (isNaN(d.getTime())) return ts
  return d.toISOString()
}

// ── Truncation ───────────────────────────────────────────────

const MAX_TEXT = 4096
const MAX_SUMMARY = 500
const MAX_TOOL_INPUT = 2048

export function truncText(s: string | undefined, max = MAX_TEXT): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + "…[truncated]"
}

export function truncSummary(s: string | undefined): string {
  return truncText(s, MAX_SUMMARY)
}

export function truncToolInput(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "")
  return s.length <= MAX_TOOL_INPUT ? s : s.slice(0, MAX_TOOL_INPUT) + "…"
}

// ── Content extraction ───────────────────────────────────────

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n")
}

export type ToolCall = { name: string; input?: string }
export type ToolResult = {
  toolUseId: string
  isError: boolean
  error?: string
}

export function extractToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((c: any) => c?.type === "tool_use")
    .map((c: any) => ({
      name: c.name ?? "unknown",
      input: truncToolInput(c.input),
    }))
}

export function extractToolResults(content: unknown): ToolResult[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((c: any) => c?.type === "tool_result")
    .map((c: any) => {
      let errorText: string | undefined
      if (c.is_error) {
        const ct = c.content
        if (typeof ct === "string") {
          errorText = truncText(ct, 500)
        } else if (Array.isArray(ct)) {
          errorText = truncText(
            ct.map((x: any) => x?.text ?? "").join(" "),
            500
          )
        }
      }
      return {
        toolUseId: c.tool_use_id ?? "",
        isError: !!c.is_error,
        error: errorText,
      }
    })
}

export function extractToolNames(content: unknown): string[] {
  return [...new Set(extractToolCalls(content).map((t) => t.name))]
}

// ── System tag stripping ─────────────────────────────────────

export function stripSystemTags(text: string): string {
  return text
    .replace(/<system[_-]instruction>[\s\S]*?<\/system[_-]instruction>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, "")
    .trim()
}

// ── Tool error classification ────────────────────────────────

export function classifyToolError(error: string): string {
  const e = error.toLowerCase()
  if (e.includes("rejected") || e.includes("doesn't want"))
    return "user_rejected"
  if (
    e.includes("not found") ||
    e.includes("no such file") ||
    e.includes("does not exist")
  )
    return "file_not_found"
  if (e.includes("read it first") || e.includes("has not been read"))
    return "file_not_read_first"
  if (
    e.includes("exceeds maximum") ||
    e.includes("too_big") ||
    e.includes("too big")
  )
    return "too_large"
  if (e.includes("exit code")) return "command_failed"
  if (e.includes("validation") || e.includes("invalid"))
    return "validation_error"
  if (e.includes("timeout")) return "timeout"
  if (e.includes("rpc") || e.includes("tunnel") || e.includes("mcp error"))
    return "mcp_error"
  if (e.includes("modified since read")) return "file_modified_since_read"
  if (e.includes("permission")) return "permission_denied"
  if (e.includes("stream closed")) return "stream_closed"
  if (e.includes("found") && e.includes("matches")) return "ambiguous_edit"
  if (e.includes("status code 4") || e.includes("status code 5"))
    return "http_error"
  if (e.includes("eisdir") || e.includes("illegal operation on a directory"))
    return "is_directory"
  if (e.includes("no task found")) return "task_not_found"
  if (e.includes("cancelled") || e.includes("aborted")) return "cancelled"
  if (e.includes("outside allowed")) return "outside_allowed_dir"
  if (e.includes("hook error") || e.includes("pretooluse")) return "hook_error"
  return "other"
}

// ── Repo context resolution ──────────────────────────────────

export type RepoContext = {
  gitRemoteUrl?: string
  repoSlug?: string
  repoName?: string
}

const repoCache = new Map<string, RepoContext>()

export function remoteUrlToSlug(url: string): string | undefined {
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return match?.[1]
}

function resolveGitRemote(cwd: string): string | undefined {
  try {
    const result = Bun.spawnSync(
      ["git", "-C", cwd, "remote", "get-url", "origin"],
      { stdout: "pipe", stderr: "pipe", timeout: 2000 }
    )
    if (result.exitCode === 0) {
      return result.stdout.toString().trim() || undefined
    }
  } catch {}
  return undefined
}

/** Build a repo lookup table from Conductor's SQLite if available. */
let _conductorRepoMap: Map<string, string> | null = null

export function getConductorRepoMap(): Map<string, string> {
  if (_conductorRepoMap) return _conductorRepoMap
  _conductorRepoMap = new Map()

  try {
    const dbPath = getConductorDbPath()
    if (!dbPath) return _conductorRepoMap

    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare(
        "SELECT name, remote_url FROM repos WHERE remote_url IS NOT NULL"
      )
      .all() as any[]
    for (const row of rows) {
      _conductorRepoMap.set(row.name, row.remote_url)
    }
    db.close()
  } catch {}

  return _conductorRepoMap
}

/**
 * Cross-platform Conductor DB path detection.
 * Returns the path if the DB exists, null otherwise.
 */
export function getConductorDbPath(): string | null {
  const platform = process.platform
  const candidates: string[] = []

  if (platform === "darwin") {
    candidates.push(
      join(
        homedir(),
        "Library",
        "Application Support",
        "com.conductor.app",
        "conductor.db"
      )
    )
  } else if (platform === "linux") {
    const xdgData =
      process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
    candidates.push(join(xdgData, "conductor", "conductor.db"))
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    candidates.push(join(xdgConfig, "conductor", "conductor.db"))
  } else if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    candidates.push(join(appData, "conductor", "conductor.db"))
  }

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Cross-platform Cursor DB path detection.
 */
export function getCursorDbPath(): string | null {
  const dbPath = join(
    homedir(),
    ".cursor",
    "ai-tracking",
    "ai-code-tracking.db"
  )
  return existsSync(dbPath) ? dbPath : null
}

/**
 * Claude Code projects directory.
 */
export function getClaudeCodeProjectsDir(): string | null {
  const dir = join(homedir(), ".claude", "projects")
  return existsSync(dir) ? dir : null
}

/**
 * Resolve repo context from a cwd path. Tries:
 * 1. Cache hit
 * 2. `git remote get-url origin`
 * 3. Conductor repos DB lookup
 * 4. Path heuristic
 */
export function resolveRepoContext(cwd: string): RepoContext {
  if (repoCache.has(cwd)) return repoCache.get(cwd)!

  let ctx: RepoContext = {}

  // Strategy 1: direct git remote
  const remote = resolveGitRemote(cwd)
  if (remote) {
    ctx = {
      gitRemoteUrl: remote,
      repoSlug: remoteUrlToSlug(remote),
    }
    ctx.repoName = ctx.repoSlug?.split("/")[1]
    repoCache.set(cwd, ctx)
    return ctx
  }

  // Strategy 2: match against Conductor repos
  const conductorRepos = getConductorRepoMap()
  for (const [repoName, remoteUrl] of conductorRepos) {
    if (cwd.includes(`/${repoName}/`) || cwd.endsWith(`/${repoName}`)) {
      ctx = {
        gitRemoteUrl: remoteUrl,
        repoSlug: remoteUrlToSlug(remoteUrl),
        repoName,
      }
      repoCache.set(cwd, ctx)
      return ctx
    }
  }

  // Strategy 3: workspace path pattern
  const workspaceMatch = cwd.match(/\/workspaces\/([^/]+)\/([^/]+)/)
  if (workspaceMatch) {
    ctx = { repoName: workspaceMatch[1] }
    const url = conductorRepos.get(workspaceMatch[1])
    if (url) {
      ctx.gitRemoteUrl = url
      ctx.repoSlug = remoteUrlToSlug(url)
    }
  } else {
    // Try parent dir git remote (workspace might be a worktree)
    const parentDir = cwd.split("/").slice(0, -1).join("/")
    if (parentDir !== cwd) {
      const parentRemote = resolveGitRemote(parentDir)
      if (parentRemote) {
        ctx = {
          gitRemoteUrl: parentRemote,
          repoSlug: remoteUrlToSlug(parentRemote),
        }
        ctx.repoName = ctx.repoSlug?.split("/")[1]
      }
    }
  }

  repoCache.set(cwd, ctx)
  return ctx
}
