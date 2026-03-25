import { emitStub, type DxFlags } from "../stub.js";

import { toDxFlags } from "./dx-flags.js";

/** NYI handler for Crust `.run()` — keeps JSON / exit-code behavior. */
export function stubRun(ctx: { flags: Record<string, unknown> }): void {
  const f = toDxFlags(ctx.flags) as DxFlags;
  emitStub(f);
}
