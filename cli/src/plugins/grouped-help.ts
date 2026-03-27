/**
 * Grouped help plugin — replaces helpPlugin() with category-based layout at root level.
 * Subcommand help delegates to renderHelp() from @crustjs/plugins.
 */
import type { CommandNode, CrustPlugin, FlagDef } from "@crustjs/core";
import { renderHelp } from "@crustjs/plugins";
import { bold, cyan, dim } from "@crustjs/style";

import { examplesFor } from "./examples-plugin.js";

// ---------------------------------------------------------------------------
// Category map: category name → ordered list of command names
// ---------------------------------------------------------------------------

const CATEGORIES: [category: string, commands: string[]][] = [
  [
    "Getting Started",
    ["status", "catalog", "auth", "config", "whoami", "init", "factory"],
  ],
  [
    "Development",
    ["dev", "build", "test", "logs", "trace", "metrics"],
  ],
  [
    "Source Control",
    ["commit", "branch", "pr", "push", "ship", "worktree", "git"],
  ],
  [
    "Platform",
    [
      "customer", "tenant", "module", "entitlement", "plan",
      "site", "domain", "route", "release", "deploy",
    ],
  ],
  [
    "Infrastructure",
    [
      "sandbox", "infra", "kube", "db", "env", "secret",
      "tunnel", "connect",
    ],
  ],
  [
    "Workflow",
    [
      "work", "agent", "alert", "artifact", "ops", "pkg", "install",
    ],
  ],
];

const MAX_SUBS_SHOWN = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subPreview(cmd: CommandNode): string {
  const names = Object.keys(cmd.subCommands);
  if (names.length === 0) return "";
  if (names.length <= MAX_SUBS_SHOWN) return names.join(" ");
  return names.slice(0, MAX_SUBS_SHOWN - 1).join(" ") + " ...";
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function renderGroupedHelp(root: CommandNode): string {
  const lines: string[] = [];

  lines.push(root.meta.description ?? "");
  lines.push("");
  lines.push(bold(cyan("Usage:")) + "  dx <command> [options]");

  // Measure column widths
  const CMD_COL = 14;
  const SUB_COL = 24;

  for (const [category, commandNames] of CATEGORIES) {
    lines.push("");
    lines.push(bold(cyan(`${category}:`)));

    for (const name of commandNames) {
      const cmd = root.subCommands[name];
      if (!cmd) continue;

      const subs = subPreview(cmd);
      const desc = cmd.meta.description ?? "";
      const subsFormatted = subs ? dim(pad(subs, SUB_COL)) : pad("", SUB_COL);

      lines.push(`  ${cyan(pad(name, CMD_COL))}${subsFormatted}${desc}`);
    }
  }

  // Global options
  lines.push("");
  lines.push(bold(cyan("Global Options:")));

  const flags = root.effectiveFlags;
  const flagEntries: [string, string, string][] = [];
  for (const [name, def] of Object.entries(flags)) {
    const short = (def as FlagDef & { short?: string }).short;
    const left = short ? `-${short}, --${name}` : `    --${name}`;
    const desc = (def as FlagDef).description ?? "";
    flagEntries.push([left, desc, ""]);
  }
  const maxFlag = Math.max(...flagEntries.map(([l]) => l.length));
  for (const [left, desc] of flagEntries) {
    lines.push(`  ${cyan(pad(left, maxFlag + 2))}${desc}`);
  }

  lines.push("");
  lines.push(
    dim("Run 'dx <command> --help' for details on a specific command.")
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const helpFlagDef: FlagDef = {
  type: "boolean",
  short: "h",
  description: "Show help",
};

function addHelpFlagRecursive(
  cmd: CommandNode,
  addFlag: (cmd: CommandNode, name: string, def: FlagDef) => void
): void {
  addFlag(cmd, "help", helpFlagDef);
  for (const sub of Object.values(cmd.subCommands)) {
    addHelpFlagRecursive(sub, addFlag);
  }
}

export function groupedHelpPlugin(): CrustPlugin {
  return {
    name: "grouped-help",

    setup(ctx, actions) {
      addHelpFlagRecursive(ctx.rootCommand, actions.addFlag);
    },

    async middleware(ctx, next) {
      if (!ctx.route) {
        await next();
        return;
      }

      const cmd = ctx.route.command;
      const helpRequested = ctx.input?.flags.help === true;

      // If help not requested and the command has a handler, proceed normally
      if (!helpRequested && cmd.run) {
        await next();
        return;
      }

      // If no help requested and no handler, fall through to show help
      // (e.g. `dx customer` with no subcommand specified)

      // Root help → grouped layout
      if (cmd === ctx.rootCommand) {
        console.log(renderGroupedHelp(cmd));
        return;
      }

      // Subcommand help → standard renderHelp + examples
      let output = renderHelp(cmd, [...ctx.route.commandPath]);
      const pathKey = ctx.route.commandPath.filter(s => s !== "dx").join(" ");
      const examples = examplesFor(pathKey);
      if (examples.length > 0) {
        output += "\n\n" + bold(cyan("EXAMPLES:"));
        for (const ex of examples) {
          output += "\n  " + ex;
        }
      }
      console.log(output);
    },
  };
}
