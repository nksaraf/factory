import { execFileSync } from "node:child_process"

import type { DxBase } from "../dx-root.js"
import {
  listLocalWorkspaces,
  showLocalWorkspace,
} from "../handlers/workspace/local-workspace.js"
import { EntityFinder } from "../lib/entity-finder.js"
import type { ResolvedEntity } from "../lib/entity-finder.js"
import { capture } from "../lib/subprocess.js"
import type { LocalWorkspaceInfo } from "../lib/worktree-detect.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { styleBold, styleError, styleMuted } from "./list-helpers.js"
import { connectToEntity } from "./ssh.js"

setExamples("open", [
  "$ dx open my-feature              Open worktree in editor (auto-detect cursor/code)",
  "$ dx open my-feature --terminal   Spawn a shell in the worktree directory",
  "$ dx open dev-vm                  Open remote workspace in editor via SSH",
  "$ dx open dev-vm /home/me/project Open remote workspace at a specific path",
  "$ dx open dev-vm --terminal       SSH into a remote workspace",
  "$ dx open --editor code           Force VS Code as editor",
])

// ---------------------------------------------------------------------------
// Editor detection
// ---------------------------------------------------------------------------

async function detectEditor(preference?: string): Promise<string> {
  const candidates =
    preference && ["cursor", "code"].includes(preference)
      ? [preference, ...(preference === "cursor" ? ["code"] : ["cursor"])]
      : ["cursor", "code"]

  for (const cmd of candidates) {
    const result = await capture(["which", cmd])
    if (result.exitCode === 0 && result.stdout.trim()) return cmd
  }

  throw new Error(
    "No supported editor found. Install Cursor (cursor) or VS Code (code)."
  )
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function openCommand(app: DxBase) {
  return app
    .sub("open")
    .meta({ description: "Open a workspace in your editor or terminal" })
    .args([
      {
        name: "target",
        type: "string",
        description: "Workspace name, slug, or ID",
      },
      {
        name: "path",
        type: "string",
        description:
          "Directory to open (remote path for SSH workspaces, local override for worktrees)",
      },
    ])
    .flags({
      terminal: {
        type: "boolean",
        short: "t",
        description: "Open a terminal session instead of an editor",
      },
      editor: {
        type: "string",
        description: "Editor to use: 'cursor' or 'code' (default: auto-detect)",
      },
    })
    .run(async ({ args, flags }) => {
      const target = args.target as string | undefined
      const editorPref = flags.editor as string | undefined

      if (editorPref && !["cursor", "code"].includes(editorPref)) {
        console.error(
          styleError(
            `Unsupported editor "${editorPref}". Use 'cursor' or 'code'.`
          )
        )
        process.exitCode = 1
        return
      }

      // ── Resolve target ───────────────────────────────────────────────
      let local: LocalWorkspaceInfo | null = null
      let remote: ResolvedEntity | null = null

      if (!target) {
        // Interactive picker
        const picked = await pickWorkspace()
        if ("tier" in picked) {
          local = picked as LocalWorkspaceInfo
        } else {
          remote = picked as ResolvedEntity
        }
      } else {
        // Try local worktree first (returns null if not found)
        local = await showLocalWorkspace(target)

        if (!local) {
          // Try remote (returns null if not found or API unreachable)
          try {
            const finder = new EntityFinder()
            remote = await finder.resolve(target)
          } catch {
            // API unreachable — fall through to "not found"
          }
        }

        if (!local && !remote) {
          console.error(styleError(`Workspace "${target}" not found.`))
          console.log(styleMuted("Try: dx workspace list"))
          process.exitCode = 1
          return
        }
      }

      // ── Dispatch ─────────────────────────────────────────────────────
      if (local) {
        await openLocal(local, {
          terminal: !!flags.terminal,
          editor: editorPref,
          path: args.path as string | undefined,
        })
      } else if (remote) {
        await openRemote(remote, {
          terminal: !!flags.terminal,
          editor: editorPref,
          path: args.path as string | undefined,
          flags,
        })
      }
    })
}

// ---------------------------------------------------------------------------
// Local worktree
// ---------------------------------------------------------------------------

async function openLocal(
  ws: LocalWorkspaceInfo,
  opts: { terminal: boolean; editor?: string; path?: string }
) {
  const dir = opts.path || ws.path

  if (opts.terminal) {
    console.log(styleMuted(`Opening shell in ${styleBold(ws.name)} → ${dir}`))
    const shell = process.env.SHELL || "/bin/bash"
    execFileSync(shell, [], { cwd: dir, stdio: "inherit" })
    return
  }

  const editorCmd = await detectEditor(opts.editor)
  console.log(
    styleMuted(`Opening ${styleBold(ws.name)} in ${editorCmd} → ${dir}`)
  )
  execFileSync(editorCmd, [dir], { stdio: "inherit" })
}

// ---------------------------------------------------------------------------
// Remote workspace
// ---------------------------------------------------------------------------

async function openRemote(
  entity: ResolvedEntity,
  opts: {
    terminal: boolean
    editor?: string
    path?: string
    flags: Record<string, unknown>
  }
) {
  if (opts.terminal) {
    const remoteCmd = opts.path
      ? ["cd", opts.path, "&&", "exec", "$SHELL", "-l"]
      : []
    return connectToEntity(entity, opts.flags, remoteCmd)
  }

  const editorCmd = await detectEditor(opts.editor)
  const remotePath = opts.path || "~"
  const sshAlias = entity.slug

  console.log(
    styleMuted(
      `Opening ${styleBold(entity.displayName)} in ${editorCmd} → ssh://${sshAlias}:${remotePath}`
    )
  )

  execFileSync(editorCmd, ["--remote", `ssh-remote+${sshAlias}`, remotePath], {
    stdio: "inherit",
  })
}

// ---------------------------------------------------------------------------
// Interactive picker
// ---------------------------------------------------------------------------

async function pickWorkspace(): Promise<LocalWorkspaceInfo | ResolvedEntity> {
  const { filter } = await import("@crustjs/prompts")

  // Gather local + remote in parallel
  const [localResult, remoteResult] = await Promise.allSettled([
    listLocalWorkspaces(),
    new EntityFinder().list(),
  ])

  const locals: LocalWorkspaceInfo[] =
    localResult.status === "fulfilled" ? localResult.value : []
  const remotes: ResolvedEntity[] =
    remoteResult.status === "fulfilled" ? remoteResult.value : []

  type Choice = LocalWorkspaceInfo | ResolvedEntity
  const choices: { label: string; value: Choice }[] = []

  for (const ws of locals) {
    choices.push({
      label: `${ws.name.padEnd(24)} ${styleMuted("worktree".padEnd(10))} ${styleMuted(ws.branch)}`,
      value: ws,
    })
  }

  for (const e of remotes) {
    choices.push({
      label: `${e.slug.padEnd(24)} ${styleMuted((e.realmType ?? e.type).padEnd(10))} ${styleMuted(e.status)}`,
      value: e,
    })
  }

  if (choices.length === 0) {
    console.error(styleError("No workspaces found."))
    process.exit(1)
  }

  return filter<Choice>({
    message: "Select a workspace to open",
    choices,
  })
}
