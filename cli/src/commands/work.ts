import type { DxBase } from "../dx-root.js";

import { getFactoryRestClient } from "../client.js";
import { printKeyValue } from "../output.js";
import { styleBold, styleMuted, styleSuccess, styleError } from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("work", [
  "$ dx work start PROJ-123 --repo org/repo        Start god-workflow for a ticket",
  "$ dx work status PROJ-123                        Check workflow status for ticket",
  "$ dx work cancel PROJ-123                        Cancel workflow for ticket",
]);

export function workCommand(app: DxBase) {
  return app
    .sub("work")
    .meta({ description: "Work on Jira/Linear tickets (god-workflow)" })

    // ── dx work start <issue-key> ──
    .command("start", (c) =>
      c
        .meta({ description: "Start the god-workflow for a ticket" })
        .args([
          { name: "issueKey", type: "string", required: true, description: "Issue key (e.g. PROJ-123)" },
        ])
        .flags({
          repo: { type: "string", short: "r", description: "GitHub repo (org/repo)" },
          agent: { type: "string", short: "a", description: "Agent ID to use" },
          branch: { type: "string", short: "b", description: "Base branch (default: main)" },
          ttl: { type: "string", description: "Workspace TTL (default: 4h)" },
        })
        .run(async ({ args, flags }) => {
          const json = flags.json as boolean | undefined;
          const issueKey = args.issueKey as string;
          const repo = flags.repo as string | undefined;

          if (!repo) {
            console.error(styleError("--repo is required (e.g. --repo org/repo)"));
            process.exit(1);
          }

          const input: Record<string, unknown> = {
            issueKey,
            repoFullName: repo,
            baseBranch: (flags.branch as string) ?? "main",
            workspaceTtl: (flags.ttl as string) ?? "4h",
            agentId: (flags.agent as string) ?? "default",
            // Work tracker and git host config come from server-side provider settings
            workTracker: { type: "jira", apiUrl: "", credentialsRef: "" },
            gitHost: { type: "github", config: {} },
          };

          const client = await getFactoryRestClient();
          const res = await client.request<{ success: boolean; workflowRunId?: string; error?: string }>(
            "POST",
            "/api/v1/factory/workflow/runs",
            { workflowName: "god-workflow", input },
          );

          if (json) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }

          if (res.success) {
            console.log(styleSuccess(`God workflow started for ${issueKey}`));
            console.log(styleMuted(`Run ID: ${res.workflowRunId}`));
            console.log(styleMuted(`Track with: dx workflow status ${res.workflowRunId}`));
          } else {
            console.error(styleError(`Failed: ${res.error}`));
            process.exit(1);
          }
        }),
    )

    // ── dx work status <issue-key> ──
    .command("status", (c) =>
      c
        .meta({ description: "Check god-workflow status for a ticket" })
        .args([
          { name: "issueKey", type: "string", required: true, description: "Issue key (e.g. PROJ-123)" },
        ])
        .run(async ({ args, flags }) => {
          const json = flags.json as boolean | undefined;
          const client = await getFactoryRestClient();

          // Find most recent god-workflow run for this issue key
          const res = await client.request<{ data: any[] }>(
            "GET",
            "/api/v1/factory/workflow/runs?workflowName=god-workflow&limit=10",
          );

          const run = res.data.find(
            (r: any) => (r.input as any)?.issueKey === args.issueKey,
          );

          if (!run) {
            console.log(styleMuted(`No workflow run found for ${args.issueKey}`));
            return;
          }

          if (json) {
            console.log(JSON.stringify(run, null, 2));
            return;
          }

          console.log(printKeyValue({
            "Issue": args.issueKey as string,
            "Run ID": run.workflowRunId,
            "Status": run.status,
            "Phase": run.phase,
            "Branch": (run.state as any)?.branchName,
            "PR": (run.state as any)?.prUrl,
            "Preview": (run.state as any)?.previewUrl,
            "Started": new Date(run.createdAt).toLocaleString(),
          }));
        }),
    )

    // ── dx work cancel <issue-key> ──
    .command("cancel", (c) =>
      c
        .meta({ description: "Cancel god-workflow for a ticket" })
        .args([
          { name: "issueKey", type: "string", required: true, description: "Issue key (e.g. PROJ-123)" },
        ])
        .run(async ({ args, flags }) => {
          const json = flags.json as boolean | undefined;
          const client = await getFactoryRestClient();

          // Find the running workflow for this issue
          const res = await client.request<{ data: any[] }>(
            "GET",
            "/api/v1/factory/workflow/runs?workflowName=god-workflow&status=running",
          );

          const run = res.data.find(
            (r: any) => (r.input as any)?.issueKey === args.issueKey,
          );

          if (!run) {
            console.log(styleMuted(`No running workflow found for ${args.issueKey}`));
            return;
          }

          const cancelRes = await client.request<{ success: boolean; error?: string }>(
            "POST",
            `/api/v1/factory/workflow/runs/${run.workflowRunId}/cancel`,
          );

          if (json) {
            console.log(JSON.stringify(cancelRes, null, 2));
            return;
          }

          if (cancelRes.success) {
            console.log(styleSuccess(`Workflow ${run.workflowRunId} cancelled for ${args.issueKey}`));
          } else {
            console.error(styleError(`Failed: ${cancelRes.error}`));
            process.exit(1);
          }
        }),
    );
}
