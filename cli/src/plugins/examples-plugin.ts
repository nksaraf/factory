/**
 * Examples registry for CLI commands.
 * Stores examples keyed by command path (e.g. "customer", "customer list").
 * The grouped-help plugin reads these when rendering subcommand help.
 */
import type { CommandNode } from "@crustjs/core"

const store = new Map<string, string[]>()

/** Register examples for a command path. */
export function setExamples(path: string, examples: string[]): void {
  store.set(path, examples)
}

/** Retrieve registered examples by command path. */
export function examplesFor(
  pathOrNode: string | CommandNode,
  commandPath?: string[]
): string[] {
  if (typeof pathOrNode === "string") {
    return store.get(pathOrNode) ?? []
  }
  // When called with a CommandNode + path array, join the path (skip "dx" prefix)
  const key = (commandPath ?? []).filter((s) => s !== "dx").join(" ")
  return store.get(key) ?? []
}
