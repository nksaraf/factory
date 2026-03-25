import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { createDxApp } from "./build-app.js";

const app = createDxApp();
try {
  await app.execute();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(ExitCodes.GENERAL_FAILURE);
}
process.exit(ExitCodes.SUCCESS);
