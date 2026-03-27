import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("work", [
  "$ dx work list                     List work items",
  '$ dx work create "Fix login bug"   Create work item',
  "$ dx work start <id>               Start working on item",
  "$ dx work done <id>                Mark item complete",
]);

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
