import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function secretCommand(app: DxBase) {
  return app
    .sub("secret")
    .meta({ description: "Secrets" })
    .command("get", (c) =>
      c.meta({ description: "Get secret" }).run(stubRun)
    )
    .command("list", (c) =>
      c.meta({ description: "List secrets" }).run(stubRun)
    );
}
