import type { DxFlags } from "../stub.js";

/** Normalize Crust-parsed flags for dx handlers (global flags + command-specific). */
export function toDxFlags(
  flags: Record<string, unknown>
): DxFlags & Record<string, unknown> {
  return {
    ...flags,
    json: flags.json as boolean | undefined,
    verbose: flags.verbose as boolean | undefined,
    quiet: flags.quiet as boolean | undefined,
    debug: flags.debug as boolean | undefined,
  };
}
