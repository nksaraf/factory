import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import {
  apiCall,
  tableOrJson,
  detailView,
  actionResult,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("artifact", [
  "$ dx artifact list                 List build artifacts",
  "$ dx artifact show <id>            Artifact details",
  "$ dx artifact create --image img   Register artifact",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getApi(): Promise<any> {
  return getFactoryClient();
}

export function artifactCommand(app: DxBase) {
  return app
    .sub("artifact")
    .meta({ description: "Build artifacts" })

    .command("list", (c) =>
      c
        .meta({ description: "List artifacts" })
        .flags({
          limit: {
            type: "number",
            alias: "n",
            description: "Limit results (default: 50)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build.artifacts.get({
              query: { limit: flags.limit as number | undefined },
            }),
          );
          tableOrJson(
            flags,
            result,
            ["ID", "Image", "Digest", "Created At"],
            (r) => [
              styleMuted(String(r.artifactId ?? r.id ?? "")),
              styleBold(String(r.imageRef ?? r.image ?? "")),
              styleMuted(String(r.digest ?? "")),
              timeAgo(r.createdAt as string),
            ],
            undefined,
            { emptyMessage: "No artifacts found." },
          );
        }),
    )

    .command("show", (c) =>
      c
        .meta({ description: "Show artifact details" })
        .args([
          {
            name: "id",
            type: "string",
            required: true,
            description: "Artifact ID",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build.artifacts[args.id].get(),
          );
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.artifactId ?? r.id ?? ""))],
            ["Image", (r) => styleBold(String(r.imageRef ?? r.image ?? ""))],
            ["Digest", (r) => String(r.digest ?? "")],
            ["Created At", (r) => timeAgo(r.createdAt as string)],
          ]);
        }),
    )

    .command("create", (c) =>
      c
        .meta({ description: "Create an artifact" })
        .flags({
          image: {
            type: "string",
            required: true,
            description: "Image reference",
          },
          digest: {
            type: "string",
            required: true,
            description: "Image digest (sha256)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build.artifacts.post({
              imageRef: flags.image as string,
              imageDigest: flags.digest as string,
            }),
          );
          actionResult(flags, result, styleSuccess("Artifact created."));
        }),
    )

    .command("link", (c) =>
      c
        .meta({ description: "Link an artifact to a module version component" })
        .flags({
          moduleVersion: {
            type: "string",
            required: true,
            description: "Module version ID",
          },
          component: {
            type: "string",
            required: true,
            description: "Component ID",
          },
          artifact: {
            type: "string",
            required: true,
            description: "Artifact ID",
          },
        })
        .run(async ({ flags }) => {
          const api = await getApi();
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build["component-artifacts"].post({
              moduleVersionId: flags.moduleVersion as string,
              componentId: flags.component as string,
              artifactId: flags.artifact as string,
            }),
          );
          actionResult(flags, result, styleSuccess("Artifact linked to component."));
        }),
    );
}
