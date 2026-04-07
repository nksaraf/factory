import { spawnSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("self-update", [
  "$ dx self-update       Update the dx binary to the latest version",
]);

export function selfUpdateCommand(app: DxBase) {
  return app
    .sub("self-update")
    .meta({ description: "Update the dx CLI binary" })
    .run(({ flags }) => {
      const f = toDxFlags(flags);

      if (!f.quiet) console.log("  Updating dx...");

      // Use the same install mechanism as initial install
      const result = spawnSync("sh", ["-c", "curl -fsSL https://get.dx.rio.software | sh"], {
        stdio: "inherit",
      });

      if (result.status === 0) {
        if (!f.quiet) console.log("  ✓ dx updated successfully");
      } else {
        console.error("  ✗ Update failed. Try manually: curl -fsSL https://get.dx.rio.software | sh");
        process.exit(1);
      }
    });
}
