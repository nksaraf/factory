export const SOURCE_ICON: Record<string, string> = {
  "claude-code": "icon-[simple-icons--claude]",
  cursor: "icon-[simple-icons--cursor]",
  conductor: "icon-[ph--music-notes-duotone]",
  slack: "icon-[simple-icons--slack]",
  terminal: "icon-[ph--terminal-window-duotone]",
  web: "icon-[ph--globe-duotone]",
}

export const ROLE_STYLE: Record<string, string> = {
  user: "border-sky-700/40 bg-sky-950/20 dark:bg-sky-950/20 bg-sky-50",
  assistant: "border-border bg-card",
  system: "border-amber-700/40 bg-amber-50 dark:bg-amber-950/10",
  tool: "border-violet-700/40 bg-violet-50 dark:bg-violet-950/10",
  thinking: "border-border bg-muted italic",
  subagent: "border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/10",
}

export const ROLE_ICON: Record<string, string> = {
  user: "icon-[ph--user-duotone]",
  assistant: "icon-[simple-icons--claude]",
  system: "icon-[ph--gear-duotone]",
  tool: "icon-[ph--wrench-duotone]",
  thinking: "icon-[ph--brain-duotone]",
  subagent: "icon-[ph--robot-duotone]",
}

const TOOL_ICON: Record<string, string> = {
  bash: "icon-[ph--terminal-duotone]",
  read: "icon-[ph--file-text-duotone]",
  edit: "icon-[ph--pencil-simple-duotone]",
  write: "icon-[ph--file-plus-duotone]",
  glob: "icon-[ph--funnel-duotone]",
  grep: "icon-[ph--magnifying-glass-duotone]",
  webfetch: "icon-[ph--globe-duotone]",
  websearch: "icon-[ph--magnifying-glass-duotone]",
  task: "icon-[ph--robot-duotone]",
  todowrite: "icon-[ph--check-square-duotone]",
}

export function toolIcon(name: string | undefined): string {
  if (!name) return "icon-[ph--wrench-duotone]"
  return TOOL_ICON[name.toLowerCase()] ?? "icon-[ph--wrench-duotone]"
}

export function formatDuration(start: string, end?: string | null): string {
  const a = new Date(start).getTime()
  const b = end ? new Date(end).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((b - a) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function formatTokens(n?: number): string {
  if (!n) return "0"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function detectPlanSlug(
  toolName: string | undefined,
  input: string | undefined
): string | null {
  if (!input) return null
  const name = (toolName ?? "").toLowerCase()
  if (name !== "write" && name !== "edit" && name !== "read") return null
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(input) as Record<string, unknown>
  } catch {
    return null
  }
  const fp = parsed?.file_path
  if (typeof fp !== "string") return null
  const m =
    fp.match(/\/\.claude\/plans\/([^/]+)\.md$/) ||
    fp.match(/\/docs\/superpowers\/plans\/([^/]+)\.md$/) ||
    fp.match(/\/\.context\/plans\/([^/]+)\.md$/)
  return m ? m[1]! : null
}

export function summarizeToolInput(
  toolName: string | undefined,
  input: string | undefined
): string {
  if (!input) return ""
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(input) as Record<string, unknown>
  } catch {
    return input.slice(0, 160)
  }
  const name = (toolName ?? "").toLowerCase()
  const pick = (k: string): string | undefined => {
    const v = parsed?.[k]
    return typeof v === "string" ? v : undefined
  }
  if (name === "bash") return pick("command") ?? pick("description") ?? ""
  if (name === "read" || name === "edit" || name === "write")
    return pick("file_path") ?? ""
  if (name === "glob") return pick("pattern") ?? ""
  if (name === "grep") {
    const p = pick("pattern") ?? ""
    const path = pick("path")
    return path ? `${p}  ${path}` : p
  }
  if (name === "webfetch") return pick("url") ?? ""
  const first =
    pick("command") ??
    pick("description") ??
    pick("file_path") ??
    pick("pattern") ??
    pick("url") ??
    pick("prompt") ??
    ""
  return first || JSON.stringify(parsed).slice(0, 160)
}

export function channelLabel(c: {
  name?: string | null
  externalId?: string | null
  id: string
}): string {
  return c.name?.trim() || c.externalId || c.id.slice(0, 10)
}
