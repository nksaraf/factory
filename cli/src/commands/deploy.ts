import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";

function jsonOut(flags: Record<string, unknown>, data: unknown) {
  const f = toDxFlags(flags);
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function apiCall(
  flags: Record<string, unknown>,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<unknown> {
  const f = toDxFlags(flags);
  try {
    const res = await fn();
    if (res.error) {
      exitWithError(f, `API error: ${JSON.stringify(res.error)}`);
    }
    return res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithError(f, msg);
  }
}

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
              deploymentTargetId: flags.target as string,
            })
          );
          jsonOut(flags, result);
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
          jsonOut(flags, result);
        })
    )

    .command("list", (c) =>
      c
        .meta({ description: "List rollouts" })
        .run(async ({ flags }) => {
          const api = await getFleetApi();
          const result = await apiCall(flags, () =>
            api.api.v1.fleet.rollouts.get()
          );
          jsonOut(flags, result);
        })
    );
}
