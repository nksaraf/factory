import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function moduleCommand(app: DxBase) {
  return app
    .sub("module")
    .meta({ description: "Modules" })
    .command("list", (c) =>
      c.meta({ description: "List modules" }).run(stubRun)
    )
    .command("show", (c) =>
      c.meta({ description: "Show module" }).run(stubRun)
    );
}
