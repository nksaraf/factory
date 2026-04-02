import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { shutdownTelemetry, startSpan } from "./telemetry.js";
import { createDxApp } from "./build-app.js";
import { fireWorkbenchPing } from "./handlers/install/workbench-ping.js";

// --version (long-only, -v stays for --verbose)
if (process.argv.includes("--version")) {
  console.log("dx v0.0.2");
  process.exit(ExitCodes.SUCCESS);
}

// Rewrite `dx help [cmd...]` → `dx [cmd...] --help`
const args = process.argv.slice(2);
if (args[0] === "help") {
  const rest = args.slice(1);
  process.argv = [process.argv[0], process.argv[1], ...rest, "--help"];
}

const app = createDxApp();
const commandName = args.filter((a) => !a.startsWith("-")).join(" ") || "dx";
const rootSpan = startSpan(`dx ${commandName}`);
let exitCode = ExitCodes.SUCCESS;
try {
  await app.execute();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const isJson =
    process.argv.includes("--json") || process.argv.includes("-j");

  if (isJson) {
    console.log(
      JSON.stringify({
        success: false,
        error: { message },
        exitCode: ExitCodes.GENERAL_FAILURE,
      })
    );
  } else {
    console.error(message);
  }
  exitCode = ExitCodes.GENERAL_FAILURE;
  rootSpan.recordException(err instanceof Error ? err : new Error(String(err)));
} finally {
  rootSpan.end();
  await shutdownTelemetry();
}

// Fire-and-forget workbench ping (non-blocking, no await)
fireWorkbenchPing();

process.exit(exitCode);
