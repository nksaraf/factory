/**
 * Fire-and-forget workbench ping.
 *
 * Called after every `dx` command to report presence to the factory.
 * Never blocks, never throws, silently no-ops if not configured.
 */

import { readWorkbenchConfig } from "./workbench-identity.js";
import { getStoredBearerToken, resolveActiveProfile, getStoredBearerTokenForProfile } from "../../session-token.js";
import { readConfig } from "../../config.js";

const DX_VERSION = process.env.DX_VERSION ?? "0.0.0-dev";

/**
 * Walk up from cwd to find the workbench root (.dx/workbench.json).
 * Returns the root path or undefined if not found.
 */
function findWorkbenchRoot(): string | undefined {
  const path = require("node:path");
  const { existsSync } = require("node:fs");
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (existsSync(path.join(dir, ".dx", "workbench.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Fire a non-blocking ping to the factory.
 * Safe to call without await — errors are silently swallowed.
 */
export function fireWorkbenchPing(): void {
  // Intentionally not awaited — fire-and-forget
  void (async () => {
    try {
      const root = findWorkbenchRoot();
      if (!root) return;

      const config = readWorkbenchConfig(root);
      if (!config || !config.factoryRegistered || !config.factoryUrl) return;

      // Resolve auth token (profile or default)
      const profile = resolveActiveProfile();
      const token =
        profile === "default"
          ? await getStoredBearerToken()
          : await getStoredBearerTokenForProfile(profile);
      if (!token) return;

      const command = process.argv.slice(2).join(" ");
      const url = `${config.factoryUrl.replace(/\/$/, "")}/api/v1/factory/fleet/workbenches/${config.workbenchId}/ping`;

      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command,
          dxVersion: DX_VERSION,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {
      // Silently swallow all errors
    }
  })();
}
