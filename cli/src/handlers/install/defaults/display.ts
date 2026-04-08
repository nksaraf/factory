import { styleSuccess, styleMuted, styleWarn, styleBold } from "../../../cli-style.js";
import type { Category, ConfigChange, DefaultsScanResult, ApplyResult } from "./types.js";

const CATEGORY_LABELS: Record<Category, string> = {
  git: "Git",
  npm: "npm (~/.npmrc)",
  curl: "curl (~/.curlrc)",
  psql: "psql (~/.psqlrc)",
  docker: "Docker daemon",
  ssh: "SSH (~/.ssh/config)",
  system: "System limits",
  shell: "Shell",
  "ide-hooks": "IDE hooks (Claude Code + Cursor)",
};

/** Display a scan result — what will be changed. */
export function displayScan(scan: DefaultsScanResult): void {
  if (scan.all.length === 0) return;

  const grouped = groupByCategory(scan.all);

  for (const [category, changes] of grouped) {
    const pending = changes.filter((c) => !c.alreadyApplied);
    const applied = changes.filter((c) => c.alreadyApplied);
    const label = CATEGORY_LABELS[category] ?? category;

    if (pending.length === 0) {
      console.log(`  ${styleSuccess("✓")} ${label}: ${styleMuted(`${applied.length} configured`)}`);
      continue;
    }

    const sudoNote = pending.some((c) => c.requiresSudo) ? styleMuted(" (requires sudo)") : "";
    console.log(`  ${styleWarn("●")} ${styleBold(label)} — ${pending.length} to apply${sudoNote}`);

    for (const change of changes) {
      if (change.alreadyApplied) {
        console.log(`    ${styleMuted(`✓ ${change.description}`)}`);
      } else if (change.currentValue !== null) {
        console.log(`    ${styleWarn("~")} ${change.description} ${styleMuted(`(was: ${change.currentValue})`)}`);
      } else {
        console.log(`    ${styleSuccess("+")} ${change.description}`);
      }
    }
  }
}

/** Display results after applying defaults. */
export function displayApplyResult(result: ApplyResult): void {
  const parts: string[] = [];
  if (result.applied.length > 0) parts.push(`${result.applied.length} applied`);
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} already set`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  if (result.backedUp.length > 0) parts.push(`${result.backedUp.length} files backed up`);

  if (result.failed.length > 0) {
    console.log(`  ${styleWarn("⚠")} Defaults: ${parts.join(", ")}`);
  } else {
    console.log(`  ${styleSuccess("✓")} Defaults: ${parts.join(", ")}`);
  }
}

/** Display a compact summary for --check mode. */
export function displayCheckSummary(scan: DefaultsScanResult): void {
  const grouped = groupByCategory(scan.all);

  for (const [category, changes] of grouped) {
    const pending = changes.filter((c) => !c.alreadyApplied);
    const label = CATEGORY_LABELS[category] ?? category;

    if (pending.length === 0) {
      console.log(`  ${styleSuccess("✓")} ${label}: ${changes.length}/${changes.length} configured`);
    } else {
      console.log(`  ${styleWarn("⚠")} ${label}: ${changes.length - pending.length}/${changes.length} configured (${pending.length} pending)`);
    }
  }

  if (scan.pending.length > 0) {
    console.log();
    console.log(styleMuted(`  ${scan.pending.length} changes pending. Run \`dx setup\` to apply.`));
  }
}

function groupByCategory(changes: ConfigChange[]): Map<Category, ConfigChange[]> {
  const map = new Map<Category, ConfigChange[]>();
  for (const change of changes) {
    const list = map.get(change.category) ?? [];
    list.push(change);
    map.set(change.category, list);
  }
  return map;
}
