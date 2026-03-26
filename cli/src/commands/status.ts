import type { DxBase } from "../dx-root.js";
import { runContextStatus } from "../handlers/context-status.js";

import { toDxFlags } from "./dx-flags.js";

export function statusCommand(app: DxBase) {
  return app
    .sub("status")
    .meta({ description: "Status of the current context" })
    .run(async ({ flags }) => {
      await runContextStatus(toDxFlags(flags));
    });
}
