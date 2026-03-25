import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function workCommand(app: DxBase) {
  return app
    .sub("work")
    .meta({ description: "Work items" })
    .command("create", (c) =>
      c.meta({ description: "Create work item" }).run(stubRun)
    )
    .command("done", (c) =>
      c.meta({ description: "Mark work done" }).run(stubRun)
    )
    .command("list", (c) =>
      c.meta({ description: "List work items" }).run(stubRun)
    )
    .command("start", (c) =>
      c.meta({ description: "Start work item" }).run(stubRun)
    );
}
