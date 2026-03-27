import type { DxBase } from "../dx-root.js";
import { toDxFlags } from "./dx-flags.js";

export function doctorCommand(app: DxBase) {
  return app
    .sub("doctor")
    .meta({ description: "Check workbench health: toolchain, auth, registration" })
    .flags({
      category: {
        type: "string",
        description: "Run a specific check category: toolchain, auth, workbench, workspace",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const { runDoctor } = await import("../handlers/doctor.js");
      await runDoctor({
        category: flags.category as string | undefined,
        json: f.json,
        verbose: f.verbose,
      });
    });
}
