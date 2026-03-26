import { spawnSync } from "node:child_process";

import { styleBold, styleInfo, styleMuted, styleSuccess, styleWarn } from "../cli-style.js";
import { getCurrentBranch, getAheadBehind } from "../lib/git.js";
import { ProjectContext } from "../lib/project.js";
import type { DxFlags } from "../stub.js";

interface GitStatus {
  branch: string;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

interface ProjectInfo {
  name: string;
  root: string;
  components: string[];
}

function getGitFileStats(cwd: string): { modified: number; untracked: number } {
  const proc = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (proc.status !== 0) return { modified: 0, untracked: 0 };

  const lines = (proc.stdout || "").trim().split("\n").filter(Boolean);
  let modified = 0;
  let untracked = 0;
  for (const line of lines) {
    if (line.startsWith("??")) {
      untracked++;
    } else {
      modified++;
    }
  }
  return { modified, untracked };
}

function formatChanges(modified: number, untracked: number): string {
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} files modified`);
  if (untracked > 0) parts.push(`${untracked} untracked`);
  if (parts.length === 0) return "clean";
  return parts.join(", ");
}

function tryLoadProject(cwd: string): ProjectInfo | undefined {
  try {
    const ctx = ProjectContext.fromCwd(cwd);
    return {
      name: ctx.moduleConfig.module,
      root: ctx.rootDir,
      components: Object.keys(ctx.componentConfigs),
    };
  } catch {
    // No dx.yaml found — not a dx project
    return undefined;
  }
}

/** Context-local status: git + project info, no factory API required. */
export async function runContextStatus(flags: DxFlags): Promise<void> {
  const cwd = process.cwd();

  // --- Git context ---
  let gitStatus: GitStatus | undefined;
  try {
    const branch = getCurrentBranch(cwd);
    const { modified, untracked } = getGitFileStats(cwd);

    let ahead = 0;
    let behind = 0;
    try {
      const ab = getAheadBehind(cwd);
      ahead = ab.ahead;
      behind = ab.behind;
    } catch {
      // no upstream tracking branch
    }

    gitStatus = { branch, modified, untracked, ahead, behind };
  } catch {
    // not in a git repo
  }

  // --- Project context (dx.yaml) ---
  const project = tryLoadProject(cwd);

  // --- Output ---
  if (flags.json) {
    const result: Record<string, unknown> = { success: true };
    if (project) {
      result.project = {
        name: project.name,
        root: project.root,
        components: project.components,
      };
    }
    if (gitStatus) {
      result.git = {
        branch: gitStatus.branch,
        modified: gitStatus.modified,
        untracked: gitStatus.untracked,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
      };
    }
    result.cwd = cwd;
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  if (project) {
    console.log(`${styleBold("Project:")}    ${styleInfo(project.name)}`);
    if (project.components.length > 0) {
      console.log(`${styleBold("Components:")} ${project.components.join(", ")}`);
    }
    console.log(`${styleBold("Root:")}       ${styleMuted(project.root)}`);
  } else {
    console.log(styleMuted(`Directory: ${cwd}`));
  }

  if (gitStatus) {
    console.log("");
    console.log(`${styleBold("Branch:")}     ${styleInfo(gitStatus.branch)}`);
    console.log(
      `${styleBold("Changes:")}    ${gitStatus.modified === 0 && gitStatus.untracked === 0 ? styleSuccess("clean") : styleWarn(formatChanges(gitStatus.modified, gitStatus.untracked))}`
    );
    console.log(
      `${styleBold("Remote:")}     ${gitStatus.ahead} ahead, ${gitStatus.behind} behind`
    );
  }
}
