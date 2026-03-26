import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("agent", [
  "$ dx agent list                    List agents",
  "$ dx agent run my-agent            Run an agent",
  "$ dx agent show my-agent           Show agent details",
]);

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
