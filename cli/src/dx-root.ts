import { Crust } from "@crustjs/core"
import { errorHandlerPlugin } from "./plugins/error-handler.js"
import { groupedHelpPlugin } from "./plugins/grouped-help.js"

/** Shared root builder: inherit `json` / `verbose` / `debug` into every `.sub()` command. */
export function createDxBase() {
  return new Crust("dx")
    .meta({
      description: "Software Factory CLI",
    })
    .flags({
      json: {
        type: "boolean",
        short: "j",
        description: "Structured JSON output",
        inherit: true,
      },
      verbose: {
        type: "boolean",
        short: "v",
        description: "Verbose output",
        inherit: true,
      },
      quiet: {
        type: "boolean",
        short: "q",
        description: "Suppress non-essential output",
        inherit: true,
      },
      debug: {
        type: "boolean",
        description: "HTTP / API traces",
        inherit: true,
      },
    })
    .use(groupedHelpPlugin())
    .use(errorHandlerPlugin())
}

export type DxBase = ReturnType<typeof createDxBase>
