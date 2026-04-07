#!/usr/bin/env bun
/**
 * Smoke-test every registered CLI command by running `dx <cmd> --help`.
 *
 * Usage:
 *   bun run scripts/cli-smoke-test.ts
 *   bun run scripts/cli-smoke-test.ts --compare snapshots/v1-cli-commands.txt
 *
 * Reports:
 *   - Commands that fail to load (non-zero exit from --help)
 *   - Commands missing compared to a baseline snapshot (if --compare given)
 *
 * Uses Bun.spawnSync (no shell injection risk — arguments are passed as array).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const compareIdx = process.argv.indexOf("--compare");
const comparePath = compareIdx !== -1 ? process.argv[compareIdx + 1] : null;

// Extract command names from register-commands.ts
const registerPath = resolve(import.meta.dir, "../cli/src/register-commands.ts");
const registerSource = readFileSync(registerPath, "utf-8");

const commandNames: string[] = [];
const importRegex = /import\s+\{\s*(\w+)Command\s*\}\s+from\s+"\.\/commands\/(\w[\w-]*)\.js"/g;
let match;
while ((match = importRegex.exec(registerSource)) !== null) {
  commandNames.push(match[2]); // Use the filename as command name
}

commandNames.sort();

console.log(`Found ${commandNames.length} registered commands\n`);

// Run dx <cmd> --help for each (using Bun.spawnSync — safe, no shell)
const passed: string[] = [];
const failed: string[] = [];

for (const cmd of commandNames) {
  try {
    const proc = Bun.spawnSync(["dx", cmd, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });

    if (proc.exitCode === 0) {
      passed.push(cmd);
    } else {
      const stderr = proc.stderr.toString().trim();
      failed.push(`${cmd}: exit ${proc.exitCode}${stderr ? ` — ${stderr.slice(0, 100)}` : ""}`);
    }
  } catch (err: any) {
    failed.push(`${cmd}: ${err.message?.slice(0, 100) ?? "unknown error"}`);
  }
}

// Report
console.log("=== CLI Smoke Test ===\n");

console.log(`PASSED: ${passed.length}/${commandNames.length}`);

if (failed.length > 0) {
  console.log(`\nFAILED: ${failed.length}`);
  for (const f of failed) {
    console.log(`  - ${f}`);
  }
}

// Compare against baseline if provided
if (comparePath) {
  console.log();
  if (!existsSync(comparePath)) {
    console.error(`Baseline file not found: ${comparePath}`);
  } else {
    const baseline = readFileSync(comparePath, "utf-8");
    const baselineCommands = new Set<string>();
    for (const line of baseline.split("\n")) {
      const m = line.match(/^(?:dx\s+)?(\w[\w-]*)\s/);
      if (m && m[1] !== "dx" && m[1] !== "Usage") {
        baselineCommands.add(m[1]);
      }
    }

    const currentSet = new Set(commandNames);
    const missing = [...baselineCommands].filter((c) => !currentSet.has(c)).sort();
    const added = commandNames.filter((c) => !baselineCommands.has(c)).sort();

    if (missing.length > 0) {
      console.log(`MISSING vs baseline: ${missing.length}`);
      for (const m of missing) {
        console.log(`  - ${m}`);
      }
    }

    if (added.length > 0) {
      console.log(`NEW vs baseline: ${added.length}`);
      for (const a of added) {
        console.log(`  + ${a}`);
      }
    }

    if (missing.length === 0 && added.length === 0) {
      console.log("Command list matches baseline exactly.");
    }
  }
}

console.log();
if (failed.length > 0) {
  process.exit(1);
}
