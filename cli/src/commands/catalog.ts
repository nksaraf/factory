import { existsSync } from "node:fs";
import { join } from "node:path";

import type { DxBase } from "../dx-root.js";
import type { CatalogComponent, CatalogResource } from "@smp/factory-shared/catalog";
import type { CatalogFormat } from "@smp/factory-shared/catalog-registry";

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

/** Map of format → files to probe for detection. */
const FORMAT_FILES: [CatalogFormat, string[]][] = [
  ["dx-yaml", ["dx.yaml"]],
  ["docker-compose", ["docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml"]],
  ["backstage", ["catalog-info.yaml", "catalog-info.yml"]],
  ["helm", ["Chart.yaml"]],
];

function detectFormats(rootDir: string): { format: CatalogFormat; file: string }[] {
  const found: { format: CatalogFormat; file: string }[] = [];
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

  const maxLabel = Math.max(...fields.map(([l]) => l.length));
  for (const [label, value] of fields) {
    console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`);
  }
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

  const maxLabel = Math.max(...fields.map(([l]) => l.length));
  for (const [label, value] of fields) {
    console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`);
  }
}

export function catalogCommand(app: DxBase) {
  return app
    .sub("catalog")
    .meta({ description: "Software catalog" })
    .run(({ flags }) => {
      // Default: list all entries
      const f = toDxFlags(flags);
      const ctx = ProjectContext.fromCwd();
      const cat = ctx.catalog;

      if (f.json) {
        console.log(JSON.stringify({ success: true, data: cat }, null, 2));
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
          styleMuted(` (${cat.spec.owner})`)
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
          const ctx = ProjectContext.fromCwd();
          const cat = ctx.catalog;
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
              JSON.stringify({ success: true, data: entry }, null, 2)
            );
            return;
          }

          if (component) {
            renderComponentInfo(name, component);
          } else if (resource) {
            renderResourceInfo(name, resource);
          } else if (api) {
            // Simple API display
            const fields: [string, string][] = [
              ["Name", styleInfo(name)],
              ["Kind", api.kind],
              ["Type", api.spec.type],
              ["Lifecycle", lifecycleColor(api.spec.lifecycle)],
              ["Definition", api.spec.definition],
            ];
            const maxLabel = Math.max(...fields.map(([l]) => l.length));
            for (const [label, value] of fields) {
              console.log(
                `${styleMuted(label.padEnd(maxLabel))}  ${value}`
              );
            }
          }
        })
    )
    .command("status", (c) =>
      c
        .meta({ description: "Show catalog source and detected formats" })
        .run(({ flags }) => {
          const f = toDxFlags(flags);
          const cwd = process.cwd();

          let ctx: ProjectContext | undefined;
          try {
            ctx = ProjectContext.fromCwd(cwd);
          } catch {
            // no dx.yaml
          }

          const rootDir = ctx?.rootDir ?? cwd;
          const detected = detectFormats(rootDir);
          const activeFormat = ctx ? "dx-yaml" : null;
          const activeFile = ctx ? ctx.dxYamlPath : null;

          if (f.json) {
            console.log(
              JSON.stringify({
                success: true,
                data: {
                  active: activeFormat
                    ? { format: activeFormat, file: activeFile }
                    : null,
                  detected: detected.map((d) => ({
                    format: d.format,
                    file: join(rootDir, d.file),
                  })),
                  rootDir,
                  components: ctx
                    ? Object.keys(ctx.catalog.components).length
                    : 0,
                  resources: ctx
                    ? Object.keys(ctx.catalog.resources).length
                    : 0,
                },
              }, null, 2)
            );
            return;
          }

          console.log(styleBold("Catalog Status"));
          console.log("");

          if (activeFormat && activeFile) {
            console.log(
              `${styleMuted("Source:")}     ${styleSuccess(activeFormat)} ${styleMuted("(active)")}`
            );
            console.log(
              `${styleMuted("File:")}       ${activeFile}`
            );
          } else {
            console.log(
              `${styleMuted("Source:")}     ${styleWarn("none")} — no dx.yaml found`
            );
          }

          console.log(
            `${styleMuted("Root:")}       ${rootDir}`
          );

          if (ctx) {
            const nComp = Object.keys(ctx.catalog.components).length;
            const nRes = Object.keys(ctx.catalog.resources).length;
            const nApi = Object.keys(ctx.catalog.apis ?? {}).length;
            console.log(
              `${styleMuted("Entries:")}    ${nComp} components, ${nRes} resources, ${nApi} APIs`
            );
          }

          console.log("");
          console.log(styleBold("Detected Formats:"));

          if (detected.length === 0) {
            console.log(styleMuted("  No catalog files found."));
          } else {
            for (const d of detected) {
              const isActive = d.format === activeFormat;
              const tag = isActive
                ? styleSuccess(" ← active")
                : "";
              console.log(
                `  ${styleInfo(d.format.padEnd(16))} ${styleMuted(d.file)}${tag}`
              );
            }
          }

          // Priority explanation
          console.log("");
          console.log(
            styleMuted("Priority: dx-yaml > docker-compose > backstage > helm")
          );
        })
    );
}
