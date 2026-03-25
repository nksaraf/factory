import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function opsCommand(app: DxBase) {
  return app
    .sub("ops")
    .meta({ description: "Operations" })
    .command("restart", (c) =>
      c.meta({ description: "Restart services" }).run(stubRun)
    )
    .command("scale", (c) =>
      c.meta({ description: "Scale services" }).run(stubRun)
    );
}
