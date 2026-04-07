import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { DxBase } from "../dx-root.js";
import type {
  CatalogComponent,
  CatalogResource,
  CatalogSystem,
} from "@smp/factory-shared/catalog";
import type { CatalogFormat } from "@smp/factory-shared/catalog-registry";

// Side-effect import: registers all format adapters
import "@smp/factory-shared/formats/index";
import { getCatalogFormat } from "@smp/factory-shared/catalog-registry";

import {
  styleBold,
  styleError,
  styleInfo,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js";
import { ProjectContext } from "../lib/project.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";
import { printTable } from "../output.js";
import { runCatalogDoctor } from "./catalog-doctor.js";
import { getWorktreeInfo } from "../lib/worktree-detect.js";

setExamples("catalog", [
  "$ dx catalog              List all catalog entries",
  "$ dx catalog info api     Show details for a component or resource",
  "$ dx catalog status       Show catalog source and detected formats",
  "$ dx catalog doctor       Diagnose missing catalog labels in docker-compose",
  "$ dx catalog doctor --fix Interactively add missing labels",
  "$ dx catalog doctor --fix --yes  Accept all defaults without prompting",
]);

/** Map of format → files to probe for detection (in priority order). */
const FORMAT_FILES: [CatalogFormat, string[]][] = [
  ["docker-compose", ["docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml", "compose/"]],
  ["backstage", ["catalog-info.yaml", "catalog-info.yml"]],
  ["helm", ["Chart.yaml"]],
];

/** Priority order for format fallback. */
const FORMAT_PRIORITY: CatalogFormat[] = ["docker-compose", "backstage", "helm"];

const GENERATED_DIR = ".dx/generated";

interface DetectedFormat {
  format: CatalogFormat;
  file: string;
}

function detectFormats(rootDir: string): DetectedFormat[] {
  const found: DetectedFormat[] = [];
  for (const [format, files] of FORMAT_FILES) {
    for (const file of files) {
      if (existsSync(join(rootDir, file))) {
        found.push({ format, file });
        break; // one match per format
      }
    }
  }
  return found;
}

// ── Generate + diff ──────────────────────────────────────────

interface FileDrift {
  file: string;
  format: CatalogFormat;
  status: "added" | "modified";
}

/**
 * Generate all format variants from the catalog, write to .dx/generated/,
 * and diff against existing files in the project root.
 */
function generateAndDiff(
  catalog: CatalogSystem,
  activeFormat: CatalogFormat,
  rootDir: string,
): FileDrift[] {
  const genDir = join(rootDir, GENERATED_DIR);
  mkdirSync(genDir, { recursive: true });

  const drifts: FileDrift[] = [];

  for (const format of FORMAT_PRIORITY) {
    // Skip the active source format — it's the source of truth
    if (format === activeFormat) continue;

    let generated: Record<string, string>;
    try {
      const adapter = getCatalogFormat(format);
      const result = adapter.generate(catalog, { rootDir });
      generated = result.files;
    } catch {
      // Some adapters may fail to generate (e.g., missing required fields)
      continue;
    }

    for (const [filename, content] of Object.entries(generated)) {
      // Write generated version
      const genPath = join(genDir, filename);
      writeFileSync(genPath, content, "utf-8");

      // Compare against existing file in project root
      const existingPath = join(rootDir, filename);
      if (!existsSync(existingPath)) {
        // No existing file — not a drift, just a new generated file
        continue;
      }

      const existing = readFileSync(existingPath, "utf-8");
      if (normalizeForDiff(existing) !== normalizeForDiff(content)) {
        drifts.push({ file: filename, format, status: "modified" });
      }
    }
  }

  return drifts;
}

/** Normalize whitespace for comparison: trim trailing, normalize line endings. */
function normalizeForDiff(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function renderDriftWarnings(drifts: FileDrift[], quiet: boolean): void {
  if (drifts.length === 0 || quiet) return;

  console.error("");
  console.error(
    styleWarn(`Drift detected in ${drifts.length} file${drifts.length > 1 ? "s" : ""}:`)
  );
  for (const d of drifts) {
    console.error(
      `  ${styleWarn("⚠")} ${styleBold(d.file)} differs from ${d.format} generation`
    );
  }
  console.error(
    styleMuted(`  Run 'diff ${GENERATED_DIR}/<file> <file>' to inspect changes.`)
  );
}

// ── Catalog loading ──────────────────────────────────────────

interface CatalogResult {
  catalog: CatalogSystem;
  format: CatalogFormat;
  file: string;
  rootDir: string;
  warnings: string[];
  drifts: FileDrift[];
  /** Resolved owner: catalog spec → dx config team → "unknown" */
  owner: string;
}

/**
 * Load the catalog using format fallback: docker-compose → backstage → helm.
 * Generates all other format variants and checks for drift.
 * Returns null if no catalog source is found.
 */
function loadCatalog(cwd: string): CatalogResult | null {
  // Try ProjectContext first (docker-compose, walks up the tree)
  try {
    const ctx = ProjectContext.fromCwd(cwd);
    const drifts = generateAndDiff(ctx.catalog, "docker-compose", ctx.rootDir);
    return {
      catalog: ctx.catalog,
      format: "docker-compose",
      file: ctx.composeFiles[0] ?? cwd,
      rootDir: ctx.rootDir,
      warnings: [],
      drifts,
      owner: ctx.owner,
    };
  } catch {
    // No compose files found, fall through
  }

  // Fall back through other formats in priority order (skip docker-compose, already tried via ProjectContext)
  for (const format of FORMAT_PRIORITY.slice(1)) {
    const adapter = getCatalogFormat(format);
    if (adapter.detect(cwd)) {
      const result = adapter.parse(cwd) as import("@smp/factory-shared/catalog-registry").CatalogParseResult;
      const drifts = generateAndDiff(result.system, format, cwd);
      const detected = detectFormats(cwd).find((d) => d.format === format);
      return {
        catalog: result.system,
        format,
        file: detected ? join(cwd, detected.file) : cwd,
        rootDir: cwd,
        warnings: result.warnings,
        drifts,
        owner: result.system.spec.owner,
      };
    }
  }

  return null;
}

// ── Display helpers ──────────────────────────────────────────

function lifecycleColor(lc: string | undefined): string {
  if (!lc) return styleMuted("–");
  switch (lc) {
    case "production":
      return styleSuccess(lc);
    case "deprecated":
      return styleWarn(lc);
    default:
      return lc;
  }
}

function portsStr(ports: { port: number; containerPort?: number; protocol: string }[]): string {
  if (ports.length === 0) return styleMuted("–");
  return ports
    .map((p) => {
      const cp = p.containerPort && p.containerPort !== p.port ? `→${p.containerPort}` : "";
      return `${p.port}${cp}/${p.protocol}`;
    })
    .join(", ");
}

function renderFields(fields: [string, string][]): void {
  const maxLabel = Math.max(...fields.map(([l]) => l.length));
  for (const [label, value] of fields) {
    console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`);
  }
}

function renderComponentInfo(name: string, c: CatalogComponent): void {
  const fields: [string, string][] = [
    ["Name", styleInfo(name)],
    ["Kind", c.kind],
    ["Type", c.spec.type],
    ["Lifecycle", lifecycleColor(c.spec.lifecycle)],
    ["Owner", c.spec.owner || styleMuted("–")],
    ["System", c.spec.system ?? styleMuted("–")],
  ];

  if (c.metadata.description) {
    fields.push(["Description", c.metadata.description]);
  }
  if (c.spec.image) {
    fields.push(["Image", c.spec.image]);
  }
  if (c.spec.ports.length > 0) {
    fields.push(["Ports", portsStr(c.spec.ports)]);
  }
  if (c.spec.dev?.command) {
    fields.push(["Dev command", c.spec.dev.command]);
  }
  if (c.spec.test) {
    fields.push(["Test", c.spec.test]);
  }
  if (c.spec.lint) {
    fields.push(["Lint", c.spec.lint]);
  }
  if (c.spec.healthchecks) {
    const hc = c.spec.healthchecks;
    const checks: string[] = [];
    if (hc.live) checks.push("live");
    if (hc.ready) checks.push("ready");
    if (hc.start) checks.push("start");
    if (checks.length > 0) fields.push(["Healthchecks", checks.join(", ")]);
  }
  if (c.spec.providesApis?.length) {
    fields.push(["Provides APIs", c.spec.providesApis.join(", ")]);
  }
  if (c.spec.consumesApis?.length) {
    fields.push(["Consumes APIs", c.spec.consumesApis.join(", ")]);
  }
  if (c.spec.dependsOn?.length) {
    fields.push(["Depends on", c.spec.dependsOn.join(", ")]);
  }
  if (c.metadata.tags?.length) {
    fields.push(["Tags", c.metadata.tags.join(", ")]);
  }
  renderFields(fields);
}

function renderResourceInfo(name: string, r: CatalogResource): void {
  const fields: [string, string][] = [
    ["Name", styleInfo(name)],
    ["Kind", r.kind],
    ["Type", r.spec.type],
    ["Lifecycle", lifecycleColor(r.spec.lifecycle)],
    ["Image", r.spec.image],
  ];

  if (r.spec.ports.length > 0) {
    fields.push(["Ports", portsStr(r.spec.ports)]);
  }
  if (r.spec.healthcheck) {
    fields.push(["Healthcheck", r.spec.healthcheck]);
  }
  if (r.spec.dependencyOf?.length) {
    fields.push(["Dependency of", r.spec.dependencyOf.join(", ")]);
  }
  if (r.metadata.tags?.length) {
    fields.push(["Tags", r.metadata.tags.join(", ")]);
  }
  renderFields(fields);
}

// ── Command ──────────────────────────────────────────────────

export function catalogCommand(app: DxBase) {
  return app
    .sub("catalog")
    .meta({ description: "Software catalog" })
    .run(({ flags }) => {
      const f = toDxFlags(flags);
      const result = loadCatalog(process.cwd());

      if (!result) {
        console.error("No catalog source found. Searched for: docker-compose.yaml, catalog-info.yaml, Chart.yaml");
        process.exit(1);
      }

      const cat = result.catalog;

      if (f.json) {
        console.log(JSON.stringify({
          success: true,
          format: result.format,
          data: cat,
          drifts: result.drifts,
        }, null, 2));
        return;
      }

      const rows: string[][] = [];
      for (const [name, c] of Object.entries(cat.components)) {
        rows.push([name, c.kind, c.spec.type, c.spec.lifecycle ?? "–"]);
      }
      for (const [name, r] of Object.entries(cat.resources)) {
        rows.push([name, r.kind, r.spec.type, r.spec.lifecycle ?? "–"]);
      }
      if (cat.apis) {
        for (const [name, a] of Object.entries(cat.apis)) {
          rows.push([name, a.kind, a.spec.type, a.spec.lifecycle]);
        }
      }

      if (rows.length === 0) {
        console.log("No catalog entries found.");
        return;
      }

      // Show project name + worktree context in header
      const worktree = getWorktreeInfo(process.cwd());
      let headerName: string;
      if (worktree) {
        const repoName = basename(worktree.mainRepoDir);
        headerName = `${repoName} ${styleMuted(`(worktree: ${worktree.worktreeName})`)}`;
      } else {
        headerName = cat.metadata.name;
      }
      console.log(
        styleBold(headerName) +
          styleMuted(` (${result.owner})`)
      );
      console.log("");
      console.log(printTable(["NAME", "KIND", "TYPE", "LIFECYCLE"], rows));

      renderDriftWarnings(result.drifts, !!f.quiet);
    })
    .command("info", (c) =>
      c
        .meta({ description: "Show details for a catalog entry" })
        .args([
          {
            name: "name",
            type: "string" as const,
            required: true,
            description: "Component or resource name",
          },
        ])
        .run(({ args, flags }) => {
          const f = toDxFlags(flags);
          const result = loadCatalog(process.cwd());

          if (!result) {
            console.error("No catalog source found.");
            process.exit(1);
          }

          const cat = result.catalog;
          const name = args.name;

          const component = cat.components[name];
          const resource = cat.resources[name];
          const api = cat.apis?.[name];
          const entry = component ?? resource ?? api;

          if (!entry) {
            const available = [
              ...Object.keys(cat.components),
              ...Object.keys(cat.resources),
              ...Object.keys(cat.apis ?? {}),
            ];
            console.error(
              `Entry "${name}" not found. Available: ${available.join(", ")}`
            );
            process.exit(1);
          }

          if (f.json) {
            console.log(
              JSON.stringify({ success: true, format: result.format, data: entry }, null, 2)
            );
            return;
          }

          if (component) {
            renderComponentInfo(name, component);
          } else if (resource) {
            renderResourceInfo(name, resource);
          } else if (api) {
            renderFields([
              ["Name", styleInfo(name)],
              ["Kind", api.kind],
              ["Type", api.spec.type],
              ["Lifecycle", lifecycleColor(api.spec.lifecycle)],
              ["Definition", api.spec.definition],
            ]);
          }

          renderDriftWarnings(result.drifts, !!f.quiet);
        })
    )
    .command("status", (c) =>
      c
        .meta({ description: "Show catalog source and detected formats" })
        .run(({ flags }) => {
          const f = toDxFlags(flags);
          const cwd = process.cwd();
          const result = loadCatalog(cwd);
          const rootDir = result?.rootDir ?? cwd;
          const detected = detectFormats(rootDir);

          if (f.json) {
            console.log(
              JSON.stringify({
                success: true,
                data: {
                  active: result
                    ? { format: result.format, file: result.file }
                    : null,
                  detected: detected.map((d) => ({
                    format: d.format,
                    file: join(rootDir, d.file),
                  })),
                  rootDir,
                  generatedDir: join(rootDir, GENERATED_DIR),
                  components: result
                    ? Object.keys(result.catalog.components).length
                    : 0,
                  resources: result
                    ? Object.keys(result.catalog.resources).length
                    : 0,
                  drifts: result?.drifts ?? [],
                },
              }, null, 2)
            );
            return;
          }

          console.log(styleBold("Catalog Status"));
          console.log("");

          if (result) {
            console.log(
              `${styleMuted("Source:")}      ${styleSuccess(result.format)} ${styleMuted("(active)")}`
            );
            console.log(
              `${styleMuted("File:")}        ${result.file}`
            );
          } else {
            console.log(
              `${styleMuted("Source:")}      ${styleWarn("none")} — no catalog source found`
            );
          }

          console.log(
            `${styleMuted("Root:")}        ${rootDir}`
          );
          console.log(
            `${styleMuted("Generated:")}   ${join(rootDir, GENERATED_DIR)}`
          );

          if (result) {
            const nComp = Object.keys(result.catalog.components).length;
            const nRes = Object.keys(result.catalog.resources).length;
            const nApi = Object.keys(result.catalog.apis ?? {}).length;
            console.log(
              `${styleMuted("Entries:")}     ${nComp} components, ${nRes} resources, ${nApi} APIs`
            );
          }

          console.log("");
          console.log(styleBold("Detected Formats:"));

          if (detected.length === 0) {
            console.log(styleMuted("  No catalog files found."));
          } else {
            for (const d of detected) {
              const isActive = d.format === result?.format;
              const tag = isActive
                ? styleSuccess(" ← active")
                : "";
              console.log(
                `  ${styleInfo(d.format.padEnd(16))} ${styleMuted(d.file)}${tag}`
              );
            }
          }

          console.log("");
          console.log(
            styleMuted("Priority: docker-compose > backstage > helm")
          );

          // Drift section
          if (result && result.drifts.length > 0) {
            console.log("");
            console.log(styleBold(styleWarn("Drift:")));
            for (const d of result.drifts) {
              console.log(
                `  ${styleWarn("⚠")} ${styleBold(d.file)} differs from ${d.format} generation`
              );
              console.log(
                styleMuted(`    diff ${GENERATED_DIR}/${d.file} ${d.file}`)
              );
            }
          } else if (result) {
            console.log("");
            console.log(`${styleBold("Drift:")}       ${styleSuccess("none")} — all formats in sync`);
          }
        })
    )
    .command("doctor", (c) =>
      c
        .meta({ description: "Diagnose and fix catalog labels in docker-compose" })
        .flags({
          fix: {
            type: "boolean",
            description: "Interactively add missing labels",
          },
          yes: {
            type: "boolean",
            short: "y",
            description: "Accept all defaults without prompting",
          },
          file: {
            type: "string",
            short: "f",
            description: "Path to docker-compose file (auto-detected if omitted)",
          },
          service: {
            type: "string",
            short: "s",
            description: "Only diagnose/fix a specific service",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          await runCatalogDoctor(flags, f);
        })
    );
}
