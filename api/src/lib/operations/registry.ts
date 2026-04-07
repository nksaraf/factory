/**
 * Operations Registry — global registry of all background operation runners.
 *
 * Used by the system API controller to enumerate, query, and trigger operations.
 */

import type { OperationRunner } from "./runner";

const registry = new Map<string, OperationRunner>();

export function registerRunner(runner: OperationRunner): void {
  if (registry.has(runner.name)) {
    throw new Error(`Operation runner "${runner.name}" is already registered`);
  }
  registry.set(runner.name, runner);
}

export function getRunner(name: string): OperationRunner | undefined {
  return registry.get(name);
}

export function allRunners(): OperationRunner[] {
  return Array.from(registry.values());
}

export function stopAll(): void {
  for (const runner of registry.values()) {
    runner.stop();
  }
  registry.clear();
}
