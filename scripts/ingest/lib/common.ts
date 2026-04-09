/**
 * Shared utilities for backfill ingestion scripts.
 */

export type IngestEvent = {
  source: "claude-code" | "conductor" | "cursor"
  providerId: string
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

export function parseArgs(args: string[]): IngestOptions {
  const sinceIdx = args.indexOf("--since")
  const limitIdx = args.indexOf("--limit")
  return {
    since: sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : undefined,
    dryRun: args.includes("--dry-run"),
    limit: limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity,
    verbose: args.includes("--verbose"),
  }
}

const MAX_TEXT = 4096
const MAX_SUMMARY = 500
const MAX_TOOL_INPUT = 2048

/**
 * Strip system instruction tags from user prompts to extract the actual user message.
 * Claude Code wraps user messages with <system_instruction>, <system-instruction>, <system-reminder> blocks.
 */
export function stripSystemTags(text: string): string {
  // Remove all <system_instruction>...</system_instruction> and similar blocks
  let cleaned = text
    .replace(/<system[_-]instruction>[\s\S]*?<\/system[_-]instruction>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, "")
    .trim()
  return cleaned
}

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

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n")
}

export type ToolCall = { name: string; input?: string }
export type ToolResult = { toolUseId: string; isError: boolean; error?: string }

export function extractToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((c: any) => c?.type === "tool_use")
    .map((c: any) => ({
      name: c.name ?? "unknown",
      input: truncToolInput(c.input),
    }))
}

/**
 * Extract tool results from user message content (tool_result blocks).
 * Returns results with error status and error text.
 */
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
            500,
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

/**
 * Classify a tool error into a category for analytics.
 */
export function classifyToolError(error: string): string {
  const e = error.toLowerCase()
  if (e.includes("rejected") || e.includes("doesn't want")) return "user_rejected"
  if (e.includes("not found") || e.includes("no such file") || e.includes("does not exist")) return "file_not_found"
  if (e.includes("read it first") || e.includes("has not been read")) return "file_not_read_first"
  if (e.includes("exceeds maximum") || e.includes("too_big") || e.includes("too big")) return "too_large"
  if (e.includes("exit code")) return "command_failed"
  if (e.includes("validation") || e.includes("invalid")) return "validation_error"
  if (e.includes("timeout")) return "timeout"
  if (e.includes("rpc") || e.includes("tunnel") || e.includes("mcp error")) return "mcp_error"
  if (e.includes("modified since read")) return "file_modified_since_read"
  if (e.includes("permission")) return "permission_denied"
  if (e.includes("stream closed")) return "stream_closed"
  if (e.includes("found") && e.includes("matches")) return "ambiguous_edit"
  if (e.includes("status code 4") || e.includes("status code 5")) return "http_error"
  if (e.includes("eisdir") || e.includes("illegal operation on a directory")) return "is_directory"
  if (e.includes("no task found")) return "task_not_found"
  if (e.includes("cancelled") || e.includes("aborted")) return "cancelled"
  if (e.includes("outside allowed")) return "outside_allowed_dir"
  if (e.includes("hook error") || e.includes("pretooluse")) return "hook_error"
  return "other"
}

export function extractToolNames(content: unknown): string[] {
  return [...new Set(extractToolCalls(content).map((t) => t.name))]
}

export function progress(current: number, total: number, label: string) {
  if (current % 50 === 0 || current === total) {
    console.error(`  [${current}/${total}] ${label}`)
  }
}

/**
 * Resolve git repo context from a working directory path.
 * Uses multiple strategies: git remote, Conductor repos DB, path heuristics.
 */
export type RepoContext = {
  gitRemoteUrl?: string
  repoSlug?: string // e.g. "nksaraf/factory"
  repoName?: string // e.g. "factory"
}

// Cache resolved repos to avoid repeated git calls
const repoCache = new Map<string, RepoContext>()

/**
 * Extract owner/repo slug from a GitHub remote URL.
 * Handles both HTTPS and SSH formats.
 */
export function remoteUrlToSlug(url: string): string | undefined {
  // https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return match?.[1]
}

/**
 * Try to resolve the git remote URL for a directory by running `git remote get-url origin`.
 * Returns undefined if the directory doesn't exist or has no remote.
 */
function resolveGitRemote(cwd: string): string | undefined {
  try {
    const result = Bun.spawnSync(["git", "-C", cwd, "remote", "get-url", "origin"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 2000,
    })
    if (result.exitCode === 0) {
      return result.stdout.toString().trim() || undefined
    }
  } catch {}
  return undefined
}

/**
 * Build a lookup table from Conductor's repos table: repoName -> remoteUrl.
 * Only reads the DB once and caches the result.
 */
let _conductorRepoMap: Map<string, string> | null = null

function getConductorRepoMap(): Map<string, string> {
  if (_conductorRepoMap) return _conductorRepoMap
  _conductorRepoMap = new Map()

  try {
    const { Database } = require("bun:sqlite")
    const dbPath = require("node:path").join(
      require("node:os").homedir(),
      "Library", "Application Support", "com.conductor.app", "conductor.db",
    )
    if (!require("node:fs").existsSync(dbPath)) return _conductorRepoMap

    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare("SELECT name, remote_url FROM repos WHERE remote_url IS NOT NULL").all() as any[]
    for (const row of rows) {
      _conductorRepoMap.set(row.name, row.remote_url)
    }
    db.close()
  } catch {}

  return _conductorRepoMap
}

/**
 * Resolve repo context from a cwd path. Tries:
 * 1. Cache hit
 * 2. `git remote get-url origin` on the directory
 * 3. Match path against Conductor repos table (by repo name in path)
 * 4. Path heuristic: extract repo name from path patterns like ~/workspaces/<repo>/<workspace>
 */
export function resolveRepoContext(cwd: string): RepoContext {
  if (repoCache.has(cwd)) return repoCache.get(cwd)!

  let ctx: RepoContext = {}

  // Strategy 1: direct git remote
  const remote = resolveGitRemote(cwd)
  if (remote) {
    ctx = { gitRemoteUrl: remote, repoSlug: remoteUrlToSlug(remote) }
    ctx.repoName = ctx.repoSlug?.split("/")[1]
    repoCache.set(cwd, ctx)
    return ctx
  }

  // Strategy 2: match path against Conductor repos
  // Conductor workspace paths: ~/conductor/workspaces/<repoName>/<cityName>
  // Also: ~/garage/LeptonSoftware/<repoName>
  const conductorRepos = getConductorRepoMap()
  for (const [repoName, remoteUrl] of conductorRepos) {
    if (cwd.includes(`/${repoName}/`) || cwd.endsWith(`/${repoName}`)) {
      ctx = { gitRemoteUrl: remoteUrl, repoSlug: remoteUrlToSlug(remoteUrl), repoName }
      repoCache.set(cwd, ctx)
      return ctx
    }
  }

  // Strategy 3: path heuristic for workspace patterns
  const workspaceMatch = cwd.match(/\/workspaces\/([^/]+)\/([^/]+)/)
  if (workspaceMatch) {
    ctx = { repoName: workspaceMatch[1] }
    // Try looking up in Conductor repos
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
        ctx = { gitRemoteUrl: parentRemote, repoSlug: remoteUrlToSlug(parentRemote) }
        ctx.repoName = ctx.repoSlug?.split("/")[1]
      }
    }
  }

  repoCache.set(cwd, ctx)
  return ctx
}
