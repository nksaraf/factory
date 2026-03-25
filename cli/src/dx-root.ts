import { Crust } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";

/** Shared root builder: inherit `json` / `verbose` / `debug` into every `.sub()` command. */
export function createDxBase() {
  return new Crust("dx")
    .meta({
      description:
        "Software Factory CLI — https://github.com/chenxin-yan/crust",
    })
    .flags({
      json: {
        type: "boolean",
        short: "j",
        description: "Structured JSON output (factory CLI standards)",
        inherit: true,
      },
      verbose: {
        type: "boolean",
        short: "v",
        description: "Verbose output",
        inherit: true,
      },
      debug: {
        type: "boolean",
        description: "Debug: HTTP / API traces",
        inherit: true,
      },
    })
    .use(helpPlugin());
}

export type DxBase = ReturnType<typeof createDxBase>;
