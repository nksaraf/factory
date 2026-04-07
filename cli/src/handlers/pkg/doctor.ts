/**
 * dx pkg doctor — workspace health checks with optional auto-fix.
 *
 * Each check function returns DiagnosticIssue[]. The doctor runner
 * collects them into a DiagnosticReport and optionally applies fixes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";

import { capture, exec } from "../../lib/subprocess.js";
import {
  fromCwd,
  type MonorepoTopology,
  type WorkspacePackage,
  type NpmManifest,
} from "../../lib/workspace-context.js";
import type { DiagnosticIssue } from "./diagnostics.js";
import { formatReport, type DiagnosticReport } from "./diagnostics.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  fix?: boolean;
  category?: string;
  json?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

type CheckFn = (
  ws: MonorepoTopology,
) => DiagnosticIssue[] | Promise<DiagnosticIssue[]>;

/** Check that manifest files parse without errors. */
function checkManifestValidity(ws: MonorepoTopology): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  for (const pkg of ws.packages) {
    if (pkg.type === "npm") {
      try {
        JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"));
      } catch (err) {
        issues.push({
          check: "manifest-validity",
          severity: "error",
          package: pkg.name,
          message: `Invalid package.json: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    if (pkg.type === "python") {
      const tomlPath = join(pkg.dir, "pyproject.toml");
      if (existsSync(tomlPath)) {
        const text = readFileSync(tomlPath, "utf8");
        if (!text.includes("[project]") && !text.includes("[tool.")) {
          issues.push({
            check: "manifest-validity",
            severity: "warning",
            package: pkg.name,
            message: "pyproject.toml missing [project] or [tool.*] section",
          });
        }
      }
    }
    if (pkg.type === "java") {
      const pomPath = join(pkg.dir, "pom.xml");
      if (existsSync(pomPath)) {
        const text = readFileSync(pomPath, "utf8");
        if (!text.includes("<project")) {
          issues.push({
            check: "manifest-validity",
            severity: "error",
            package: pkg.name,
            message: "pom.xml missing <project> root element",
          });
        }
      }
    }
  }

  return issues;
}

/** Check for shared deps with differing versions across npm packages. */
function checkVersionMismatches(ws: MonorepoTopology): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const npmPkgs = ws.packages.filter((p) => p.type === "npm");

  const depVersions = new Map<string, Map<string, string[]>>();

  for (const pkg of npmPkgs) {
    const manifest = pkg.manifest as NpmManifest;
    const allDeps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const [dep, ver] of Object.entries(allDeps)) {
      if (ver.startsWith("workspace:")) continue;
      if (!depVersions.has(dep)) depVersions.set(dep, new Map());
      const versions = depVersions.get(dep)!;
      if (!versions.has(ver)) versions.set(ver, []);
      versions.get(ver)!.push(pkg.name);
    }
  }

  for (const [dep, versions] of depVersions) {
    if (versions.size <= 1) continue;

    const overrideVer = ws.pnpmOverrides[dep];
    const versionList = [...versions.entries()]
      .map(([v, pkgs]) => `${v} (${pkgs.join(", ")})`)
      .join("; ");

    const issue: DiagnosticIssue = {
      check: "version-mismatches",
      severity: "warning",
      message: `${dep}: ${versionList}`,
    };

    if (overrideVer) {
      issue.message += ` [override: ${overrideVer}]`;
    }

    issues.push(issue);
  }

  return issues;
}

/** Verify workspace:* references point to real workspace packages. */
function checkWorkspaceRefs(ws: MonorepoTopology): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const npmPkgs = ws.packages.filter((p) => p.type === "npm");
  const pkgNames = new Set(npmPkgs.map((p) => p.name));

  for (const pkg of npmPkgs) {
    const manifest = pkg.manifest as NpmManifest;
    const allDeps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const [dep, ver] of Object.entries(allDeps)) {
      if (!ver.startsWith("workspace:")) continue;
      if (!pkgNames.has(dep)) {
        issues.push({
          check: "workspace-refs",
          severity: "error",
          package: pkg.name,
          message: `workspace ref "${dep}" does not match any workspace package`,
        });
      }
    }
  }

  return issues;
}

/** Find directories with manifests not listed in pnpm-workspace.yaml. */
function checkOrphanedPackages(ws: MonorepoTopology): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const wsFile = join(ws.root, "pnpm-workspace.yaml");
  if (!existsSync(wsFile)) return issues;

  const knownDirs = new Set(ws.packages.map((p) => p.dir));

  const packagesDir = join(ws.root, "packages");
  if (!existsSync(packagesDir)) return issues;

  function scanDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(full, "package.json")) && !knownDirs.has(full)) {
        issues.push({
          check: "orphaned-packages",
          severity: "warning",
          package: entry,
          message: `${relative(ws.root, full)} has package.json but is not in pnpm-workspace.yaml`,
        });
      }
      if (dir === packagesDir) scanDir(full);
    }
  }

  scanDir(packagesDir);
  return issues;
}

/** Use pnpm to detect unmet peer deps. */
async function checkPeerDeps(
  ws: MonorepoTopology,
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];
  if (!existsSync(join(ws.root, "pnpm-workspace.yaml"))) return issues;

  const result = await capture(["pnpm", "ls", "--json", "-r", "--depth", "0"], {
    cwd: ws.root,
  });
  if (result.exitCode !== 0) return issues;

  try {
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data)) return issues;

    for (const entry of data) {
      const peerIssues = entry.peerDependencies;
      if (!peerIssues || typeof peerIssues !== "object") continue;
      for (const [dep, info] of Object.entries(
        peerIssues as Record<string, unknown>,
      )) {
        if (info && typeof info === "object" && "missing" in info && (info as Record<string, unknown>).missing) {
          issues.push({
            check: "peer-deps",
            severity: "warning",
            package: entry.name,
            message: `Missing peer dependency: ${dep}`,
          });
        }
      }
    }
  } catch {
    // JSON parse failed
  }

  return issues;
}

/** DFS cycle detection on workspace dependency graph. */
function checkCircularRefs(ws: MonorepoTopology): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const npmPkgs = ws.packages.filter((p) => p.type === "npm");
  const pkgNames = new Set(npmPkgs.map((p) => p.name));

  const graph = new Map<string, string[]>();
  for (const pkg of npmPkgs) {
    const manifest = pkg.manifest as NpmManifest;
    const wsDeps: string[] = [];
    for (const [dep, ver] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      if (ver.startsWith("workspace:") && pkgNames.has(dep)) {
        wsDeps.push(dep);
      }
    }
    graph.set(pkg.name, wsDeps);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart);
      issues.push({
        check: "circular-refs",
        severity: "error",
        message: `Circular dependency: ${cycle.join(" → ")} → ${node}`,
      });
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      dfs(dep, [...path]);
    }

    inStack.delete(node);
  }

  for (const name of graph.keys()) {
    dfs(name, []);
  }

  return issues;
}

/** Check lockfile freshness. */
async function checkLockfile(
  ws: MonorepoTopology,
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];
  if (!existsSync(join(ws.root, "pnpm-lock.yaml"))) {
    issues.push({
      check: "lockfile",
      severity: "warning",
      message: "No pnpm-lock.yaml found",
    });
    return issues;
  }

  const result = await capture(
    ["pnpm", "install", "--frozen-lockfile", "--dry-run"],
    { cwd: ws.root },
  );
  if (result.exitCode !== 0) {
    issues.push({
      check: "lockfile",
      severity: "error",
      message: "Lockfile out of date — run pnpm install to regenerate",
      fix: async () => {
        await exec(["pnpm", "install"], { cwd: ws.root });
      },
    });
  }

  return issues;
}

/** Check for duplicate packages. */
async function checkDuplicates(
  ws: MonorepoTopology,
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];
  if (!existsSync(join(ws.root, "pnpm-workspace.yaml"))) return issues;

  const result = await capture(["pnpm", "dedupe", "--check"], {
    cwd: ws.root,
  });
  if (result.exitCode !== 0) {
    issues.push({
      check: "duplicates",
      severity: "warning",
      message: "Duplicate dependencies detected — run pnpm dedupe to fix",
      fix: async () => {
        await exec(["pnpm", "dedupe"], { cwd: ws.root });
      },
    });
  }

  return issues;
}

/** Run pnpm audit and summarize advisory severity counts. */
async function checkSecurity(
  ws: MonorepoTopology,
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];
  if (!existsSync(join(ws.root, "pnpm-workspace.yaml"))) return issues;

  const result = await capture(["pnpm", "audit", "--json"], {
    cwd: ws.root,
  });

  try {
    const data = JSON.parse(result.stdout);
    const meta = data.metadata;
    if (meta) {
      const counts: Record<string, number> = {
        critical: meta.vulnerabilities?.critical ?? 0,
        high: meta.vulnerabilities?.high ?? 0,
        moderate: meta.vulnerabilities?.moderate ?? 0,
      };

      const total = counts.critical + counts.high + counts.moderate;
      if (total > 0) {
        const parts = Object.entries(counts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${v} ${k}`);
        issues.push({
          check: "security",
          severity: counts.critical > 0 ? "error" : "warning",
          message: `Vulnerabilities: ${parts.join(", ")}`,
        });
      }
    }
  } catch {
    // audit not available or no JSON output
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------

const CHECKS: Record<string, CheckFn> = {
  "manifest-validity": checkManifestValidity,
  "version-mismatches": checkVersionMismatches,
  "workspace-refs": checkWorkspaceRefs,
  "orphaned-packages": checkOrphanedPackages,
  "peer-deps": checkPeerDeps,
  "circular-refs": checkCircularRefs,
  lockfile: checkLockfile,
  duplicates: checkDuplicates,
  security: checkSecurity,
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function pkgDoctor(
  root: string,
  opts: DoctorOptions,
): Promise<void> {
  const ws = fromCwd(root);

  if (ws.packages.length === 0) {
    console.log("No workspace packages found.");
    return;
  }

  let checksToRun: [string, CheckFn][];
  if (opts.category) {
    const fn = CHECKS[opts.category];
    if (!fn) {
      throw new Error(
        `Unknown check category: ${opts.category}\nAvailable: ${Object.keys(CHECKS).join(", ")}`,
      );
    }
    checksToRun = [[opts.category, fn]];
  } else {
    checksToRun = Object.entries(CHECKS);
  }

  const allIssues: DiagnosticIssue[] = [];
  const checksRun: string[] = [];

  for (const [name, fn] of checksToRun) {
    checksRun.push(name);
    if (opts.verbose) console.log(`Running check: ${name}...`);
    const issues = await fn(ws);
    allIssues.push(...issues);
  }

  if (opts.fix) {
    const fixable = allIssues.filter((i) => i.fix);
    if (fixable.length > 0) {
      console.log(`\nApplying ${fixable.length} auto-fix(es)...`);
      for (const issue of fixable) {
        if (opts.verbose) console.log(`  Fixing: ${issue.message}`);
        await issue.fix!();
      }
      console.log("Running pnpm install to sync lockfile...");
      await exec(["pnpm", "install"], { cwd: ws.root });
    }
  }

  const report: DiagnosticReport = { issues: allIssues, checksRun };
  console.log(formatReport(report, opts.json));
}
