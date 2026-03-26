import type { DxBase } from "../dx-root.js";

import { toDxFlags } from "./dx-flags.js";

export function factoryCommand(app: DxBase) {
  return app
    .sub("factory")
    .meta({ description: "Factory platform operations" })

    // ── status ──
    .command("status", (c) =>
      c
        .meta({ description: "Factory API health, repo, and PR status" })
        .run(async ({ flags }) => {
          const { runFactoryStatus } = await import(
            "../handlers/factory-status.js"
          );
          await runFactoryStatus(toDxFlags(flags));
        })
    );
}
