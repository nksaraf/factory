import type { DxBase } from "../dx-root.js";
import { runStatus } from "../handlers/status.js";

import { toDxFlags } from "./dx-flags.js";

export function statusCommand(app: DxBase) {
  return app
    .sub("status")
    .meta({ description: "Deployment and service status" })
    .run(async ({ flags }) => {
      await runStatus(toDxFlags(flags));
    });
}
