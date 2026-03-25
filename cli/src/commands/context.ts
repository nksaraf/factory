import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function contextCommand(app: DxBase) {
  return app
    .sub("context")
    .meta({ description: "CLI context" })
    .command("list", (c) =>
      c.meta({ description: "List contexts" }).run(stubRun)
    )
    .command("show", (c) =>
      c.meta({ description: "Show context" }).run(stubRun)
    )
    .command("use", (c) =>
      c.meta({ description: "Select context" }).run(stubRun)
    );
}
