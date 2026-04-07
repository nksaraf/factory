/**
 * Thin wrapper around the `skills` CLI (https://skills.sh).
 *
 * Uses the async Bun-shell API from subprocess.ts which passes
 * arguments as an array (safe from shell injection).
 */

import { exec, capture, type CaptureResult } from "../../lib/subprocess.js";

/** Run a skills CLI command with output streamed to the terminal (interactive). */
export async function runSkillsInteractive(
  args: string[],
): Promise<void> {
  await exec(["npx", "skills", ...args]);
}

/** Run a skills CLI command and capture output silently. */
export async function runSkillsCapture(
  args: string[],
): Promise<CaptureResult> {
  return capture(["npx", "skills", ...args]);
}
