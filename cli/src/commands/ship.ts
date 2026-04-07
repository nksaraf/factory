import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { validateCommitMessage } from "@smp/factory-shared/conventions";
import { ExitCodes } from "@smp/factory-shared/exit-codes";

import type { DxBase } from "../dx-root.js";
import { getFactoryRestClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { resolveDxContext } from "../lib/dx-context.js";
import { stageAll, gitCommit, getCurrentBranch } from "../lib/git.js";
import { gitPushAuto } from "../lib/git-push.js";
import { resolveRepoContext } from "../lib/repo-context.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("ship", [
  "$ dx ship                         Commit, push, and open PR",
  '$ dx ship --title "Add auth"      With PR title',
  "$ dx ship --draft                 As draft PR",
]);

export function shipCommand(app: DxBase) {
  return app
    .sub("ship")
    .meta({ description: "Commit, push, and open a PR in one step" })
    .args([
      {
        name: "message",
        type: "string",
        required: true,
        description: "Commit message",
      },
    ])
    .flags({
      draft: { type: "boolean", description: "Create PR as draft" },
      title: { type: "string", description: "PR title (defaults to commit message)" },
      noStage: { type: "boolean", description: "Skip staging all changes" },
      force: { type: "boolean", description: "Allow convention violations" },
      base: { type: "string", description: "PR base branch (defaults to repo default)" },
      reason: { type: "string", description: "Reason when using --force" },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        const cwd = process.cwd();

        // 1. Validate commit message
        const dxCtx = await resolveDxContext({ need: "host", cwd });
        const conventions = dxCtx.project?.conventions ?? defaultConventionsConfig();
        const result = validateCommitMessage(args.message, conventions);
        if (!result.valid && !flags.force) {
          if (f.json) {
            console.log(
              JSON.stringify({
                success: false,
                error: {
                  code: "CONVENTION_VIOLATION",
                  violations: result.violations,
                  suggestions: result.suggestions,
                },
                exitCode: ExitCodes.CONVENTION_VIOLATION,
              })
            );
            process.exit(ExitCodes.CONVENTION_VIOLATION);
          }
          console.error(
            `Convention violation:\n${result.violations.join("\n")}\n\nSuggestions:\n${result.suggestions.join("\n")}\n\nUse --force with --reason to override.`
          );
          process.exit(ExitCodes.CONVENTION_VIOLATION);
        }
        if (!result.valid && flags.force && flags.reason && !f.json) {
          console.error(`Convention override: ${flags.reason}`);
        }

        // 2. Stage all (unless --no-stage)
        if (!flags.noStage) {
          stageAll(cwd);
        }

        // 3. Commit
        const sha = gitCommit(cwd, args.message);

        // 4. Push
        gitPushAuto(cwd);

        // 5. Create or find PR
        let prUrl: string | undefined;
        let prNumber: number | undefined;

        try {
          const ctx = await resolveRepoContext(cwd);
          const branch = getCurrentBranch(cwd);
          const rest = await getFactoryRestClient();
          const pullsBase = `/api/v1/factory/build/git-host-provider/${ctx.providerId}/repos/${ctx.repoSlug}/pulls`;

          // Check for existing open PR on this branch
          const listRes = await rest.request<{ data?: Record<string, unknown>[] }>(
            "GET", `${pullsBase}?state=open`
          );
          const pulls = Array.isArray(listRes?.data) ? listRes.data : [];
          const existing = pulls.find((pr) => pr.head === branch);

          if (existing) {
            prNumber = existing.number as number;
            prUrl = (existing.url ?? existing.htmlUrl) as string;
          } else {
            // Create new PR
            const prTitle = (flags.title as string) || args.message;
            const prBase = (flags.base as string) || ctx.defaultBranch;
            const createRes = await rest.request<{ data?: Record<string, unknown> }>(
              "POST", pullsBase,
              {
                title: prTitle,
                body: "",
                head: branch,
                base: prBase,
                draft: !!flags.draft,
              }
            );
            const pr = createRes?.data ?? (createRes as Record<string, unknown>);
            prNumber = pr.number as number;
            prUrl = (pr.url ?? pr.htmlUrl) as string;
          }
        } catch {
          // PR creation is best-effort; commit and push already succeeded
        }

        // 6. Output
        if (f.json) {
          const out: Record<string, unknown> = {
            success: true,
            sha,
            short: sha.slice(0, 8),
          };
          if (prUrl) out.prUrl = prUrl;
          if (prNumber) out.prNumber = prNumber;
          console.log(JSON.stringify(out));
        } else {
          if (prNumber && prUrl) {
            console.log(`Shipped ${sha.slice(0, 8)} \u2192 PR #${prNumber}: ${prUrl}`);
          } else if (prNumber) {
            console.log(`Shipped ${sha.slice(0, 8)} \u2192 PR #${prNumber}`);
          } else {
            console.log(`Shipped ${sha.slice(0, 8)}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
