import type { DxBase } from "../dx-root.js";
import { runContextStatus } from "../handlers/context-status.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("status", [
  "$ dx status              Check API and git status",
  "$ dx status --json       Machine-readable status",
]);

export function statusCommand(app: DxBase) {
  return app
    .sub("status")
    .meta({ description: "Status of the current context" })
    .run(async ({ flags }) => {
      await runContextStatus(toDxFlags(flags));
    });
}
