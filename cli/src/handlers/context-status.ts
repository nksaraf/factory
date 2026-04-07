import { spawnSync } from "node:child_process";

import { styleBold, styleInfo, styleMuted, styleSuccess, styleWarn, styleError } from "../cli-style.js";
import { getCurrentBranch, getAheadBehind } from "../lib/git.js";
import { isDockerRunning } from "../lib/docker.js";
import { resolveDxContext } from "../lib/dx-context.js";
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
  resources: string[];
}

interface ServiceStatus {
  name: string;
  status: string; // "running", "healthy", "unhealthy", "exited", "paused", etc.
  ports: string;
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

interface ResolvedProject extends ProjectInfo {
  composeFiles: string[];
}

async function tryLoadProject(cwd: string): Promise<ResolvedProject | undefined> {
  try {
    const ctx = await resolveDxContext({ need: "project", cwd });
    const project = ctx.project;
    return {
      name: project.name,
      root: project.rootDir,
      components: Object.keys(project.catalog.components),
      resources: Object.keys(project.catalog.resources),
      composeFiles: project.composeFiles,
    };
  } catch {
    // No compose files found — not a dx project
    return undefined;
  }
}

/**
 * Get running container statuses via `docker compose ps --format json`.
 */
function getComposeStatus(rootDir: string, composeFiles: string[]): ServiceStatus[] {
  if (!isDockerRunning()) return [];

  const args = ["compose"];
  for (const f of composeFiles) {
    args.push("-f", f);
  }
  args.push("ps", "--format", "json", "-a");

  const proc = spawnSync("docker", args, {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (proc.status !== 0) return [];

  const stdout = (proc.stdout || "").trim();
  if (!stdout) return [];

  const services: ServiceStatus[] = [];
  // docker compose ps --format json outputs one JSON object per line
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      services.push({
        name: obj.Service || obj.Name || "unknown",
        status: obj.State || obj.Status || "unknown",
        ports: obj.Publishers
          ? (obj.Publishers as Array<{ PublishedPort: number; TargetPort: number }>)
              .filter((p) => p.PublishedPort > 0)
              .map((p) => `${p.PublishedPort}→${p.TargetPort}`)
              .join(", ")
          : "",
      });
    } catch {
      // skip malformed lines
    }
  }
  return services;
}

function styleServiceStatus(status: string): string {
  if (status === "running") return styleSuccess(status);
  if (status.includes("healthy")) return styleSuccess(status);
  if (status.includes("unhealthy")) return styleError(status);
  if (status === "exited" || status === "dead") return styleError(status);
  return styleWarn(status);
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

  // --- Project context (docker-compose) ---
  const project = await tryLoadProject(cwd);

  // --- Compose service statuses ---
  let composeStatus: ServiceStatus[] = [];
  if (project) {
    composeStatus = getComposeStatus(project.root, project.composeFiles);
  }

  // --- Output ---
  if (flags.json) {
    const result: Record<string, unknown> = { success: true };
    if (project) {
      result.project = {
        name: project.name,
        root: project.root,
        components: project.components,
        resources: project.resources,
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
    if (composeStatus.length > 0) {
      result.services = composeStatus;
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
    if (project.resources.length > 0) {
      console.log(`${styleBold("Resources:")}  ${project.resources.join(", ")}`);
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

  // --- Compose services ---
  if (composeStatus.length > 0) {
    console.log("");
    console.log(styleBold("Services:"));
    for (const svc of composeStatus) {
      const ports = svc.ports ? styleMuted(` (${svc.ports})`) : "";
      console.log(`  ${svc.name.padEnd(24)} ${styleServiceStatus(svc.status)}${ports}`);
    }
  } else if (project) {
    console.log("");
    console.log(styleMuted("Services:    not running (use dx dev or docker compose up)"));
  }
}
