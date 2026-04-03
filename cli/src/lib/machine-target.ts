// cli/src/lib/machine-target.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

import { resolveMachine, type MachineTarget } from "../handlers/docker-remote.js";

export type { MachineTarget } from "../handlers/docker-remote.js";
export { resolveMachine } from "../handlers/docker-remote.js";

/**
 * Expand a --on target expression into a list of resolved machines.
 *
 * Supported formats:
 * - "staging-1"                    → single machine
 * - "staging-1,staging-2,prod-1"  → comma-separated
 * - "tag:webservers"              → machines with matching tag
 * - "@inventory:webservers"       → group from .dx/inventory.yml
 */
export async function expandTargets(onExpr: string): Promise<MachineTarget[]> {
  // Tag-based
  if (onExpr.startsWith("tag:")) {
    const tag = onExpr.slice(4);
    return resolveByTag(tag);
  }

  // Inventory-based
  if (onExpr.startsWith("@inventory:")) {
    const group = onExpr.slice(11);
    return resolveByInventoryGroup(group);
  }

  // Comma-separated or single
  const slugs = onExpr.split(",").map((s) => s.trim()).filter(Boolean);
  const targets: MachineTarget[] = [];
  for (const slug of slugs) {
    targets.push(await resolveMachine(slug));
  }
  return targets;
}

// ─── Tag resolution ───────────────────────────────────────────

interface LocalMachineEntry {
  host: string;
  user?: string;
  port?: number;
  kind?: string;
  tags?: string[];
}

function resolveByTag(tag: string): Promise<MachineTarget[]> {
  const machinesPath = resolve(homedir(), ".config", "dx", "machines.json");
  const targets: MachineTarget[] = [];

  if (existsSync(machinesPath)) {
    try {
      const machines: Record<string, LocalMachineEntry> = JSON.parse(
        readFileSync(machinesPath, "utf-8")
      );
      for (const [slug, entry] of Object.entries(machines)) {
        if (entry.tags?.includes(tag)) {
          const port = entry.port ?? 22;
          const user = entry.user ?? "root";
          const dockerHost = port !== 22
            ? `ssh://${user}@${entry.host}:${port}`
            : `ssh://${user}@${entry.host}`;
          targets.push({
            name: slug,
            kind: entry.kind ?? "local-config",
            host: entry.host,
            port,
            user,
            dockerHost,
            source: "local",
          });
        }
      }
    } catch { /* ignore */ }
  }

  // TODO: Also query Factory API for hosts/VMs with matching labels

  if (targets.length === 0) {
    throw new Error(
      `No machines found with tag "${tag}".\n` +
      `  Add tags: dx docker add <name> --host <ip> --tag ${tag}`
    );
  }

  return Promise.resolve(targets);
}

// ─── Inventory resolution ─────────────────────────────────────

async function resolveByInventoryGroup(group: string): Promise<MachineTarget[]> {
  const inventoryPath = resolve(process.cwd(), ".dx", "inventory.yml");
  if (!existsSync(inventoryPath)) {
    throw new Error(
      `Inventory file not found: .dx/inventory.yml\n` +
      `  Create it with groups of machine slugs.`
    );
  }

  const content = readFileSync(inventoryPath, "utf-8");
  const doc = parseYaml(content);

  if (!doc?.groups?.[group]) {
    const available = doc?.groups ? Object.keys(doc.groups).join(", ") : "none";
    throw new Error(
      `Inventory group "${group}" not found.\n` +
      `  Available groups: ${available}`
    );
  }

  const slugs: string[] = doc.groups[group];
  const targets: MachineTarget[] = [];
  for (const slug of slugs) {
    targets.push(await resolveMachine(slug));
  }
  return targets;
}
