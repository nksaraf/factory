import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("secret", [
  "$ dx secret list                   List secrets",
  "$ dx secret get DB_PASSWORD        Get a secret value",
]);

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
