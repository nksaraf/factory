import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import {
  apiCall,
  tableOrJson,
  detailView,
  actionResult,
  colorStatus,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("deploy", [
  "$ dx deploy list                   List deployments",
  "$ dx deploy create --release <id>  Create deployment",
  "$ dx deploy status <id>            Check deployment status",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFleetApi(): Promise<any> {
  return getFactoryClient();
}

export function deployCommand(app: DxBase) {
  return app
    .sub("deploy")
    .meta({ description: "Deploy releases to targets" })

    .command("create", (c) =>
      c
        .meta({ description: "Create a deployment rollout" })
        .args([
          {
            name: "release-id",
            type: "string",
            required: true,
            description: "Release ID",
          },
        ])
        .flags({
          target: {
            type: "string",
            short: "t",
            required: true,
            description: "Deployment target ID",
          },
        })
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.rollouts.post({
              releaseId: args["release-id"],
              systemDeploymentId: flags.target as string,
            })
          );
          actionResult(flags, result, styleSuccess(`Rollout created for release ${args["release-id"]}.`));
        })
    )

    .command("status", (c) =>
      c
        .meta({ description: "Get rollout status" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Rollout ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.rollouts({ id: args.id }).get()
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.rolloutId ?? ""))],
            ["Release", (r) => styleBold(String(r.releaseId ?? ""))],
            ["Target", (r) => String(r.systemDeploymentId ?? "")],
            ["Status", (r) => colorStatus(String(r.status ?? ""))],
            ["Started", (r) => timeAgo(r.startedAt as string)],
            ["Completed", (r) => r.completedAt ? timeAgo(r.completedAt as string) : "-"],
          ]);
        })
    )

    .command("list", (c) =>
      c
        .meta({ description: "List rollouts" })
        .flags({
          status: { type: "string", alias: "s", description: "Filter by status" },
          limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
        })
        .run(async ({ flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.rollouts.get()
          );
          tableOrJson(
            flags,
            result,
            ["ID", "Release", "Target", "Status", "Started", "Completed"],
            (r) => [
              styleMuted(String(r.rolloutId ?? "")),
              styleBold(String(r.releaseId ?? "")),
              String(r.systemDeploymentId ?? ""),
              colorStatus(String(r.status ?? "")),
              timeAgo(r.startedAt as string),
              r.completedAt ? timeAgo(r.completedAt as string) : styleMuted("-"),
            ],
            undefined,
            { emptyMessage: "No rollouts found." },
          );
        })
    );
}
