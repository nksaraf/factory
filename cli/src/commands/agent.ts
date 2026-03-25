import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function agentCommand(app: DxBase) {
  return app
    .sub("agent")
    .meta({ description: "Agent operations" })
    .command("list", (c) =>
      c.meta({ description: "List agents" }).run(stubRun)
    )
    .command("run", (c) =>
      c.meta({ description: "Run an agent" }).run(stubRun)
    )
    .command("show", (c) =>
      c.meta({ description: "Show agent details" }).run(stubRun)
    );
}
