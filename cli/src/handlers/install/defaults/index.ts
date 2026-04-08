import type { InstallRole } from "@smp/factory-shared/install-types";
import type { ConfigChange, ConfigProvider, DefaultsScanResult, ApplyResult } from "./types.js";
import { backupFile } from "./backup.js";

import { gitDefaultsProvider } from "./git-defaults.js";
import { npmDefaultsProvider } from "./npm-defaults.js";
import { curlDefaultsProvider } from "./curl-defaults.js";
import { psqlDefaultsProvider } from "./psql-defaults.js";
import { dockerDefaultsProvider } from "./docker-defaults.js";
import { sshDefaultsProvider } from "./ssh-defaults.js";
import { systemDefaultsProvider } from "./system-defaults.js";
import { shellDefaultsProvider } from "./shell-defaults.js";
import { ideHooksDefaultsProvider } from "./ide-hooks-defaults.js";

const ALL_PROVIDERS: ConfigProvider[] = [
  gitDefaultsProvider,
  npmDefaultsProvider,
  curlDefaultsProvider,
  psqlDefaultsProvider,
  dockerDefaultsProvider,
  sshDefaultsProvider,
  systemDefaultsProvider,
  shellDefaultsProvider,
  ideHooksDefaultsProvider,
];

/**
 * Scan all providers and collect proposed changes.
 * Filters by current platform and specified role automatically.
 */
export async function collectDefaults(role: InstallRole): Promise<DefaultsScanResult> {
  const platform = process.platform;
  const allChanges: ConfigChange[] = [];

  for (const provider of ALL_PROVIDERS) {
    // Skip providers that don't apply to this role
    if (!provider.roles.includes(role)) continue;

    const changes = await provider.detect();
    // Filter by platform
    const applicable = changes.filter((c) => c.platform === null || c.platform === platform);
    allChanges.push(...applicable);
  }

  return {
    all: allChanges,
    pending: allChanges.filter((c) => !c.alreadyApplied),
    applied: allChanges.filter((c) => c.alreadyApplied),
  };
}

/**
 * Apply a set of changes, backing up originals first.
 * Groups file-based changes to minimize backup/write operations.
 *
 * IMPORTANT: Changes are applied sequentially, not in parallel.
 * Some providers (e.g. docker) emit multiple changes that read-modify-write
 * the same file; parallel application would cause data loss.
 */
export async function applyDefaults(changes: ConfigChange[]): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const backedUpFiles = new Set<string>();

  // Separate sudo and non-sudo changes
  const nonSudo = changes.filter((c) => !c.requiresSudo);
  const sudo = changes.filter((c) => c.requiresSudo);

  // Apply non-sudo changes first
  for (const change of nonSudo) {
    if (change.alreadyApplied) {
      skipped.push(change.id);
      continue;
    }

    // Backup target file once per file
    if (!backedUpFiles.has(change.target)) {
      const backed = backupFile(change.target);
      if (backed) backedUpFiles.add(change.target);
    }

    const ok = await change.apply();
    if (ok) {
      applied.push(change.id);
    } else {
      failed.push(change.id);
    }
  }

  // Apply sudo changes together
  if (sudo.length > 0) {
    for (const change of sudo) {
      if (change.alreadyApplied) {
        skipped.push(change.id);
        continue;
      }

      if (!backedUpFiles.has(change.target)) {
        const backed = backupFile(change.target);
        if (backed) backedUpFiles.add(change.target);
      }

      const ok = await change.apply();
      if (ok) {
        applied.push(change.id);
      } else {
        failed.push(change.id);
      }
    }
  }

  return { applied, failed, skipped, backedUp: [...backedUpFiles] };
}
