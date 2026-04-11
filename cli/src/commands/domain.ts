import type { DxBase } from "../dx-root.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { stubRun } from "./stub-run.js"

setExamples("domain", [
  "$ dx domain list                   List DNS domains",
  "$ dx domain show example.com       Show domain details",
])

export function domainCommand(app: DxBase) {
  return app
    .sub("domain")
    .meta({ description: "DNS domains and public hostnames" })
    .command("list", (c) =>
      c.meta({ description: "List domains" }).run(stubRun)
    )
    .command("show", (c) =>
      c
        .meta({ description: "Show domain" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Domain name",
          },
        ])
        .run(stubRun)
    )
}
