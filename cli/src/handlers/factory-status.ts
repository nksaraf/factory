import { spawnSync } from "node:child_process";

import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { styleBold, styleError, styleInfo, styleSuccess, styleWarn } from "../cli-style.js";
import { getFactoryClient, getFactoryRestClient } from "../client.js";
import { readConfig, resolveFactoryUrl, resolveFactoryMode } from "../config.js";
import { ErrorRegistry } from "../errors.js";
import { getCurrentBranch, getAheadBehind } from "../lib/git.js";
import { resolveRepoContext } from "../lib/repo-context.js";
import { type DxFlags } from "../stub.js";

type HealthBody = { status?: string; service?: string };

interface GitStatus {
  branch: string;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

interface PrStatus {
  number: number;
  state: string;
  draft: boolean;
  title: string;
  checksPassing: number;
  checksTotal: number;
  failedChecks: string[];
}

function exitApiUnreachable(
  flags: DxFlags,
  apiUrl: string,
  debugInfo?: string
): never {
  const reg = ErrorRegistry.API_UNREACHABLE;
  const message = `${reg.message} at ${apiUrl}`;
  const suggestions = reg.suggestions.map((s) =>
    s.description.includes("$apiUrl")
      ? { ...s, description: s.description.replace("$apiUrl", apiUrl) }
      : s
  );

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code: "API_UNREACHABLE",
            message,
            details: debugInfo ? { reason: debugInfo } : undefined,
            suggestions,
          },
          exitCode: ExitCodes.CONNECTION_FAILURE,
        },
        null,
        2
      )
    );
    process.exit(ExitCodes.CONNECTION_FAILURE);
  }

  console.error(styleError(message));
  if (flags.debug && debugInfo) {
    console.error(styleError(debugInfo));
  }
  for (const sug of suggestions) {
    console.error(styleError(`  • ${sug.action}: ${sug.description}`));
  }
  process.exit(ExitCodes.CONNECTION_FAILURE);
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

export async function runFactoryStatus(flags: DxFlags): Promise<void> {
  const config = await readConfig();
  const displayUrl = resolveFactoryUrl(config);
  const cwd = process.cwd();

  // --- API health check ---
  let apiStatus: { status: string; service: string } | undefined;
  try {
    const api = await getFactoryClient();
    const res = await api.health.get();
    const data = res.data as HealthBody | undefined;
    if (data?.status) {
      apiStatus = {
        status: data.status,
        service: data.service ?? "factory-api",
      };
    } else {
      const errDetail = res.error
        ? JSON.stringify(res.error)
        : "Health endpoint returned no body or missing status field";
      exitApiUnreachable(flags, displayUrl, errDetail);
    }
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : JSON.stringify(err);
    exitApiUnreachable(flags, displayUrl, detail);
  }

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
      // no upstream tracking branch — that's fine
    }

    gitStatus = { branch, modified, untracked, ahead, behind };
  } catch {
    // not in a git repo — skip git section
  }

  // --- PR context ---
  let prStatus: PrStatus | undefined;
  if (gitStatus) {
    try {
      const ctx = await resolveRepoContext(cwd);
      const rest = await getFactoryRestClient();

      const pullsRes = await rest.request<{ data: Record<string, unknown>[] }>(
        "GET",
        `/api/v1/factory/build/git-host-provider/${ctx.providerId}/repos/${ctx.repoSlug}/pulls?state=open`,
      );

      const pulls = pullsRes?.data ?? [];
      const pr = pulls.find(
        (p) => p.head === gitStatus.branch
      );

      if (pr) {
        const prNumber = pr.number as number;
        let checksPassing = 0;
        let checksTotal = 0;
        const failedChecks: string[] = [];

        try {
          const checksRes = await rest.request<{ data: Record<string, unknown>[] }>(
            "GET",
            `/api/v1/factory/build/git-host-provider/${ctx.providerId}/repos/${ctx.repoSlug}/pulls/${prNumber}/checks`,
          );
          const checks = checksRes?.data ?? [];
          checksTotal = checks.length;
          for (const check of checks) {
            if (check.conclusion === "success" || (check.status === "completed" && check.conclusion === "success")) {
              checksPassing++;
            } else if (check.conclusion && check.conclusion !== "success") {
              failedChecks.push((check.name as string) ?? "unknown");
            }
          }
        } catch {
          // checks not available
        }

        prStatus = {
          number: prNumber,
          state: (pr.state as string) ?? "open",
          draft: (pr.draft as boolean) ?? false,
          title: (pr.title as string) ?? "",
          checksPassing,
          checksTotal,
          failedChecks,
        };
      }
    } catch {
      // repo not in factory or API error — skip PR section
    }
  }

  // --- Output ---
  const modeInfo = resolveFactoryMode(config);

  if (flags.json) {
    const result: Record<string, unknown> = {
      success: true,
      factoryMode: modeInfo.mode,
      factoryUrl: modeInfo.url,
      envOverride: modeInfo.envOverride,
      api: apiStatus
        ? { status: apiStatus.status, service: apiStatus.service }
        : undefined,
    };
    if (gitStatus) {
      result.git = {
        branch: gitStatus.branch,
        modified: gitStatus.modified,
        untracked: gitStatus.untracked,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
      };
    }
    if (prStatus) {
      result.pr = {
        number: prStatus.number,
        state: prStatus.state,
        draft: prStatus.draft,
        title: prStatus.title,
        checksPassing: prStatus.checksPassing,
        checksTotal: prStatus.checksTotal,
      };
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  console.log(`${styleBold("Factory:")}    ${modeInfo.mode === "local" ? styleSuccess(modeInfo.label) : styleInfo(modeInfo.label)}`);
  if (apiStatus) {
    console.log(
      `${styleBold("API:")}        ${styleSuccess(`${apiStatus.status} (${apiStatus.service})`)}`
    );
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

  if (prStatus) {
    console.log("");
    const draftLabel = prStatus.draft ? " (draft)" : "";
    console.log(
      `${styleBold(`PR #${prStatus.number}:`)}   ${prStatus.state}${draftLabel} — "${prStatus.title}"`
    );
    if (prStatus.checksTotal > 0) {
      const allPassing = prStatus.checksPassing === prStatus.checksTotal;
      const checksLabel = `${prStatus.checksPassing}/${prStatus.checksTotal} passing`;
      const failedLabel = prStatus.failedChecks.length > 0
        ? ` (${prStatus.failedChecks.map((n) => `${n} \u2717`).join(", ")})`
        : "";
      console.log(
        `${styleBold("Checks:")}     ${allPassing ? styleSuccess(checksLabel) : styleWarn(checksLabel + failedLabel)}`
      );
    }
  }
}
