import { homedir } from "node:os"
import { join } from "node:path"
import { upsertManagedBlock, readManagedBlock } from "./file-utils.js"
import { capture } from "../../../lib/subprocess.js"
import type { ConfigProvider, ConfigChange } from "./types.js"

const ZSH_LINES = [
  "export HISTSIZE=100000",
  "export SAVEHIST=100000",
  "export HISTFILE=~/.zsh_history",
  "setopt SHARE_HISTORY",
  "setopt HIST_IGNORE_ALL_DUPS",
  "setopt HIST_REDUCE_BLANKS",
  "setopt AUTO_CD",
  "setopt CORRECT",
]

const BASH_LINES = [
  "export HISTSIZE=100000",
  "export HISTFILESIZE=200000",
  "export HISTCONTROL=ignoreboth:erasedups",
  "export HISTTIMEFORMAT='%F %T '",
  "shopt -s histappend",
  "shopt -s autocd",
  "shopt -s cdspell",
]

export const shellDefaultsProvider: ConfigProvider = {
  name: "Shell defaults",
  category: "shell",
  roles: ["workbench"],

  async detect(): Promise<ConfigChange[]> {
    if (process.platform === "win32") return detectWindows()
    if (process.platform === "darwin") return detectDarwinShell()
    return detectLinuxShell()
  },
}

function detectDarwinShell(): ConfigChange[] {
  // macOS defaults to zsh
  const zshrcPath = join(homedir(), ".zshrc")
  return [makeShellChange("zsh", zshrcPath, ZSH_LINES)]
}

function detectLinuxShell(): ConfigChange[] {
  const changes: ConfigChange[] = []

  // Check both bash and zsh
  const bashrcPath = join(homedir(), ".bashrc")
  changes.push(makeShellChange("bash", bashrcPath, BASH_LINES))

  const zshrcPath = join(homedir(), ".zshrc")
  // Only add zsh if the user has a .zshrc or zsh is the login shell
  const shell = process.env.SHELL ?? ""
  if (shell.includes("zsh")) {
    changes.push(makeShellChange("zsh", zshrcPath, ZSH_LINES))
  }

  return changes
}

async function detectWindows(): Promise<ConfigChange[]> {
  const result = await capture([
    "powershell",
    "-Command",
    "(Get-PSReadLineOption).HistorySaveStyle",
  ])
  const current = result.exitCode === 0 ? result.stdout.trim() : null
  const applied = current === "SaveIncrementally"

  return [
    {
      id: "shell:powershell-history",
      category: "shell",
      description: "PowerShell: SaveIncrementally + MaximumHistoryCount 10000",
      target: "PowerShell profile",
      currentValue: current,
      proposedValue: "SaveIncrementally",
      alreadyApplied: applied,
      requiresSudo: false,
      platform: "win32",
      apply: async () => {
        const r = await capture([
          "powershell",
          "-Command",
          "Set-PSReadLineOption -HistorySaveStyle SaveIncrementally; Set-PSReadLineOption -MaximumHistoryCount 10000",
        ])
        return r.exitCode === 0
      },
    },
  ]
}

function makeShellChange(
  shell: string,
  rcPath: string,
  lines: string[]
): ConfigChange {
  const currentBlock = readManagedBlock(rcPath)
  const applied =
    currentBlock !== null && lines.every((l) => currentBlock.includes(l))

  return {
    id: `shell:${shell}`,
    category: "shell",
    description: `${shell}: history, navigation, dedup defaults`,
    target: rcPath,
    currentValue: currentBlock ? "configured" : null,
    proposedValue: `${lines.length} settings`,
    alreadyApplied: applied,
    requiresSudo: false,
    platform: null,
    apply: async () => upsertManagedBlock(rcPath, lines),
  }
}
