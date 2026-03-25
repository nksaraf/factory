import type { DxBase } from "../dx-root.js";

import { stubRun } from "./stub-run.js";

export function tenantCommand(app: DxBase) {
  return app
    .sub("tenant")
    .meta({ description: "Tenants" })
    .command("assign", (c) =>
      c.meta({ description: "Assign tenant" }).run(stubRun)
    )
    .command("list", (c) =>
      c.meta({ description: "List tenants" }).run(stubRun)
    )
    .command("show", (c) =>
      c.meta({ description: "Show tenant" }).run(stubRun)
    );
}
