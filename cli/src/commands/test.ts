import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { ProjectContext } from "../lib/project.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("test", [
  "$ dx test                Run all tests",
  "$ dx test api            Run tests for a component",
]);

export function testCommand(app: DxBase) {
  return app
    .sub("test")
    .meta({ description: "Run tests" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description: "Component names (default: all that define test in dx-component.yaml)",
      },
    ])
    .run(({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        const project = ProjectContext.fromCwd();
        const allNames = Object.keys(project.moduleConfig.components);
        const names =
          args.components?.length && args.components.length > 0
            ? args.components
            : allNames;
        let ran = 0;
        for (const name of names) {
          if (!project.moduleConfig.components[name]) {
            exitWithError(f, `Unknown component "${name}" in dx.yaml`);
          }
          const cfg = project.componentConfigs[name];
          const cmd = cfg?.test;
          if (!cmd?.trim()) {
            if (f.verbose) {
              console.warn(`Skipping ${name}: no test command in dx-component.yaml`);
            }
            continue;
          }
          const ref = project.moduleConfig.components[name];
          const cwd = resolve(project.rootDir, ref.path);
          const proc = spawnSync("sh", ["-c", cmd], {
            cwd,
            stdio: "inherit",
          });
          if (proc.status !== 0) {
            process.exit(proc.status ?? 1);
          }
          ran += 1;
        }
        if (ran === 0) {
          exitWithError(
            f,
            "No test commands found. Add `test:` to dx-component.yaml for each component."
          );
        }
        if (f.json) {
          console.log(JSON.stringify({ success: true, exitCode: 0, ran }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
