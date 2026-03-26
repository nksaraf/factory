import { existsSync } from "node:fs";
import { join, basename } from "node:path";

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
  styleInfo,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js";
import { ProjectContext } from "../lib/project.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";
import { printTable } from "../output.js";

setExamples("catalog", [
  "$ dx catalog              List all catalog entries",
  "$ dx catalog info api     Show details for a component or resource",
  "$ dx catalog status       Show catalog source and detected formats",
]);

/** Map of format → files to probe for detection (in priority order). */
const FORMAT_FILES: [CatalogFormat, string[]][] = [
  ["dx-yaml", ["dx.yaml"]],
  ["docker-compose", ["docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml"]],
  ["backstage", ["catalog-info.yaml", "catalog-info.yml"]],
  ["helm", ["Chart.yaml"]],
];

/** Priority order for format fallback. */
const FORMAT_PRIORITY: CatalogFormat[] = ["dx-yaml", "docker-compose", "backstage", "helm"];

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

interface CatalogResult {
  catalog: CatalogSystem;
  format: CatalogFormat;
  file: string;
  rootDir: string;
  warnings: string[];
}

/**
 * Load the catalog using format fallback: dx-yaml → docker-compose → backstage → helm.
 * Returns null if no catalog source is found.
 */
function loadCatalog(cwd: string): CatalogResult | null {
  // Try ProjectContext first (dx-yaml, walks up the tree)
  try {
    const ctx = ProjectContext.fromCwd(cwd);
    return {
      catalog: ctx.catalog,
      format: "dx-yaml",
      file: ctx.dxYamlPath,
      rootDir: ctx.rootDir,
      warnings: [],
    };
  } catch {
    // dx.yaml not found, fall through
  }

  // Fall back through other formats in priority order (skip dx-yaml, already tried)
  for (const format of FORMAT_PRIORITY.slice(1)) {
    const adapter = getCatalogFormat(format);
    if (adapter.detect(cwd)) {
      const result = adapter.parse(cwd);
      // Find the matching file for display
      const detected = detectFormats(cwd).find((d) => d.format === format);
      return {
        catalog: result.system,
        format,
        file: detected ? join(cwd, detected.file) : cwd,
        rootDir: cwd,
        warnings: result.warnings,
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
        console.error("No catalog source found. Searched for: dx.yaml, docker-compose.yaml, catalog-info.yaml, Chart.yaml");
        process.exit(1);
      }

      const cat = result.catalog;

      if (f.json) {
        console.log(JSON.stringify({ success: true, format: result.format, data: cat }, null, 2));
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

      console.log(
        styleBold(`${cat.metadata.name}`) +
          styleMuted(` (${cat.spec.owner})`) +
          styleMuted(` via ${result.format}`)
      );
      console.log("");
      console.log(printTable(["NAME", "KIND", "TYPE", "LIFECYCLE"], rows));
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
                  components: result
                    ? Object.keys(result.catalog.components).length
                    : 0,
                  resources: result
                    ? Object.keys(result.catalog.resources).length
                    : 0,
                },
              }, null, 2)
            );
            return;
          }

          console.log(styleBold("Catalog Status"));
          console.log("");

          if (result) {
            console.log(
              `${styleMuted("Source:")}     ${styleSuccess(result.format)} ${styleMuted("(active)")}`
            );
            console.log(
              `${styleMuted("File:")}       ${result.file}`
            );
          } else {
            console.log(
              `${styleMuted("Source:")}     ${styleWarn("none")} — no catalog source found`
            );
          }

          console.log(
            `${styleMuted("Root:")}       ${rootDir}`
          );

          if (result) {
            const nComp = Object.keys(result.catalog.components).length;
            const nRes = Object.keys(result.catalog.resources).length;
            const nApi = Object.keys(result.catalog.apis ?? {}).length;
            console.log(
              `${styleMuted("Entries:")}    ${nComp} components, ${nRes} resources, ${nApi} APIs`
            );

            if (result.warnings.length > 0) {
              console.log("");
              console.log(styleWarn("Warnings:"));
              for (const w of result.warnings) {
                console.log(`  ${styleWarn("⚠")} ${w}`);
              }
            }
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
            styleMuted("Priority: dx-yaml > docker-compose > backstage > helm")
          );
        })
    );
}
