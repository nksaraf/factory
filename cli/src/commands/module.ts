import type { DxBase } from "../dx-root.js"

import { getFactoryClient } from "../client.js"
import {
  apiCall,
  tableOrJson,
  actionResult,
  styleBold,
  styleMuted,
  styleSuccess,
  timeAgo,
} from "./list-helpers.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("module", [
  "$ dx module list                   List all modules",
  "$ dx module show core-api          Show module details",
  "$ dx module version list core-api  List module versions",
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getApi(): Promise<any> {
  return getFactoryClient()
}

export function moduleCommand(app: DxBase) {
  return app
    .sub("module")
    .meta({ description: "Modules" })

    .command("list", (c) =>
      c
        .meta({ description: "List modules" })
        .flags({
          limit: {
            type: "number",
            alias: "n",
            description: "Limit results (default: 50)",
          },
        })
        .run(async ({ flags }) => {
          const api = await getApi()
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build.modules.get({
              query: { limit: flags.limit as number | undefined },
            })
          )
          tableOrJson(
            flags,
            result,
            ["ID", "Name", "Kind", "Created At"],
            (r) => [
              styleMuted(String(r.moduleId ?? r.id ?? "")),
              styleBold(String(r.name ?? "")),
              String(r.kind ?? ""),
              timeAgo(r.createdAt as string),
            ],
            undefined,
            { emptyMessage: "No modules found." }
          )
        })
    )

    .command("show", (c) =>
      c
        .meta({ description: "Show module" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Module name",
          },
        ])
        .run(async ({ args, flags }) => {
          const api = await getApi()
          const result = await apiCall(flags, () =>
            api.api.v1.factory.build.modules[args.name].get()
          )
          const { detailView } = await import("./list-helpers.js")
          detailView(flags, result, [
            ["ID", (r) => styleMuted(String(r.moduleId ?? r.id ?? ""))],
            ["Name", (r) => styleBold(String(r.name ?? ""))],
            ["Kind", (r) => String(r.kind ?? "")],
            ["Created At", (r) => timeAgo(r.createdAt as string)],
          ])
        })
    )

    .command("version", (c) =>
      c
        .meta({ description: "Manage module versions" })

        .command("list", (sc) =>
          sc
            .meta({ description: "List versions for a module" })
            .args([
              {
                name: "name",
                type: "string",
                required: true,
                description: "Module name",
              },
            ])
            .run(async ({ args, flags }) => {
              const api = await getApi()
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build.modules[args.name].versions.get()
              )
              tableOrJson(
                flags,
                result,
                ["ID", "Version", "Status", "Created At"],
                (r) => [
                  styleMuted(String(r.moduleVersionId ?? r.id ?? "")),
                  styleBold(String(r.version ?? "")),
                  String(r.status ?? ""),
                  timeAgo(r.createdAt as string),
                ],
                undefined,
                { emptyMessage: `No versions found for module "${args.name}".` }
              )
            })
        )

        .command("create", (sc) =>
          sc
            .meta({ description: "Create a module version" })
            .args([
              {
                name: "name",
                type: "string",
                required: true,
                description: "Module name",
              },
              {
                name: "version",
                type: "string",
                required: true,
                description: "Version string (e.g. 1.0.0)",
              },
            ])
            .run(async ({ args, flags }) => {
              const api = await getApi()
              const result = await apiCall(flags, () =>
                api.api.v1.factory.build.modules[args.name].versions.post({
                  version: args.version,
                })
              )
              actionResult(
                flags,
                result,
                styleSuccess(
                  `Version "${args.version}" created for module "${args.name}".`
                )
              )
            })
        )
    )
}
