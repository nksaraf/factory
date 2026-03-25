import { createDxBase } from "./dx-root.js";
import { registerCommands } from "./register-commands.js";

export function createDxApp() {
  return registerCommands(createDxBase());
}
