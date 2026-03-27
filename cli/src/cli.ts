import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { createDxApp } from "./build-app.js";
import { fireWorkbenchPing } from "./handlers/install/workbench-ping.js";

const app = createDxApp();
try {
  await app.execute();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(ExitCodes.GENERAL_FAILURE);
}

// Fire-and-forget workbench ping (non-blocking, no await)
fireWorkbenchPing();

process.exit(ExitCodes.SUCCESS);
